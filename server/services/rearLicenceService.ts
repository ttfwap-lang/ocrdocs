/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rear-side driver-licence evidence, kept separate from headshots.
 *
 * The sidecar is a private review index. Rows with a reliable current identity
 * are returned by forIdentity(); rows without one are still returned by the
 * document/unassigned review methods, but are never promoted into an identity
 * gallery. The service never infers identity from a filename or a visual match.
 */

import fs from "node:fs";
import path from "node:path";

export type RearAssignmentState = "assigned" | "unassigned" | "needs_review";
export type RearVerificationState = "verified" | "needs_review";

export interface RearLicenceEvidence {
  occurrenceKey: string;
  documentId: string | null;
  identityId: string | null;
  assignmentState: RearAssignmentState;
  verificationState: RearVerificationState;
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
  forUnassigned(): RearLicenceEvidence[];
  forReview(): RearLicenceEvidence[];
  all(): RearLicenceEvidence[];
}

/**
 * Convert an index-relative asset path to the URL under the private assets
 * mount. The Python bridge historically wrote paths as `assets/cards/...`,
 * while the mount is already rooted at `.../assets`; strip that one prefix so
 * the browser does not request `/assets/assets/...`.
 */
function safeAssetUrl(asset: string): string | null {
  const normalized = asset.replace(/\\/g, "/");
  const relative = normalized.startsWith("assets/")
    ? normalized.slice("assets/".length)
    : normalized;
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => part === ".." || part === ".")
  ) {
    return null;
  }
  const encoded = relative.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/rear-licences/assets/${encoded}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asAssignmentState(value: unknown, identityId: string | null, decision: string): RearAssignmentState {
  if (value === "assigned" || value === "unassigned" || value === "needs_review") return value;
  if (identityId) return "assigned";
  return decision === "review" ? "needs_review" : "unassigned";
}

function asVerificationState(value: unknown, decision: string): RearVerificationState {
  if (value === "verified" || value === "needs_review") return value;
  return decision === "confirmed" ? "verified" : "needs_review";
}

export function createRearLicenceService(root: string): RearLicenceService {
  const indexFile = path.join(root, "index.jsonl");
  let cache: {
    mtimeMs: number;
    all: RearLicenceEvidence[];
    byIdentity: Map<string, RearLicenceEvidence[]>;
    byDocument: Map<string, RearLicenceEvidence[]>;
  } | null = null;

  function load() {
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(indexFile).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    if (cache && cache.mtimeMs === mtimeMs) return cache;

    const all: RearLicenceEvidence[] = [];
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
        const documentId = asNullableString(raw.documentId);
        const identityId = asNullableString(raw.identityId);
        const cardAsset = asString(raw.cardAsset);
        const pageAsset = asString(raw.pageAsset);
        const cardUrl = safeAssetUrl(cardAsset);
        const pageUrl = safeAssetUrl(pageAsset);
        if (!occurrenceKey || !cardUrl || !pageUrl) continue;
        const modelDecision = asString(raw.modelDecision);
        const bbox = Array.isArray(raw.bbox)
          ? raw.bbox.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          : [];
        const evidence: RearLicenceEvidence = {
          occurrenceKey,
          documentId,
          identityId,
          assignmentState: asAssignmentState(raw.assignmentState, identityId, modelDecision),
          verificationState: asVerificationState(raw.verificationState, modelDecision),
          document: asString(raw.document),
          page: typeof raw.page === "number" && Number.isFinite(raw.page) ? raw.page : 0,
          part: asString(raw.part),
          cardUrl,
          pageUrl,
          cardAsset,
          pageAsset,
          bbox,
          modelDecision,
          modelConfidence: asNumber(raw.modelConfidence),
        };
        all.push(evidence);
        if (identityId) {
          const values = byIdentity.get(identityId);
          if (values) values.push(evidence);
          else byIdentity.set(identityId, [evidence]);
        }
        if (documentId) {
          const values = byDocument.get(documentId);
          if (values) values.push(evidence);
          else byDocument.set(documentId, [evidence]);
        }
      }
    }

    all.sort((a, b) => a.document.localeCompare(b.document) || a.page - b.page || a.occurrenceKey.localeCompare(b.occurrenceKey));
    for (const values of [...byIdentity.values(), ...byDocument.values()]) {
      values.sort((a, b) => a.document.localeCompare(b.document) || a.page - b.page || a.occurrenceKey.localeCompare(b.occurrenceKey));
    }
    cache = { mtimeMs, all, byIdentity, byDocument };
    return cache;
  }

  return {
    forIdentity(identityId: string): RearLicenceEvidence[] {
      return load().byIdentity.get(identityId) ?? [];
    },
    forDocument(documentId: string): RearLicenceEvidence[] {
      return load().byDocument.get(documentId) ?? [];
    },
    forUnassigned(): RearLicenceEvidence[] {
      return load().all.filter((item) => !item.identityId);
    },
    forReview(): RearLicenceEvidence[] {
      return load().all.filter((item) => item.verificationState === "needs_review" || item.assignmentState === "needs_review");
    },
    all(): RearLicenceEvidence[] {
      return load().all;
    },
  };
}

export type RearLicenceServiceType = ReturnType<typeof createRearLicenceService>;
