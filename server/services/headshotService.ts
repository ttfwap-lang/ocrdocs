/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Head photos extracted per person by scripts/extract_headshots.py, served to
 * the identities UI. The extractor writes <headshotsRoot>/index.jsonl, one line
 * per (document, page), keyed by the SAME identityId hash identityService
 * derives (sha256 of family|given|dob) -- so a summary can attach a thumbnail
 * and a detail page a full gallery with zero guesswork. Documents that could
 * not be grouped (no name+DOB) are still indexed under their documentId, which
 * is how an unassigned passport scan gets its photos shown.
 *
 * Only verified, currently-grouped crops are returned by photosForIdentity().
 * Detector-unverified crops remain available by document and in the review
 * method, but can never become an identity thumbnail or identity gallery item.
 *
 * The store is re-read whenever index.jsonl's mtime changes, so re-running
 * the extractor while the server is up is visible on the next request.
 */

import fs from "node:fs";
import path from "node:path";

export type PhotoAssignmentState = "assigned" | "unassigned" | "needs_review";

/** A single extracted head photo, as surfaced through /api/identities. */
export interface IdentityPhoto {
  /** Crop filename, e.g. "passport_p1_c1.jpg". */
  crop: string;
  /** URL under the static /headshots mount, e.g. "/headshots/_unassigned/passport_p1_c1.jpg". */
  url: string;
  /** Path relative to the headshots root (useful for fs ops). */
  relPath: string;
  documentId: string;
  /** Opaque derived grouping key; null when the document is unassigned. */
  identityId: string | null;
  assignmentState: PhotoAssignmentState;
  /** Original source document filename the crop came from. */
  document: string;
  page: number;
  bbox: number[];
  /** True when the crop re-detected a face (scripts/extract_headshots.py fusion pass). */
  verified: boolean;
  /** Absolute path of the source document the photo was cut from (never expose this in API responses). */
  source: string;
}

export interface HeadshotService {
  photosForIdentity(identityId: string): IdentityPhoto[];
  photosForDocument(documentId: string): IdentityPhoto[];
  reviewPhotos(): IdentityPhoto[];
  allPhotos(): IdentityPhoto[];
}

function photoUrl(subdir: string | undefined, crop: string): string {
  const segs = [subdir || "_unassigned", crop].filter(Boolean)
    .map((s) => s.split("/").map(encodeURIComponent).join("/"));
  return `/headshots/${segs.join("/")}`;
}

function assignmentState(identityId: string, verified: boolean): PhotoAssignmentState {
  if (!identityId) return "unassigned";
  return verified ? "assigned" : "needs_review";
}

export function createHeadshotService(headshotsRoot: string): HeadshotService {
  const indexFile = path.join(headshotsRoot, "index.jsonl");
  let cache: {
    mtimeMs: number;
    all: IdentityPhoto[];
    byIdentity: Map<string, IdentityPhoto[]>;
    byDocument: Map<string, IdentityPhoto[]>;
  } | null = null;

  function load() {
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(indexFile).mtimeMs;
    } catch {
      mtimeMs = -1; // no store yet -- every identity simply has no photos
    }
    if (cache && cache.mtimeMs === mtimeMs) {
      return cache;
    }
    const all: IdentityPhoto[] = [];
    const byIdentity = new Map<string, IdentityPhoto[]>();
    const byDocument = new Map<string, IdentityPhoto[]>();
    if (mtimeMs >= 0) {
      const text = fs.readFileSync(indexFile, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let rec: Record<string, unknown>;
        try {
          rec = JSON.parse(line);
        } catch {
          continue; // tolerate a trailing partial line from an interrupted run
        }
        const docId = String(rec.docId ?? "");
        const identityId = String(rec.identityId ?? "");
        const subdir = rec.subdir ? String(rec.subdir) : undefined;
        const faces = Array.isArray(rec.headshots) ? rec.headshots : [];
        for (const f of faces) {
          if (!f || typeof f !== "object") continue;
          const crop = String((f as { crop?: unknown }).crop ?? "");
          if (!crop) continue;
          const verified = Boolean((f as { verified?: unknown }).verified);
          const photo: IdentityPhoto = {
            crop,
            url: photoUrl(subdir, crop),
            relPath: (f as { relPath?: unknown }).relPath
              ? String((f as { relPath?: unknown }).relPath)
              : path.posix.join(subdir || "_unassigned", crop),
            documentId: docId,
            identityId: identityId || null,
            assignmentState: assignmentState(identityId, verified),
            document: String(rec.doc ?? ""),
            page: Number(rec.page ?? 0) || 0,
            bbox: Array.isArray((f as { bbox?: unknown }).bbox) ? (f as { bbox: number[] }).bbox : [],
            verified,
            source: String(rec.source ?? ""),
          };
          all.push(photo);
          // An identity gallery is deliberately limited to a verified crop
          // whose current derived grouping is known. Unverified crops are
          // review material, not identity evidence.
          if (identityId && verified) {
            const values = byIdentity.get(identityId);
            if (values) values.push(photo);
            else byIdentity.set(identityId, [photo]);
          }
          if (docId) {
            const values = byDocument.get(docId);
            if (values) values.push(photo);
            else byDocument.set(docId, [photo]);
          }
        }
      }
    }
    for (const arr of [all, ...byIdentity.values(), ...byDocument.values()]) {
      arr.sort((a, b) => Number(b.verified) - Number(a.verified) || a.document.localeCompare(b.document) || a.page - b.page);
    }
    cache = { mtimeMs, all, byIdentity, byDocument };
    return cache;
  }

  return {
    photosForIdentity(identityId: string): IdentityPhoto[] {
      return load().byIdentity.get(identityId) ?? [];
    },
    photosForDocument(documentId: string): IdentityPhoto[] {
      return load().byDocument.get(documentId) ?? [];
    },
    reviewPhotos(): IdentityPhoto[] {
      return load().all.filter((photo) => photo.assignmentState !== "assigned");
    },
    allPhotos(): IdentityPhoto[] {
      return load().all;
    },
  };
}

export type HeadshotServiceType = ReturnType<typeof createHeadshotService>;
