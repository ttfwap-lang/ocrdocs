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
 * The store is re-read whenever index.jsonl's mtime changes, so re-running the
 * extractor while the server is up is visible on the next request.
 */

import fs from "node:fs";
import path from "node:path";

/** A single extracted head photo, as surfaced through /api/identities. */
export interface IdentityPhoto {
  /** Crop filename, e.g. "passport_p1_c1.jpg". */
  crop: string;
  /** URL under the static /headshots mount, e.g. "/headshots/_unassigned/passport_p1_c1.jpg". */
  url: string;
  /** Path relative to the headshots root (useful for fs ops). */
  relPath: string;
  documentId: string;
  /** Original source document filename the crop came from. */
  document: string;
  page: number;
  bbox: number[];
  /** True when the crop re-detected a face (scripts/extract_headshots.py fusion pass). */
  verified: boolean;
  /** Absolute path of the source document the photo was cut from. */
  source: string;
}

export interface HeadshotService {
  photosForIdentity(identityId: string): IdentityPhoto[];
  photosForDocument(documentId: string): IdentityPhoto[];
}

function photoUrl(subdir: string | undefined, crop: string): string {
  const segs = [subdir || "_unassigned", crop].filter(Boolean)
    .map((s) => s.split("/").map(encodeURIComponent).join("/"));
  return `/headshots/${segs.join("/")}`;
}

export function createHeadshotService(headshotsRoot: string): HeadshotService {
  const indexFile = path.join(headshotsRoot, "index.jsonl");
  let cache: { mtimeMs: number; byIdentity: Map<string, IdentityPhoto[]>; byDocument: Map<string, IdentityPhoto[]> } | null = null;

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
          const photo: IdentityPhoto = {
            crop,
            url: photoUrl(subdir, crop),
            relPath: (f as { relPath?: unknown }).relPath
              ? String((f as { relPath?: unknown }).relPath)
              : path.posix.join(subdir || "_unassigned", crop),
            documentId: docId,
            document: String(rec.doc ?? ""),
            page: Number(rec.page ?? 0) || 0,
            bbox: Array.isArray((f as { bbox?: unknown }).bbox) ? (f as { bbox: number[] }).bbox : [],
            verified: Boolean((f as { verified?: unknown }).verified),
            source: String(rec.source ?? ""),
          };
          for (const map of [byIdentity, byDocument]) {
            const key = map === byIdentity ? identityId : docId;
            if (!key) continue;
            const arr = map.get(key);
            if (arr) arr.push(photo);
            else map.set(key, [photo]);
          }
        }
      }
      for (const map of [byIdentity, byDocument]) {
        for (const arr of map.values()) {
          arr.sort((a, b) => Number(b.verified) - Number(a.verified) || a.document.localeCompare(b.document) || a.page - b.page);
        }
      }
    }
    cache = { mtimeMs, byIdentity, byDocument };
    return cache;
  }

  return {
    photosForIdentity(identityId: string): IdentityPhoto[] {
      return load().byIdentity.get(identityId) ?? [];
    },
    photosForDocument(documentId: string): IdentityPhoto[] {
      return load().byDocument.get(documentId) ?? [];
    },
  };
}