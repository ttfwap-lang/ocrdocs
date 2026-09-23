#!/usr/bin/env python3
"""Independent precision re-check of extracted head photos using the YuNet DNN detector.

Haar cascades can flag textures that are not faces; this tool re-runs a completely
different detector (OpenCV YuNet, a CNN trained on WIDER FACE) over every saved crop and
cross-tabs the result against the Haar "verified" flag:

  confirmed  = Haar verified AND YuNet hit   (both detectors agree -> keep)
  disputed   = Haar verified but YuNet miss  (worth a human look)
  rescued    = Haar unverified but YuNet hit (probably a real face - review the quarantine)
  rejected   = Haar unverified AND YuNet miss

It reads any extractor index that lists crops under a per-crop {"crop","path|relPath","verified"}
record: the corpus store (desktop data/headshots_corpus/index.jsonl) and the OCR.LOCAL store
(repo data/headshots/index.jsonl). Each index's parent dir is treated as its crop base, so
relative crop paths resolve. The YuNet ONNX model is fetched from opencv_zoo on first use and
cached under scripts/models/.

Run:  python scripts/yunet_check.py [--index path...] [--model scripts/models/face_detection_yunet_2023mar.onnx] [--min-score 0.6] [--out-csv results/yunet_qa.csv]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import cv2
import numpy as np
from PIL import Image

MODEL_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
MODEL_FILENAME = "face_detection_yunet_2023mar.onnx"
DEFAULT_INDICES = [
    r"C:\Users\lnxzf\Desktop\llamaparse_bulk\data\headshots_corpus\index.jsonl",
]


def ensure_model(model_path: Path) -> Path:
    if model_path.is_file():
        return model_path
    print(f"downloading YuNet model -> {model_path}")
    model_path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, model_path)
    return model_path


def load_detector(model_path: Path, min_score: float):
    det = cv2.FaceDetectorYN_create(str(model_path), "", (320, 320), min_score, 0.3, 5000)
    return det


def yunet_top_score(det, img: Image.Image) -> float:
    """Highest YuNet detection score across the image (0.0 when nothing detected)."""
    rgb = np.asarray(img.convert("RGB"))
    bgr = rgb[:, :, ::-1].copy()  # YuNet expects BGR
    h, w = bgr.shape[:2]
    if min(h, w) == 0:
        return 0.0
    det.setInputSize((w, h))
    _, faces = det.detect(bgr)
    if faces is None or len(faces) == 0:
        return 0.0
    return float(np.max(faces[:, -1]))


def yunet_count(det, img: Image.Image) -> int:
    return 1 if yunet_top_score(det, img) > 0 else 0


def iter_crops(index_path: Path, base: Path) -> List[Tuple[Path, bool, Dict[str, Any], Dict[str, Any]]]:
    """Yield (crop_path, haar_verified, headshot, record) from either index schema."""
    out: List[Tuple[Path, bool, Dict[str, Any], Dict[str, Any]]] = []
    for line in index_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            j = json.loads(line)
        except json.JSONDecodeError:
            continue
        rec = j.get("record") if isinstance(j.get("record"), dict) else j
        if not rec or not rec.get("headshots"):
            continue
        for h in rec["headshots"] or []:
            rel = h.get("path") or h.get("relPath") or h.get("crop")
            if not rel:
                continue
            cp = base / rel
            if not cp.is_file():
                cp = next((p for p in base.rglob(os.path.basename(rel))), None)
            if cp is None:
                continue
            out.append((cp, bool(h.get("verified")), h, rec))
    return out


def main(argv: Optional[List[str]] = None) -> int:
    script_dir = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="YuNet (DNN) re-check of extracted head photos.")
    ap.add_argument("--index", action="append", default=[], help="index.jsonl to check (repeatable; default: corpus + repo stores)")
    ap.add_argument("--model", default=str(script_dir / "models" / MODEL_FILENAME), help="YuNet ONNX model (auto-downloaded if missing)")
    ap.add_argument("--min-score", type=float, default=0.6, help="YuNet score threshold (default 0.6)")
    ap.add_argument("--out-csv", default="", help="optional CSV output path")
    a = ap.parse_args(argv)

    indices = [Path(p) for p in (a.index or DEFAULT_INDICES)]
    if not a.index:
        # also include the repo OCR.LOCAL store when present
        repo_store = script_dir.parent / "data" / "headshots" / "index.jsonl"
        if repo_store.is_file():
            indices.append(repo_store)

    model = ensure_model(Path(a.model))
    det = load_detector(model, a.min_score)

    agg = {"confirmed": 0, "disputed": 0, "rescued": 0, "rejected": 0}
    rows = []
    for idx in indices:
        if not idx.is_file():
            print(f"! missing index: {idx}")
            continue
        base = idx.parent
        crops = iter_crops(idx, base)
        n_hit = n_tot = 0
        for cp, haar_ok, h, rec in crops:
            n_tot += 1
            top = yunet_top_score(det, Image.open(cp))
            hit = top >= a.min_score
            n_hit += hit
            if hit and haar_ok:
                bucket = "confirmed"
            elif haar_ok:
                bucket = "disputed"
            elif hit:
                bucket = "rescued"
            else:
                bucket = "rejected"
            agg[bucket] += 1
            rows.append([str(cp), bucket, top, 1 if haar_ok else 0, rec.get("doc_type") or ""])
        src = rec.get("file") or str(idx)
        print(f"{idx.name:<24} {n_hit:>3}/{n_tot:<3} YuNet hits  ({100 * n_hit / max(n_tot, 1):.0f}%)")

    print("--- cross-tab vs Haar verified flag ---")
    for k in ("confirmed", "disputed", "rescued", "rejected"):
        print(f"  {k:<10} {agg[k]:>4}")
    if agg["disputed"] or agg["rescued"]:
        print("\nreview hint: 'disputed' = Haar said face, YuNet disagrees; 'rescued' = YuNet found a face in a quarantined crop.")
    # peak-score distribution of the two Haar buckets -- a disputed crop that
    # scores 0.55 is borderline (threshold choice), one scoring ~0.0 is a clear miss.
    import collections
    bands = collections.defaultdict(lambda: [0, 0])
    by_type: dict = collections.defaultdict(lambda: [0, 0])
    for row in rows:
        top, haar = row[2], row[3]
        band = min(int(top * 10), 10)
        bands[band][1 if haar else 0] += 1
        if haar and top < a.min_score:
            dt = row[4] or "none"
            by_type[dt][0] += 1
            by_type[dt][1] += 1
    print("--- peak YuNet score distribution (per 0.1 band: Haar-verified count / quarantined count) ---")
    for band in range(11):
        quarantined, verified = bands[band]
        if verified or quarantined:
            print(f"  score {band / 10:.1f}-{band / 10 + 0.1:.1f}: verified {verified:>3}   quarantined {quarantined:>3}")
    if by_type:
        print("--- 'disputed' crops by document_type (Haar verified, YuNet missed) ---")
        for dt, (n, _) in sorted(by_type.items(), key=lambda kv: -kv[1][0]):
            print(f"  {dt:<24} {n:>3}")
    # per-document-type agreement (how many Haar-verified crops YuNet also confirms)
    import collections as _c
    type_tab = _c.defaultdict(lambda: [0, 0])
    for row in rows:
        haar = row[3]
        if not haar:
            continue
        type_tab[row[4] or "none"][0] += 1
        type_tab[row[4] or "none"][1] += 1 if row[2] >= a.min_score else 0
    if type_tab:
        print("--- Haar-verified crops: YuNet agreement by document_type ---")
        for dt, (n, hit) in sorted(type_tab.items(), key=lambda kv: -kv[1][0]):
            print(f"  {dt:<24} {hit:>3}/{n:<3} confirmed ({100 * hit / max(n, 1):.0f}%)")
    if a.out_csv:
        Path(a.out_csv).parent.mkdir(parents=True, exist_ok=True)
        with open(a.out_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["crop", "bucket", "yunet_top_score", "haar_verified", "doc_type"])
            w.writerows(rows)
        print(f"csv -> {a.out_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())