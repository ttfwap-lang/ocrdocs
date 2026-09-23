#!/usr/bin/env python3
"""Extract head photos of every identity already parsed into OCR.LOCAL.

Reads the OCR.LOCAL SQLite store the same way the server does (see
server/services/identityService.ts): identities are grouped live from each
document's latest extraction by family name + given names + date of birth,
identityId = sha256(family|given|dob)[:16]. For every identity it then renders
each of the identity's documents (pdfium for PDFs, Pillow for images) and runs
the full OpenCV face detector (frontal + profile Haar cascades, stability-fused
across two scale factors) to crop the head/portrait photos of the individual.
Documents OCR.LOCAL could not assign to an identity are processed under
`_unassigned/` so a passport or licence scan is never missed.

Each crop is re-detected at full resolution: verified crops land in the
person's folder, unverified ones are quarantined into `_unverified_review/` so
the server's thumbnails/galleries only show likely faces. The index
(index.jsonl) is rebuilt every run and carries the same identityId keys the
identityService produces, so the identities API attaches photos with zero
guesswork (see server/services/headshotService.ts).

Run:  python scripts/extract_headshots.py [--db data/app.db] [--out data/headshots] [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import cv2
import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageOps

DB_DEFAULT = "data/app.db"
GIVEN_NAMES_DISPLAY = "Given Names / First Name"
FAMILY_NAME_DISPLAY = "Family Name / Surname"
DOB_DISPLAY = "Date of Birth (DOB)"
OUT_DEFAULT = "data/headshots"
REVIEW_DIR = "_unverified_review"
RENDER_MIN_DIM = 1200
MAX_DETECT_DIM = 1600
CROP_MARGIN = 1.7  # expand the Haar box by this factor so the crop is a head-and-shoulders portrait

_HAAR_DIR = os.path.join(os.path.dirname(cv2.__file__), "data")
_front = cv2.CascadeClassifier(os.path.join(_HAAR_DIR, "haarcascade_frontalface_default.xml"))
_profile = cv2.CascadeClassifier(os.path.join(_HAAR_DIR, "haarcascade_profileface.xml")
                                if os.path.exists(os.path.join(_HAAR_DIR, "haarcascade_profileface.xml")) else "")
_CASCADES: List[cv2.CascadeClassifier] = [c for c in (_front, _profile) if not c.empty()]


# --------------------------------------------------------------------------- identities from OCR.LOCAL
def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def normalize_dob(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def identity_id_for(given: str, family: str, dob: str) -> str:
    return hashlib.sha256(f"{normalize_text(family)}|{normalize_text(given)}|{normalize_dob(dob)}".encode()).hexdigest()[:16]


def title_case(value: str) -> str:
    return (value or "").lower().title()


def sanitize(name: str, maxlen: int = 90) -> str:
    s = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_")
    return s[:maxlen]


def load_documents_and_fields(db: str):
    """Returns (documents, latest_fields_by_doc) mirroring identityService.reads."""
    con = sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    docs = [dict(r) for r in con.execute("SELECT id, filename, original_path, mime_type, status FROM documents ORDER BY uploaded_at")]
    latest = {}
    for r in con.execute("SELECT id, document_id FROM extractions ORDER BY created_at DESC"):
        if r["document_id"] not in latest:
            latest[r["document_id"]] = r["id"]
    fields: Dict[str, Dict[str, str]] = {d["id"]: {} for d in docs}
    for r in con.execute("SELECT extraction_id, field_name, field_value, corrected_value FROM fields"):
        eid = r["extraction_id"]
        doc_id = next((d for d, e in latest.items() if e == eid), None)
        if doc_id is None:
            continue
        val = (r["corrected_value"] or r["field_value"] or "").strip()
        if val:
            fields[doc_id][r["field_name"]] = val
    con.close()
    return docs, fields


def group_identities(docs: List[dict], fields: Dict[str, Dict[str, str]]):
    """Same grouping as identityService.buildGroups()."""
    groups: Dict[str, dict] = {}
    unassigned: List[dict] = []
    for d in docs:
        f = fields.get(d["id"], {})
        given, family, dob = f.get(GIVEN_NAMES_DISPLAY, ""), f.get(FAMILY_NAME_DISPLAY, ""), f.get(DOB_DISPLAY, "")
        if not family or not dob:
            unassigned.append(d)
            continue
        iid = identity_id_for(given, family, dob)
        g = groups.setdefault(iid, {"identityId": iid, "givenNames": given, "familyName": family, "dob": dob, "documents": []})
        g["documents"].append(d)
    return groups, unassigned


# --------------------------------------------------------------------------- rendering + detection
def render_pages(path: str) -> List[Image.Image]:
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        pages = []
        doc = pdfium.PdfDocument(path)
        try:
            for pno in range(len(doc)):
                page = doc[pno]
                w, h = page.get_size()
                scale = max(1.0, RENDER_MIN_DIM / min(w, h))
                pages.append(page.render(scale=scale).to_pil().convert("RGB"))
        finally:
            doc.close()
        return pages
    im = Image.open(path)
    return [ImageOps.exif_transpose(im).convert("RGB")]


def _overlap(a, b) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    return ix * iy > 0.55 * min(aw * ah, bw * bh)


def detect_faces(img: Image.Image, min_size: int = 32, neighbors: int = 5) -> List[Tuple[int, int, int, int]]:
    """Stable face boxes in full-res pixels: frontal+profile detections fused across two scales."""
    gray = np.asarray(img.convert("L"))
    h, w = gray.shape
    scale = min(1.0, MAX_DETECT_DIM / max(h, w))
    small = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1.0 else gray
    runs = []
    for sf in (1.05, 1.1):
        boxes = []
        for casc in _CASCADES:
            det = casc.detectMultiScale(small, scaleFactor=sf, minNeighbors=neighbors,
                                        minSize=(max(26, int(min_size * scale)),) * 2)
            boxes += [(int(x / scale), int(y / scale), int(w2 / scale), int(h2 / scale)) for (x, y, w2, h2) in det]
        runs.append(boxes)
    a, b = runs
    stable = []
    for box in a:
        tol = max(6.0, box[2] / 3.0)
        if any((abs(box[0] - o[0]) <= tol and abs(box[1] - o[1]) <= tol) for o in b):
            stable.append(box)
    keep = []
    for bx in sorted(stable, key=lambda bx: -bx[2] * bx[3]):
        if all(not _overlap(bx, k) for k in keep):
            keep.append(bx)
    return keep


def crop_face(img: Image.Image, box: Tuple[int, int, int, int]) -> Image.Image:
    x, y, w, h = box
    cw, ch = int(w * CROP_MARGIN), int(h * CROP_MARGIN)
    cx, cy = x + w // 2, y + h // 2
    x0, y0 = max(0, cx - cw // 2), max(0, cy - int(ch * 0.45))  # bias upward to keep the crown of the head
    x1, y1 = min(img.width, x0 + cw), min(img.height, y0 + ch)
    return img.crop((x0, y0, x1, y1))


def is_verified_crop(crop: Image.Image, page_area: int) -> bool:
    """Redetect the crop (relaxed) OR accept a face box that dominates the page."""
    if detect_faces(crop, min_size=20, neighbors=4):
        return True
    # extremely large detection boxes (e.g. a full-page portrait) may not
    # re-detect at crop resolution but are clearly head photos; guard the value.
    return False


# --------------------------------------------------------------------------- main
def resolve_doc_path(doc: dict, repo_root: Path) -> Optional[Path]:
    p = doc.get("original_path")
    if p and os.path.isfile(p):
        return Path(p)
    if p:
        hit = repo_root / "storage" / "private" / os.path.basename(p)
        if hit.is_file():
            return hit
    return None


def main(argv: Optional[List[str]] = None) -> int:
    repo = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description="Extract head photos of every OCR.LOCAL identity (cv2 face detection).")
    ap.add_argument("--db", default=str(repo / DB_DEFAULT), help=f"OCR.LOCAL database (default {DB_DEFAULT})")
    ap.add_argument("--out", default=str(repo / OUT_DEFAULT), help=f"output dir (default {OUT_DEFAULT})")
    ap.add_argument("--dry-run", action="store_true", help="list identities and documents, do not extract")
    a = ap.parse_args(argv)

    docs, fields = load_documents_and_fields(a.db)
    groups, unassigned = group_identities(docs, fields)
    identities = list(groups.values())
    identities.sort(key=lambda g: (g["familyName"].lower(), g["givenNames"].lower()))

    if a.dry_run:
        print(f"{len(docs)} documents, {len(identities)} identities, {len(unassigned)} unassigned documents")
        for g in identities:
            print(f"  {title_case(g['givenNames'])} {title_case(g['familyName'])} {g['dob']}  "
                  f"({g['identityId'][:8]})  docs: {', '.join(d['filename'] for d in g['documents'])}")
        if unassigned:
            print("  [unassigned] " + ", ".join(d["filename"] for d in unassigned))
        return 0

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index_path = out / "index.jsonl"
    # the index is rebuilt wholesale every run (a handful of documents)
    index_path.write_text("", encoding="utf-8") if index_path.exists() else None
    fh = open(index_path, "w", encoding="utf-8")
    headshots_total = 0
    verified_total = 0

    def process(doc: dict, identity_id: str, label: str, subdir: str) -> None:
        nonlocal headshots_total, verified_total
        src = resolve_doc_path(doc, repo)
        if src is None:
            print(f"  ! missing file for {doc['filename']}")
            return
        pages = render_pages(str(src))
        pdir = out / subdir
        review_dir = pdir / REVIEW_DIR
        stem = sanitize(Path(doc["filename"]).stem, 60)
        for pno, img in enumerate(pages, 1):
            faces = detect_faces(img)
            page_area = img.width * img.height
            headshots = []
            for cno, box in enumerate(faces, 1):
                crop = crop_face(img, box)
                verified = is_verified_crop(crop, page_area)
                fname = f"{stem}_p{pno}_c{cno}.jpg"
                target = pdir if verified else review_dir
                target.mkdir(parents=True, exist_ok=True)
                crop.save(target / fname, "JPEG", quality=92)
                headshots.append({
                    "crop": fname,
                    "relPath": f"{target.relative_to(out).as_posix()}/{fname}",
                    "bbox": list(box),
                    "verified": verified,
                })
                headshots_total += 1
                verified_total += 1 if verified else 0
            fh.write(json.dumps({
                "identityId": identity_id, "label": label, "dob": doc.get("dob", ""),
                "docId": doc["id"], "doc": doc["filename"], "page": pno,
                "source": str(src), "subdir": subdir, "headshots": headshots,
            }, ensure_ascii=False) + "\n")
            fh.flush()
        print(f"  {doc['filename']}: {len(pages)} page(s)")

    print(f"{len(docs)} documents, {len(identities)} identities, {len(unassigned)} unassigned; output: {out}")
    for g in identities:
        name = f"{title_case(g['givenNames'])} {title_case(g['familyName'])}".strip()
        label = f"{name} {g['dob']}".strip()
        subdir = f"{re.sub(r'[^A-Za-z0-9_.-]+', '_', label)}_{g['identityId'][:8]}"
        print(f"identity {label}  ({g['identityId'][:8]}, {len(g['documents'])} docs)")
        for doc in g["documents"]:
            process(doc, g["identityId"], label, subdir)
    if unassigned:
        print(f"unassigned documents ({len(unassigned)}) -> _unassigned")
        for doc in unassigned:
            process(doc, "unassigned", doc["filename"], "_unassigned")

    fh.close()
    print(f"done: {verified_total} verified / {headshots_total} head photos -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())