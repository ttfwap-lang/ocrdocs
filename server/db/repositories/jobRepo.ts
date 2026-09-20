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
     SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
     WHERE id = (
       SELECT j.id FROM jobs j
       JOIN documents d ON d.id = j.document_id
       WHERE j.status = 'queued'
       -- Cheap types first (FIFO within each group): one 20 MB scanned PDF can occupy the single serial worker for
       -- minutes, and on a 17k-document batch that stalled thousands of quick text/XML/image jobs behind it.
       ORDER BY (CASE WHEN d.mime_type = 'application/pdf' THEN 1 ELSE 0 END), j.rowid
       LIMIT 1
     )
     RETURNING *`,
  );

  // A worker that dies mid-job leaves its row in 'processing' forever: nothing
  // else will ever claim it, and the document silently never gets processed.
  // These two statements expire such leases — retrying while attempts remain,
  // and failing the job permanently once they are exhausted so it cannot loop.
  const stmtReclaimStale = db.prepare<[string, number]>(
    `UPDATE jobs
     SET status = 'queued', started_at = NULL
     WHERE status = 'processing'
       AND started_at IS NOT NULL
       AND started_at < datetime('now', ?)
       AND attempts < ?
     RETURNING *`,
  );

  const stmtFailExhausted = db.prepare<[string, string, number]>(
    `UPDATE jobs
     SET status = 'failed', completed_at = ?, error = 'Worker lease expired and retry budget exhausted'
     WHERE status = 'processing'
       AND started_at IS NOT NULL
       AND started_at < datetime('now', ?)
       AND attempts >= ?
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

    /**
     * Expire worker leases that have gone stale, so a job whose worker died is
     * not abandoned in 'processing' forever. Jobs with retries left go back to
     * 'queued'; jobs that have burned their retry budget are failed outright
     * rather than cycling between queued and processing indefinitely.
     */
    reclaimStale(leaseSeconds: number, maxAttempts: number): {
      requeued: JobRow[];
      failed: JobRow[];
    } {
      const cutoff = `-${Math.max(1, Math.floor(leaseSeconds))} seconds`;
      const failed = stmtFailExhausted.all(
        new Date().toISOString(),
        cutoff,
        maxAttempts,
      ) as JobRow[];
      const requeued = stmtReclaimStale.all(cutoff, maxAttempts) as JobRow[];
      return { requeued, failed };
    },
  };
}

export type JobRepo = ReturnType<typeof createJobRepo>;
