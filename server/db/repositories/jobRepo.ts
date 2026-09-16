/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — job queue repository: CRUD for the `jobs` table.
 * Provides enqueue, dequeue, and status update operations.
 */

import { randomUUID } from 'crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { JobRow, JobStatus } from '../contracts';

export function createJobRepo(db: DatabaseType) {
  const stmtEnqueue = db.prepare<
    [string, string]
  >(
    `INSERT INTO jobs (id, document_id) VALUES (?, ?)`,
  );

  const stmtDequeue = db.prepare(
    `UPDATE jobs
     SET status = 'processing', started_at = datetime('now')
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'queued'
       ORDER BY rowid
       LIMIT 1
     )
     RETURNING *`,
  );

  const stmtGetById = db.prepare<string>(
    `SELECT * FROM jobs WHERE id = ?`,
  );

  const stmtGetByDocument = db.prepare<string>(
    `SELECT * FROM jobs WHERE document_id = ? ORDER BY rowid DESC`,
  );

  const stmtGetByStatus = db.prepare<string>(
    `SELECT * FROM jobs WHERE status = ? ORDER BY rowid`,
  );

  const stmtUpdateStatus = db.prepare<
    [string, string | null, string | null, string]
  >(
    `UPDATE jobs
     SET status = ?, completed_at = ?, error = ?
     WHERE id = ?`,
  );

  return {
    enqueue(params: { id?: string; documentId: string }): JobRow {
      const id = params.id ?? randomUUID();
      stmtEnqueue.run(id, params.documentId);
      return this.getById(id)!;
    },

    /**
     * Atomically dequeue the next queued job and mark it as processing.
     * Returns undefined if no queued jobs remain.
     */
    dequeue(): JobRow | undefined {
      const row = stmtDequeue.get() as JobRow | undefined;
      return row;
    },

    getById(id: string): JobRow | undefined {
      return stmtGetById.get(id) as JobRow | undefined;
    },

    getByDocument(documentId: string): JobRow[] {
      return stmtGetByDocument.all(documentId) as JobRow[];
    },

    getByStatus(status: JobStatus): JobRow[] {
      return stmtGetByStatus.all(status) as JobRow[];
    },

    markCompleted(jobId: string): void {
      stmtUpdateStatus.run(
        'completed',
        new Date().toISOString(),
        null,
        jobId,
      );
    },

    markFailed(jobId: string, error: string): void {
      stmtUpdateStatus.run(
        'failed',
        new Date().toISOString(),
        error,
        jobId,
      );
    },

    markProcessing(jobId: string): void {
      stmtUpdateStatus.run(
        'processing',
        null,
        null,
        jobId,
      );
    },
  };
}

export type JobRepo = ReturnType<typeof createJobRepo>;
