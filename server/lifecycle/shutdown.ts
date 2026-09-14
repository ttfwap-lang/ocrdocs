/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stage 6 — graceful HTTP server lifecycle: SIGINT/SIGTERM drain, socket tracking,
 * bounded shutdown timeout, and deterministic exit codes (0 clean, 1 forced/fatal).
 */

import type { Server as HttpServer } from 'http';
import type { Socket } from 'net';

export interface ServerLifecycleConfig {
  port: number;
  host: string;
  shutdownTimeoutMs: number;
  drainSockets: boolean;
  onShutdown: () => Promise<void>;
}

export interface ShutdownManager {
  /** Register SIGINT/SIGTERM listeners and connection tracking. */
  install(): void;
  /** Initiate controlled drain; resolves after close or forced destroy. */
  shutdown(reason?: string): Promise<ShutdownResult>;
  isShuttingDown(): boolean;
  getActiveConnectionCount(): number;
  /** Detach signal listeners (tests). */
  uninstall(): void;
}

export interface ShutdownResult {
  reason: string;
  clean: boolean;
  exitCode: number;
  drainedConnections: number;
  durationMs: number;
}

export type ExitFn = (code: number) => void;

/**
 * Format structured listen/bind failures for operators. Never includes secrets.
 */
export function formatListenError(
  err: NodeJS.ErrnoException,
  port: number,
  host: string,
): string {
  if (err.code === 'EADDRINUSE') {
    return (
      `[NGX-CORE] FATAL EADDRINUSE: port ${port} on ${host} is already in use. ` +
      `Stop the conflicting process (e.g. netstat/Get-NetTCPConnection) or set PORT to a free port. ` +
      `Exiting with code 1.`
    );
  }
  if (err.code === 'EACCES') {
    return (
      `[NGX-CORE] FATAL EACCES: permission denied binding ${host}:${port}. ` +
      `Choose a port >= 1024 or elevate privileges. Exiting with code 1.`
    );
  }
  if (err.code === 'EADDRNOTAVAIL') {
    return (
      `[NGX-CORE] FATAL EADDRNOTAVAIL: host ${host} is not available on this machine. ` +
      `Check HOST setting. Exiting with code 1.`
    );
  }
  const code = err.code || 'LISTEN_ERROR';
  return (
    `[NGX-CORE] FATAL ${code}: failed to bind ${host}:${port} — ${err.message}. ` +
    `Exiting with code 1.`
  );
}

/**
 * Bind an HTTP server and reject with a structured error on collision/permission failures.
 */
export function listenAsync(
  server: HttpServer,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export function createShutdownManager(
  server: HttpServer,
  config: Pick<ServerLifecycleConfig, 'shutdownTimeoutMs' | 'drainSockets' | 'onShutdown'>,
  options: {
    exitFn?: ExitFn;
    signals?: NodeJS.Signals[];
    logger?: (message: string) => void;
  } = {},
): ShutdownManager {
  const exitFn = options.exitFn ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? (['SIGINT', 'SIGTERM'] as NodeJS.Signals[]);
  const log = options.logger ?? ((message: string) => console.log(message));

  const sockets = new Set<Socket>();
  let shuttingDown = false;
  let shutdownPromise: Promise<ShutdownResult> | null = null;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const installProcessFatalHandlers = options.signals === undefined || (options.signals?.length ?? 0) > 0;

  const trackConnection = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  };

  const destroySockets = () => {
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore individual destroy failures
      }
    }
    sockets.clear();
  };

  const onUncaughtException = (err: Error) => {
    log(`[NGX-CORE] uncaughtException: ${err.stack || err.message}`);
    void shutdown('uncaughtException').then(() => exitFn(1));
  };

  const onUnhandledRejection = (reason: unknown) => {
    const message =
      reason instanceof Error ? reason.stack || reason.message : String(reason);
    log(`[NGX-CORE] unhandledRejection: ${message}`);
    void shutdown('unhandledRejection').then(() => exitFn(1));
  };

  const shutdown = async (reason = 'manual'): Promise<ShutdownResult> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shuttingDown = true;
    const started = Date.now();
    let drainedConnections = sockets.size;
    let clean = true;
    let exitCode = 0;

    shutdownPromise = (async () => {
      log(`[NGX-CORE] Shutdown initiated (reason=${reason}); draining connections…`);

      try {
        await config.onShutdown();
      } catch (err) {
        clean = false;
        exitCode = 1;
        log(
          `[NGX-CORE] onShutdown hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const closePromise = new Promise<void>((resolve) => {
        server.close((closeErr) => {
          if (closeErr) {
            clean = false;
            exitCode = 1;
            log(`[NGX-CORE] server.close error: ${closeErr.message}`);
          }
          resolve();
        });
      });

      const timeoutMs = Math.max(1, config.shutdownTimeoutMs);
      let timedOut = false;
      const timeoutPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      });

      await Promise.race([closePromise, timeoutPromise]);

      if (timedOut) {
        clean = false;
        exitCode = 1;
        drainedConnections = sockets.size;
        log(
          `[NGX-CORE] Shutdown timeout after ${timeoutMs}ms — forcing ${sockets.size} socket destroy(s)`,
        );
        if (config.drainSockets) {
          destroySockets();
        }
        // Ensure close settles after forced destroy
        await Promise.race([
          closePromise,
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 250);
            if (typeof t.unref === 'function') t.unref();
          }),
        ]);
      } else {
        drainedConnections = 0;
      }

      const result: ShutdownResult = {
        reason,
        clean,
        exitCode,
        drainedConnections,
        durationMs: Date.now() - started,
      };

      log(
        `[NGX-CORE] Shutdown complete clean=${clean} exitCode=${exitCode} durationMs=${result.durationMs}`,
      );
      return result;
    })();

    return shutdownPromise;
  };

  const install = () => {
    server.on('connection', trackConnection);

    for (const signal of signals) {
      const handler = () => {
        void shutdown(signal).then((result) => {
          exitFn(result.exitCode);
        });
      };
      signalHandlers.set(signal, handler);
      try {
        process.on(signal, handler);
      } catch {
        // Some signals are unsupported on Windows; skip silently.
      }
    }

    // Only install process fatal handlers for real server lifecycle (not bare unit tests).
    if (installProcessFatalHandlers) {
      process.on('uncaughtException', onUncaughtException);
      process.on('unhandledRejection', onUnhandledRejection);
    }
  };

  const uninstall = () => {
    server.off('connection', trackConnection);
    for (const [signal, handler] of signalHandlers) {
      try {
        process.off(signal, handler);
      } catch {
        // ignore
      }
    }
    signalHandlers.clear();
    if (installProcessFatalHandlers) {
      process.off('uncaughtException', onUncaughtException);
      process.off('unhandledRejection', onUnhandledRejection);
    }
  };

  return {
    install,
    shutdown,
    isShuttingDown: () => shuttingDown,
    getActiveConnectionCount: () => sockets.size,
    uninstall,
  };
}
