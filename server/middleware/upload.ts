/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — file upload middleware using multer disk storage.
 * Stores files under STORAGE_ROOT (default: storage/private).
 */

import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { resolve, extname, join } from 'path';
import type { Request } from 'express';

const STORAGE_ROOT = resolve(
  process.env.STORAGE_ROOT || 'storage/private',
);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
]);

const DEFAULT_FILE_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

function ensureStorageDir(): void {
  if (!existsSync(STORAGE_ROOT)) {
    mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

/**
 * Generate a unique filename: <timestamp>-<random>.<ext>
 */
function generateFilename(
  _req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, filename: string) => void,
): void {
  const ext = extname(file.originalname).toLowerCase() || '.bin';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  cb(null, `${unique}${ext}`);
}

const storage = multer.diskStorage({
  destination: (
    _req: Request,
    _file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void,
  ) => {
    ensureStorageDir();
    cb(null, STORAGE_ROOT);
  },
  filename: generateFilename,
});

/**
 * File filter — reject unsupported MIME types with a clear error.
 */
function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type: ${file.mimetype}. Allowed: PDF, PNG, JPEG, TIFF.`,
      ),
    );
  }
}

/**
 * Configured multer middleware. Single-file upload via form field "file".
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: DEFAULT_FILE_SIZE_LIMIT,
  },
});

/**
 * Resolve the absolute path to a stored file by its relative filename.
 */
export function getFilePath(filename: string): string {
  return join(STORAGE_ROOT, filename);
}

export { STORAGE_ROOT, ALLOWED_MIME_TYPES, DEFAULT_FILE_SIZE_LIMIT };
