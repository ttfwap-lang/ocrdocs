/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * File upload middleware using multer disk storage.
 * Stores files under STORAGE_ROOT (default: storage/private).
 *
 * The accept list here is reconciled line-by-line with the OCR engine's actual
 * dispatch in scripts/ocr_spark_engine.py (process_single_file_for_pass).
 * A file is accepted when its MIME type OR its extension is supported, so a
 * client that sends e.g. .docx as application/octet-stream is not dropped.
 * Office binaries (.doc/.xls/.xlsx/.ppt/.pptx) are intentionally excluded -- the
 * engine has no branch for them and would fail-fast NOOCR on pass 1; rejecting
 * them here gives a clear message instead of a doomed queued job.
 */

import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { resolve, extname, join } from 'path';
import type { Request } from 'express';

const STORAGE_ROOT = resolve(
  process.env.STORAGE_ROOT || 'storage/private',
);

/** MIME types accepted by the OCR engine's file-type dispatch. */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/bmp',
  'image/webp',
  'image/x-tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/rtf',
  'text/rtf',
  'application/xml',
  'text/xml',
  'text/plain',
  'application/json',
]);

/**
 * Extensions the OCR engine actually parses in
 * scripts/ocr_spark_engine.py::process_single_file_for_pass
 * (`.final` is an internal raw-text interchange format, not a user upload).
 */
const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp',
  'docx', 'rtf', 'xml', 'txt', 'json',
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
 * File filter — accept when MIME OR extension is supported; reject everything
 * else (notably legacy Office binaries) with an actionable message.
 */
function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const ext = extname(file.originalname).toLowerCase().replace(/^\./, '') || '';
  const byMime = ALLOWED_MIME_TYPES.has(file.mimetype);
  const byExt = ext ? SUPPORTED_EXTENSIONS.has(ext) : false;

  if (byMime || byExt) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type: ${file.mimetype || 'unknown'} (.${ext || '???'}). ` +
          'Accepted: PDF, PNG, JPEG, TIFF, BMP, WEBP, DOCX, RTF, XML, TXT, JSON. ' +
          'Office binaries (.doc/.xls/.xlsx/.ppt/.pptx) are not supported -- convert to PDF or DOCX.',
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

export { STORAGE_ROOT, ALLOWED_MIME_TYPES, SUPPORTED_EXTENSIONS, DEFAULT_FILE_SIZE_LIMIT };
