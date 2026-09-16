/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stage 6 — deterministic environment configuration loading with strict validation.
 * Missing or invalid settings reject startup with exit code 1 and never echo secrets.
 */

export type NodeEnvironment = 'development' | 'production' | 'test';

export interface LoadedEnvConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  host: string;
  databasePath: string;
  storageRoot: string;
  /** Present only when configured; never logged by validators. */
  jwtSecret: string | undefined;
  shutdownTimeoutMs: number;
}

export class EnvValidationError extends Error {
  readonly code = 'ENV_VALIDATION_FAILED';
  readonly exitCode = 1;
  readonly issues: string[];

  constructor(issues: string[]) {
    const safeIssues = issues.map(sanitizeIssue);
    super(`Environment validation failed (${safeIssues.length}): ${safeIssues.join('; ')}`);
    this.name = 'EnvValidationError';
    this.issues = safeIssues;
  }
}

const SECRET_ENV_NAMES = new Set([
  'JWT_SECRET',
  'GEMINI_API_KEY',
  'DGX_WORKER_TOKEN',
]);

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_DATABASE_PATH = 'data/app.db';
const DEFAULT_STORAGE_ROOT = 'storage/private';
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const MIN_JWT_SECRET_LENGTH = 16;

function sanitizeIssue(issue: string): string {
  // Never echo secret values if a caller accidentally interpolated them.
  return issue.replace(/(=|:)\s*([^\s;]{8,})/g, (match, sep, value) => {
    if (/^[A-Za-z0-9+/=._-]{8,}$/.test(value) && value.length >= 12) {
      return `${sep} [REDACTED]`;
    }
    return match;
  });
}

function parseNodeEnv(raw: string | undefined): NodeEnvironment {
  const value = (raw || 'development').trim().toLowerCase();
  if (value === 'development' || value === 'production' || value === 'test') {
    return value;
  }
  throw new EnvValidationError([
    `NODE_ENV must be one of development|production|test (received non-enum value)`,
  ]);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new EnvValidationError([
      `PORT must be an integer between 1 and 65535 (received non-numeric value)`,
    ]);
  }
  const port = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvValidationError([
      `PORT must be an integer between 1 and 65535 (received out-of-range value)`,
    ]);
  }
  return port;
}

function parsePositiveInt(
  raw: string | undefined,
  field: string,
  fallback: number,
): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new EnvValidationError([`${field} must be a positive integer`]);
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new EnvValidationError([`${field} must be a positive integer`]);
  }
  return value;
}

function parseRequiredPath(
  raw: string | undefined,
  field: string,
  fallback: string,
  nodeEnv: NodeEnvironment,
): string {
  if (raw === undefined || raw.trim() === '') {
    if (nodeEnv === 'production' && !fallback) {
      throw new EnvValidationError([`${field} is required in production`]);
    }
    return fallback;
  }
  const value = raw.trim();
  if (value.includes('\0')) {
    throw new EnvValidationError([`${field} contains an illegal null byte`]);
  }
  return value;
}

function parseJwtSecret(
  raw: string | undefined,
  nodeEnv: NodeEnvironment,
): string | undefined {
  if (raw === undefined || raw.trim() === '') {
    if (nodeEnv === 'production') {
      throw new EnvValidationError([
        'JWT_SECRET is required in production (minimum 16 characters)',
      ]);
    }
    return undefined;
  }
  const value = raw.trim();
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    throw new EnvValidationError([
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    ]);
  }
  return value;
}

/**
 * Load and validate process environment. Throws EnvValidationError (exitCode 1)
 * on invalid or missing required settings. Never includes secret values in messages.
 */
export function loadAndValidateEnv(
  source: NodeJS.ProcessEnv = process.env,
): LoadedEnvConfig {
  const issues: string[] = [];
  let nodeEnv: NodeEnvironment = 'development';
  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  let databasePath = DEFAULT_DATABASE_PATH;
  let storageRoot = DEFAULT_STORAGE_ROOT;
  let jwtSecret: string | undefined;
  let shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS;

  try {
    nodeEnv = parseNodeEnv(source.NODE_ENV);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      issues.push(...err.issues);
    } else {
      throw err;
    }
  }

  try {
    port = parsePort(source.PORT);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      issues.push(...err.issues);
    } else {
      throw err;
    }
  }

  host = (source.HOST || DEFAULT_HOST).trim() || DEFAULT_HOST;
  if (!host) {
    issues.push('HOST must be a non-empty bind address');
  }

  try {
    databasePath = parseRequiredPath(
      source.DATABASE_PATH,
      'DATABASE_PATH',
      DEFAULT_DATABASE_PATH,
      nodeEnv,
    );
  } catch (err) {
    if (err instanceof EnvValidationError) {
      issues.push(...err.issues);
    } else {
      throw err;
    }
  }

  try {
    storageRoot = parseRequiredPath(
      source.STORAGE_ROOT,
      'STORAGE_ROOT',
      DEFAULT_STORAGE_ROOT,
      nodeEnv,
    );
  } catch (err) {
    if (err instanceof EnvValidationError) {
      issues.push(...err.issues);
    } else {
      throw err;
    }
  }

  try {
    jwtSecret = parseJwtSecret(source.JWT_SECRET, nodeEnv);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      issues.push(...err.issues);
    } else {
      throw err;
    }
  }

  try {
    shutdownTimeoutMs = parsePositiveInt(
      source.SHUTDOWN_TIMEOUT_MS,
      'SHUTDOWN_TIMEOUT_MS',
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof EnvValidationError) {
      issues.push(...err.issues);
    } else {
      throw err;
    }
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return {
    nodeEnv,
    port,
    host,
    databasePath,
    storageRoot,
    jwtSecret,
    shutdownTimeoutMs,
  };
}

/** True when the environment variable name is treated as a secret. */
export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_NAMES.has(name.toUpperCase());
}

export const ENV_DEFAULTS = Object.freeze({
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  databasePath: DEFAULT_DATABASE_PATH,
  storageRoot: DEFAULT_STORAGE_ROOT,
  shutdownTimeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
  minJwtSecretLength: MIN_JWT_SECRET_LENGTH,
});
