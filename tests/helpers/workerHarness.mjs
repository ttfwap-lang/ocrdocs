import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;

function redact(value, values) {
  let result = value;
  for (const secret of values) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

/**
 * Run a worker-like subprocess without hiding its failure status.
 * The executable is injectable so the same harness can run Python workers and
 * deterministic Node fixtures on hosts where Python OCR dependencies are absent.
 */
export function runWorker(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  const redactValues = options.redactValues ?? [];
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timedOut = false;
    let outputLimitReached = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const stderr = [];

    const append = (target, chunk, currentBytes) => {
      const remaining = Math.max(0, outputLimit - currentBytes);
      if (remaining === 0) return currentBytes;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const accepted = buffer.subarray(0, remaining);
      target.push(accepted);
      if (buffer.length > accepted.length) outputLimitReached = true;
      return currentBytes + accepted.length;
    };

    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutText = redact(Buffer.concat(stdout).toString('utf8'), redactValues);
      const stderrText = redact(Buffer.concat(stderr).toString('utf8'), redactValues);
      const failed = timedOut || outputLimitReached || error || code !== 0;
      resolve({
        command,
        args: [...args],
        code,
        exitCode: failed ? (timedOut || outputLimitReached ? 124 : (code ?? 1)) : 0,
        signal: signal ?? null,
        timedOut,
        outputLimitReached,
        failed: Boolean(failed),
        stdout: stdoutText,
        stderr: stderrText,
        output: [stdoutText, stderrText].filter(Boolean).join('\n'),
        error: error?.message ?? null,
        durationMs: Date.now() - startedAt,
      });
    };

    const terminate = () => {
      if (child && !child.killed) child.kill();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.on('data', (chunk) => {
        stdoutBytes = append(stdout, chunk, stdoutBytes);
        if (outputLimitReached) terminate();
      });
      child.stderr.on('data', (chunk) => {
        stderrBytes = append(stderr, chunk, stderrBytes);
        if (outputLimitReached) terminate();
      });
      child.once('error', (error) => finish(null, null, error));
      child.once('close', (code, signal) => finish(code, signal, null));
    } catch (error) {
      finish(null, null, error);
    }
  });
}

export function runWorkerScript(scriptPath, args = [], options = {}) {
  const command = options.pythonCommand ?? (process.platform === 'win32' ? 'python' : 'python3');
  return runWorker(command, [scriptPath, ...args], options);
}
