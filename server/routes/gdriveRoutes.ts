/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';

export const gdriveRouter = Router();

export function isDriveAuthenticated(req: Request): boolean {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 10) {
    return true;
  }
  if (process.env.GDRIVE_ACCESS_TOKEN && process.env.GDRIVE_ACCESS_TOKEN.trim().length > 0) {
    return true;
  }
  return false;
}

export function isDemoFixturesEnabled(): boolean {
  return process.env.ENABLE_DEMO_FIXTURES === 'true' && process.env.NODE_ENV !== 'production';
}

// GET /api/gdrive/status
gdriveRouter.get('/status', async (_req: Request, res: Response) => {
  const isDemo = isDemoFixturesEnabled();
  const hasAuth = Boolean(process.env.GDRIVE_ACCESS_TOKEN || process.env.GDRIVE_CLIENT_ID);

  if (!hasAuth && !isDemo) {
    return res.status(200).json({
      service: 'gdrive',
      configured: false,
      available: false,
      mode: 'unconfigured',
      syncState: 'unconfigured',
      message: 'Google Drive OAuth credentials not configured.',
      totalFiles: 0,
      totalSizeBytes: 0,
      totalSizeFormatted: '0 B',
      files: [],
    });
  }

  if (!hasAuth && isDemo) {
    const { GDRIVE_FOLDER_METADATA, GDRIVE_DOWNLOADED_FILES } = await import('../../src/data/gdriveDocuments');
    return res.json({
      service: 'gdrive',
      configured: false,
      available: true,
      mode: 'mock_development',
      folderId: GDRIVE_FOLDER_METADATA.folderId,
      folderUrl: GDRIVE_FOLDER_METADATA.folderUrl,
      folderName: GDRIVE_FOLDER_METADATA.folderName,
      clusterSyncPath: GDRIVE_FOLDER_METADATA.clusterSyncPath,
      totalFiles: GDRIVE_DOWNLOADED_FILES.length,
      totalSizeBytes: GDRIVE_FOLDER_METADATA.totalSizeBytes,
      totalSizeFormatted: GDRIVE_FOLDER_METADATA.totalSizeFormatted,
      lastSynced: new Date().toISOString(),
      syncState: 'demo_fixtures',
      files: GDRIVE_DOWNLOADED_FILES.map((f) => ({
        id: f.id,
        name: f.name,
        sizeBytes: f.sizeBytes,
        mimeType: f.mimeType,
        category: f.category,
        downloadStatus: f.downloadStatus,
        checksumSha256: f.checksumSha256,
        extractedFieldsCount: f.extractedFieldsCount,
        institution: f.institution,
        docType: f.docType,
      })),
    });
  }

  // Live Drive status will be implemented in Stage 29
  return res.status(501).json({
    service: 'gdrive',
    error: 'NOT_IMPLEMENTED',
    message: 'Live Google Drive integration pending Stage 29 implementation.',
  });
});

// POST /api/gdrive/sync
gdriveRouter.post('/sync', async (req: Request, res: Response) => {
  if (!isDriveAuthenticated(req)) {
    return res.status(412).json({
      error: 'PRECONDITION_FAILED',
      code: 'GDRIVE_UNCONFIGURED',
      service: 'gdrive',
      message: 'Unauthenticated Google Drive sync: OAuth credentials or active session required.',
      available: false,
      mode: 'unconfigured',
    });
  }

  // Live Drive sync implementation (Stage 29)
  return res.status(501).json({
    service: 'gdrive',
    error: 'NOT_IMPLEMENTED',
    message: 'Live Google Drive sync pending Stage 29 implementation.',
  });
});
