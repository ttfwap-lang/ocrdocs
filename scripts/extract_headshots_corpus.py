#!/usr/bin/env python3
"""Bulk head-photo extraction over the Recovered_C corpus, keyed to LlamaCloud identities.

Reads the LlamaCloud bulk-parse output (rc_extract.jsonl / rc_extract_verified.jsonl), where every
successful document row carries extracted fields tagged with a `subject` (applicant, spouse, parent,
referee, employer, other) and name fields (given_names, family_name, middle_name, date_of_birth,
title_salutation). For every document it then:

  1. resolves the original file under the corpus root,
  2. renders each page (pypdfium2 for PDF, Pillow for images),
  3. runs the full OpenCV face detector (frontal + profile Haar cascades) with a stability fusion
     across two scaleFactors to suppress false positives,
  4. crops each stable head photo and saves it under data/headshots_corpus/<Person>_<subject>/,
  5. attributes the page's faces to the document's subjects (primary subject = applicant if present).

Documents the parse could not assign a subject to go to _unassigned/<doc>/. Non-renderable files
(docx etc.) are recorded but skipped. Re-running only processes files not already in index.jsonl
(use --force to redo). Covers whatever is in the input file so far, so it can be run again after
the cloud parse finishes to pick up the remaining documents.

Run:  python extract_headshots_corpus.py [--in results/rc_extract.jsonl] [--out data/headshots_corpus] [--workers 8] [--force]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import json
import os
import re
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

CORPUS_DEFAULT = r"C:\Users\lnxzf\Desktop\Recovered_C"
IN_DEFAULT = r"results\rc_extract.jsonl"
OUT_DEFAULT = r"data\headshots_corpus"
RENDER_MIN_DIM = 1200        # render pages so the shorter side is at least this many px
MAX_DETECT_DIM = 1600        # detection downscale cap
CROP_MARGIN = 1.7            # expand the Haar box so crops are head-and-shoulders portraits

NAME_FIELDS = {"given_names", "family_name", "middle_name", "title_salutation", "date_of_birth"}
SUBJECT_ORDER = ["applicant", "spouse", "joint_applicant", "co_applicant", "parent", "referee",
                 "guarantor", "employer", "other"]

_HAAR_DIR = os.path.join(os.path.dirname(cv2.__file__), "data")
_front = cv2.CascadeClassifier(os.path.join(_HAAR_DIR, "haarcascade_frontalface_default.xml"))
_profile = cv2.CascadeClassifier(os.path.join(_HAAR_DIR, "haarcascade_profileface.xml")
                                if os.path.exists(os.path.join(_HAAR_DIR, "haarcascade_profileface.xml")) else "")
_CASCADES: List[cv2.CascadeClassifier] = [c for c in (_front, _profile) if not c.empty()]


def person_label(subject: str, fields_for_subject: Dict[str, str]) -> str:
    """e.g. 'Applicant John Smith' or 'Unnamed applicant'."""
    given = fields_for_subject.get("given_names", "").strip()
    family = fields_for_subject.get("family_name", "").strip()
    name = " ".join(x for x in (given, family) if x)
    name = re.sub(r"\s+", " ", name).title()
    subj = subject if subject and subject != "other" else "applicant"
    return f"{subj} {name}".strip() if name else f"unassigned_{subj}"


def sanitize(name: str, maxlen: int = 90) -> str:
    s = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_")
    return s[:maxlen]


def resolve_file(row: dict, corpus: Path) -> Optional[Path]:
    f = row.get("file") or ""
    p = Path(f)
    if p.is_file():
        return p
    cand = corpus / p.name
    return cand if cand.is_file() else None


def render_pages(path: Path) -> List[Image.Image]:
    ext = path.suffix.lower()
    if ext == ".pdf":
        pages = []
        doc = pdfium.PdfDocument(str(path))
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


def _match(box, boxes, tol) -> bool:
    for o in boxes:
        if (abs(box[0] - o[0]) < tol and abs(box[1] - o[1]) < tol):
            return True
    return False


def detect_faces(img: Image.Image) -> List[Tuple[int, int, int, int]]:
    """Stable face boxes in full-res pixels: frontal+profile detections fused across two scales."""
    gray = np.asarray(img.convert("L"))
    h, w = gray.shape
    scale = min(1.0, MAX_DETECT_DIM / max(h, w))
    small = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1.0 else gray
    runs = []
    for sf in (1.05, 1.1):
        boxes = []
        for casc in _CASCADES:
            det = casc.detectMultiScale(small, scaleFactor=sf, minNeighbors=5,
                                        minSize=(max(26, int(32 * scale)),) * 2)
            boxes += [(int(x / scale), int(y / scale), int(w2 / scale), int(h2 / scale)) for (x, y, w2, h2) in det]
        runs.append(boxes)
    # keep boxes present in both scale runs (center within 1/3 of box) -> suppresses flicker FPs
    a, b = runs
    stable = []
    for box in a:
        tol = max(6.0, box[2] / 3.0)
        if any((abs(box[0] - o[0]) <= tol and abs(box[1] - o[1]) <= tol) for o in b):
            stable.append(box)
    # de-duplicate overlapping stable boxes (front+profile both firing)
    keep = []
    for bx in sorted(stable, key=lambda bx: -bx[2] * bx[3]):
        if all(not _overlap(bx, k) for k in keep):
            keep.append(bx)
    return keep


def _overlap(a, b) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    return ix * iy > 0.55 * min(aw * ah, bw * bh)


def crop_face(img: Image.Image, box: Tuple[int, int, int, int]) -> Image.Image:
    x, y, w, h = box
    cw, ch = int(w * CROP_MARGIN), int(h * CROP_MARGIN)
    cx, cy = x + w // 2, y + h // 2
    x0, y0 = max(0, cx - cw // 2), max(0, cy - int(ch * 0.45))
    x1, y1 = min(img.width, x0 + cw), min(img.height, y0 + ch)
    return img.crop((x0, y0, x1, y1))


def subjects_for(row: dict) -> List[Dict]:
    """Per-subject name parts for a document row."""
    by: Dict[str, Dict[str, str]] = {}
    for f in row.get("fields") or []:
        subj = f.get("subject") or ""
        if not subj:
            continue
        d = by.setdefault(subj, {})
        if f.get("name") in NAME_FIELDS and f.get("value"):
            d[f["name"]] = str(f["value"])
    return [{"subject": s, "fields": by[s]} for s in sorted(by, key=lambda s: SUBJECT_ORDER.index(s) if s in SUBJECT_ORDER else 99)]


def primary_dir(subjects: List[Dict], doc_stem: str) -> str:
    if subjects:
        return sanitize(person_label(subjects[0]["subject"], subjects[0]["fields"]))
    return sanitize("_unassigned_" + doc_stem)


def process_row(row: dict, corpus: Path, out: Path) -> dict:
    """Renders + detects one document; writes crops; returns an index record (empty faces -> None)."""
    src = resolve_file(row, corpus)
    if src is None:
        return {"file": row.get("file"), "doc_type": row.get("document_type"), "record": None, "note": "missing"}
    try:
        pages = render_pages(src)
    except Exception as e:  # noqa: BLE001
        return {"file": row.get("file"), "doc_type": row.get("document_type"), "record": None,
                "note": "render_failed", "detail": repr(e)[:200]}
    if not pages:
        return {"file": row.get("file"), "doc_type": row.get("document_type"), "record": None, "note": "no_pages"}
    subjects = subjects_for(row)
    pdir = out / primary_dir(subjects, src.stem)
    pdir.mkdir(parents=True, exist_ok=True)
    stem = sanitize(src.stem, 60)
    faces_out = []
    for pno, img in enumerate(pages, 1):
        boxes = detect_faces(img)
        for cno, box in enumerate(boxes, 1):
            crop = crop_face(img, box)
            cp = pdir / f"{stem}_p{pno}_c{cno}.jpg"
            crop.save(cp, "JPEG", quality=92)
            faces_out.append({"page": pno, "crop": cp.name, "bbox": list(box),
                              "crop_size": list(crop.size)})
    record = {
        "file": str(src), "doc_type": row.get("document_type"),
        "subjects": [{"subject": s["subject"], **{k: v for k, v in s["fields"].items()}} for s in subjects],
        "n_pages": len(pages), "headshots": faces_out,
    }
    return {"file": row.get("file"), "doc_type": row.get("document_type"), "record": record,
            "note": "ok" if faces_out else "no_faces"}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Bulk head-photo extraction keyed to LlamaCloud identities.")
    ap.add_argument("--in", dest="inp", default=IN_DEFAULT, help="LlamaCloud bulk parse output JSONL")
    ap.add_argument("--out", default=OUT_DEFAULT, help="output directory for crops + index")
    ap.add_argument("--corpus", default=CORPUS_DEFAULT, help="corpus root for original files")
    ap.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 4), help="parallel workers")
    ap.add_argument("--force", action="store_true", help="reprocess files already in index.jsonl")
    a = ap.parse_args(argv)

    inp = Path(a.inp)
    corpus = Path(a.corpus)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index_path = out / "index.jsonl"
    done = set()
    if index_path.exists() and not a.force:
        for line in index_path.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                if r.get("file"):
                    done.add(r["file"])
            except json.JSONDecodeError:
                pass

    rows = [json.loads(l) for l in inp.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r.get("ok")]
    todo = [r for r in rows if r.get("file") not in done]
    print(f"{len(rows)} parsed documents, {len(todo)} to process (writing crops under {out})")

    fh = open(index_path, "a", encoding="utf-8")
    stats = {"ok": 0, "no_faces": 0, "missing": 0, "render_failed": 0, "no_pages": 0, "headshots": 0, "face_docs": 0}

    def emit(res: dict) -> None:
        rec = res["record"]
        key = res.get("note")
        stats[key] = stats.get(key, 0) + 1
        line = {"file": res["file"], "doc_type": res["doc_type"], "note": key,
                "detail": res.get("detail"), "record": rec}
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")
        fh.flush()
        if rec and rec.get("headshots"):
            stats["headshots"] += len(rec["headshots"])
            stats["face_docs"] += 1
        n = rec["n_pages"] if rec else 0
        hs = len(rec["headshots"]) if rec else 0
        print(f"  {Path(res['file']).name[:70]:<70} pages={n:<3} headshots={hs}")

    if a.workers > 1:
        with cf.ProcessPoolExecutor(max_workers=a.workers) as ex:
            futs = [ex.submit(process_row, r, corpus, out) for r in todo]
            for fut in cf.as_completed(futs):
                emit(fut.result())
    else:
        for r in todo:
            emit(process_row(r, corpus, out))
    fh.close()

    with open(out / "summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["person", "doc", "doc_type", "pages", "headshots", "pages_with_faces"])
        agg: Dict[str, dict] = {}
        for line in Path(index_path).read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            rec = r.get("record")
            if not rec:
                continue
            for s in rec["subjects"]:
                label = person_label(s["subject"], s)
                key = (label, rec["file"])
                a2 = agg.setdefault(key, {"label": label, "file": rec["file"], "doc_type": rec.get("doc_type"),
                                          "pages": rec["n_pages"], "headshots": 0, "fp": set()})
                a2["headshots"] += len(rec["headshots"])
                a2["fp"].update(h["page"] for h in rec["headshots"])
        for key in sorted(agg):
            a2 = agg[key]
            w.writerow([a2["label"], Path(a2["file"]).name, a2["doc_type"], a2["pages"],
                        a2["headshots"], len(a2["fp"])])
        # unassigned (no subjects) docs
        for line in Path(index_path).read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            rec = r.get("record")
            if rec and not rec["subjects"]:
                w.writerow(["_unassigned/" + sanitize(Path(rec["file"]).stem), Path(rec["file"]).name,
                            rec.get("doc_type"), rec["n_pages"], len(rec["headshots"]),
                            len({h["page"] for h in rec["headshots"]})])
    print(f"\ndone: {stats['face_docs']} docs with headshots, {stats['no_faces']} no faces, "
          f"{stats['missing']} missing, {stats['render_failed']} render failures; "
          f"{stats['headshots']} head photos total")
    print(f"index: {index_path}  summary: {out / 'summary.csv'}")
    return 0


if __name__ == "__main__":
    main()