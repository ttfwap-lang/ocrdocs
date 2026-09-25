/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verified rear-side driver-licence evidence, kept separate from headshots.
 * The sidecar index is produced by scripts/attach_rear_licences.py and is
 * private runtime data; only the opaque card/page asset URLs and document
 * metadata are exposed through the API.
 */

import fs from "node:fs";
import path from "node:path";

export interface RearLicenceEvidence {
  occurrenceKey: string;
  documentId: string;
  identityId: string;
  document: string;
  page: number;
  part: string;
  cardUrl: string;
  pageUrl: string;
  cardAsset: string;
  pageAsset: string;
  bbox: number[];
  modelDecision: string;
  modelConfidence: number | null;
}

export interface RearLicenceService {
  forIdentity(identityId: string): RearLicenceEvidence[];
  forDocument(documentId: string): RearLicenceEvidence[];
}

function safeAssetUrl(asset: string): string | null {
  const normalized = asset.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === ".")) {
    return null;
  }
  const encoded = normalized.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/rear-licences/assets/${encoded}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createRearLicenceService(root: string): RearLicenceService {
  const indexFile = path.join(root, "index.jsonl");
  let cache: { mtimeMs: number; byIdentity: Map<string, RearLicenceEvidence[]>; byDocument: Map<string, RearLicenceEvidence[]> } | null = null;

  function load() {
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(indexFile).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    if (cache && cache.mtimeMs === mtimeMs) return cache;

    const byIdentity = new Map<string, RearLicenceEvidence[]>();
    const byDocument = new Map<string, RearLicenceEvidence[]>();
    if (mtimeMs >= 0) {
      const text = fs.readFileSync(indexFile, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const occurrenceKey = asString(raw.occurrenceKey);
        const documentId = asString(raw.documentId);
        const identityId = asString(raw.identityId);
        const cardAsset = asString(raw.cardAsset);
        const pageAsset = asString(raw.pageAsset);
        const cardUrl = safeAssetUrl(cardAsset);
        const pageUrl = safeAssetUrl(pageAsset);
        if (!occurrenceKey || !documentId || !identityId || !cardUrl || !pageUrl) continue;
        const bbox = Array.isArray(raw.bbox)
          ? raw.bbox.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          : [];
        const evidence: RearLicenceEvidence = {
          occurrenceKey,
          documentId,
          identityId,
          document: asString(raw.document),
          page: typeof raw.page === "number" && Number.isFinite(raw.page) ? raw.page : 0,
          part: asString(raw.part),
          cardUrl,
          pageUrl,
          cardAsset,
          pageAsset,
          bbox,
          modelDecision: asString(raw.modelDecision),
          modelConfidence: asNumber(raw.modelConfidence),
        };
        for (const [map, key] of [[byIdentity, identityId], [byDocument, documentId]] as const) {
          const values = map.get(key);
          if (values) values.push(evidence);
          else map.set(key, [evidence]);
        }
      }
      for (const values of [...byIdentity.values(), ...byDocument.values()]) {
        values.sort((a, b) => a.document.localeCompare(b.document) || a.page - b.page || a.occurrenceKey.localeCompare(b.occurrenceKey));
      }
    }
    cache = { mtimeMs, byIdentity, byDocument };
    return cache;
  }

  return {
    forIdentity(identityId: string): RearLicenceEvidence[] {
      return load().byIdentity.get(identityId) ?? [];
    },
    forDocument(documentId: string): RearLicenceEvidence[] {
      return load().byDocument.get(documentId) ?? [];
    },
  };
}

export type RearLicenceServiceType = ReturnType<typeof createRearLicenceService>;
