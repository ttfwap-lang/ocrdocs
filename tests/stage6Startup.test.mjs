/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stage 6 — Build and startup corrections.
 * Validates environment schema, EADDRINUSE diagnostics, graceful shutdown,
 * exit-code discipline, and secret non-disclosure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, '..');
const tempDir = path.join(project, 'node_modules', '.cache', 'stage6-tests');
fs.mkdirSync(tempDir, { recursive: true });

async function bundleModule(entryRelative, outName) {
  const outfile = path.join(tempDir, outName);
  await esbuild.build({
    entryPoints: [path.join(project, entryRelative)],
    bundle: true,
    write: true,
    outfile,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

function occupyPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

test('Stage 6 — Build and startup corrections test suite', async (t) => {
  let envMod;
  let shutdownMod;

  t.before(async () => {
    envMod = await bundleModule('server/config/env.ts', 'env.mjs');
    shutdownMod = await bundleModule('server/lifecycle/shutdown.ts', 'shutdown.mjs');
  });

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup races on Windows
    }
  });

  await t.test('Fact 1: invalid PORT rejects startup with exitCode 1', () => {
    assert.throws(
      () => envMod.loadAndValidateEnv({ NODE_ENV: 'development', PORT: 'abc' }),
      (err) =>
        err instanceof envMod.EnvValidationError &&
        err.exitCode === 1 &&
        err.code === 'ENV_VALIDATION_FAILED' &&
        /PORT/i.test(err.message),
    );

    assert.throws(
      () => envMod.loadAndValidateEnv({ NODE_ENV: 'development', PORT: '0' }),
      (err) => err instanceof envMod.EnvValidationError && err.exitCode === 1,
    );

    assert.throws(
      () => envMod.loadAndValidateEnv({ NODE_ENV: 'development', PORT: '70000' }),
      (err) => err instanceof envMod.EnvValidationError && err.exitCode === 1,
    );
  });

  await t.test('Fact 1: production missing JWT_SECRET blocks startup with code 1', () => {
    assert.throws(
      () =>
        envMod.loadAndValidateEnv({
          NODE_ENV: 'production',
          PORT: '3000',
        }),
      (err) =>
        err instanceof envMod.EnvValidationError &&
        err.exitCode === 1 &&
        err.issues.some((i) => /JWT_SECRET/i.test(i)),
    );
  });

  await t.test('Fact 1: valid configuration with optional parameters omitted starts defaults', () => {
    const cfg = envMod.loadAndValidateEnv({
      NODE_ENV: 'development',
    });
    assert.equal(cfg.nodeEnv, 'development');
    assert.equal(cfg.port, envMod.ENV_DEFAULTS.port);
    assert.equal(cfg.host, envMod.ENV_DEFAULTS.host);
    assert.equal(cfg.databasePath, envMod.ENV_DEFAULTS.databasePath);
    assert.equal(cfg.storageRoot, envMod.ENV_DEFAULTS.storageRoot);
    assert.equal(cfg.shutdownTimeoutMs, envMod.ENV_DEFAULTS.shutdownTimeoutMs);
    assert.equal(cfg.jwtSecret, undefined);
    assert.equal(cfg.enableDemoFixtures, false);
  });

  await t.test('Fact 1: production accepts full valid config', () => {
    const cfg = envMod.loadAndValidateEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      DATABASE_PATH: 'data/prod.db',
      STORAGE_ROOT: 'storage/private',
      JWT_SECRET: 'unit-test-secret-ok',
      SHUTDOWN_TIMEOUT_MS: '5000',
    });
    assert.equal(cfg.nodeEnv, 'production');
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.databasePath, 'data/prod.db');
    assert.equal(cfg.jwtSecret, 'unit-test-secret-ok');
    assert.equal(cfg.shutdownTimeoutMs, 5000);
    assert.equal(cfg.enableDemoFixtures, false);
  });

  await t.test('Security: validation errors never echo secret values', () => {
    const secret = 'SuperSecretValue999';
    try {
      envMod.loadAndValidateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'short',
      });
      assert.fail('expected throw');
    } catch (err) {
      assert.equal(err.exitCode, 1);
      assert.equal(err.message.includes(secret), false);
      assert.equal(err.message.includes('short'), false);
      assert.match(err.message, /JWT_SECRET/);
    }

    // Explicit redaction path if a secret sneaks into an issue string
    const leaked = new envMod.EnvValidationError([
      `JWT_SECRET=${secret} is invalid`,
    ]);
    assert.equal(leaked.message.includes(secret), false);
    assert.match(leaked.message, /REDACTED|JWT_SECRET/);
  });

  await t.test('Fact 3: EADDRINUSE produces actionable error and exit semantics', async () => {
    const occupied = await occupyPort();
    try {
      const colliding = http.createServer((_req, res) => {
        res.end('ok');
      });
      let listenError;
      try {
        await shutdownMod.listenAsync(colliding, occupied.port, '127.0.0.1');
        assert.fail('expected EADDRINUSE');
      } catch (err) {
        listenError = err;
      } finally {
        await new Promise((resolve) => colliding.close(() => resolve()));
      }

      assert.ok(listenError, 'listen must fail when port is bound');
      assert.equal(listenError.code, 'EADDRINUSE');

      const message = shutdownMod.formatListenError(
        listenError,
        occupied.port,
        '127.0.0.1',
      );
      assert.match(message, /EADDRINUSE/);
      assert.match(message, new RegExp(String(occupied.port)));
      assert.match(message, /Exiting with code 1/);
      assert.match(message, /PORT|free port|conflicting/i);
    } finally {
      await new Promise((resolve) => occupied.server.close(() => resolve()));
    }
  });

  await t.test('Fact 2: graceful shutdown closes active connections cleanly', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    await shutdownMod.listenAsync(server, 0, '127.0.0.1');
    const addr = server.address();
    const exits = [];

    const manager = shutdownMod.createShutdownManager(
      server,
      {
        shutdownTimeoutMs: 2000,
        drainSockets: true,
        onShutdown: async () => {},
      },
      {
        exitFn: (code) => exits.push(code),
        signals: [],
        logger: () => {},
      },
    );
    manager.install();

    // Open a short-lived connection so tracking is exercised
    await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${addr.port}/`, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });

    const result = await manager.shutdown('SIGTERM');
    manager.uninstall();

    assert.equal(manager.isShuttingDown(), true);
    assert.equal(result.reason, 'SIGTERM');
    assert.equal(result.clean, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.durationMs >= 0);

    // Server should no longer accept connections
    await assert.rejects(
      () =>
        new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${addr.port}/`, resolve);
          req.on('error', reject);
        }),
      (err) => err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET'),
    );
  });

  await t.test('Boundary: shutdown timeout forces exit code 1 when sockets will not drain', async () => {
    const server = http.createServer((_req, res) => {
      // Intentionally never end the response — keeps the socket open.
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial');
    });

    await shutdownMod.listenAsync(server, 0, '127.0.0.1');
    const addr = server.address();

    const manager = shutdownMod.createShutdownManager(
      server,
      {
        shutdownTimeoutMs: 80,
        drainSockets: true,
        onShutdown: async () => {},
      },
      {
        exitFn: () => {},
        signals: [],
        logger: () => {},
      },
    );
    manager.install();

    const hangingReq = http.get(`http://127.0.0.1:${addr.port}/`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const result = await manager.shutdown('timeout-test');
    manager.uninstall();
    hangingReq.destroy();

    assert.equal(result.clean, false);
    assert.equal(result.exitCode, 1);
    assert.ok(result.durationMs >= 80);
  });

  await t.test('Fact 4: lifecycle modules export frozen Stage 6 contracts', () => {
    assert.equal(typeof envMod.loadAndValidateEnv, 'function');
    assert.equal(typeof envMod.EnvValidationError, 'function');
    assert.equal(typeof envMod.isSecretEnvName, 'function');
    assert.equal(envMod.isSecretEnvName('JWT_SECRET'), true);
    assert.equal(envMod.isSecretEnvName('PORT'), false);

    assert.equal(typeof shutdownMod.createShutdownManager, 'function');
    assert.equal(typeof shutdownMod.formatListenError, 'function');
    assert.equal(typeof shutdownMod.listenAsync, 'function');

    const typesSource = fs.readFileSync(path.join(project, 'src', 'types.ts'), 'utf8');
    assert.match(typesSource, /export interface ServerLifecycleConfig/);
    assert.match(typesSource, /export interface LoadedEnvConfig/);

    const serverSource = fs.readFileSync(path.join(project, 'server.ts'), 'utf8');
    assert.match(serverSource, /loadAndValidateEnv/);
    assert.match(serverSource, /createShutdownManager/);
    assert.match(serverSource, /formatListenError/);
    assert.match(serverSource, /listenAsync/);
    assert.equal(serverSource.includes('httpServer.listen(PORT'), false);
  });

  await t.test('Negative mutation: empty production JWT_SECRET still fails', () => {
    assert.throws(
      () =>
        envMod.loadAndValidateEnv({
          NODE_ENV: 'production',
          JWT_SECRET: '   ',
          PORT: '3000',
        }),
      (err) => err instanceof envMod.EnvValidationError && err.exitCode === 1,
    );
  });

  await t.test('Negative mutation: invalid NODE_ENV rejected', () => {
    assert.throws(
      () => envMod.loadAndValidateEnv({ NODE_ENV: 'staging' }),
      (err) =>
        err instanceof envMod.EnvValidationError &&
        err.issues.some((i) => /NODE_ENV/i.test(i)),
    );
  });
});
