#!/usr/bin/env python3
"""Precision QA: re-detect every saved headshot crop to separate genuine faces from Haar false positives.

Reads data/headshots_corpus/index.jsonl, runs the same face detector on every saved crop at full
resolution, and marks the crop 'verified' if a face is re-detected. Writes headshots_qa.csv
(person, doc, doc_type, crop, verified) and prints a per-doc_type summary.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import argparse
import cv2
import numpy as np
from PIL import Image

_ap = argparse.ArgumentParser(description="Re-detect every saved headshot crop (Haar) to separate genuine faces from false positives.")
_ap.add_argument("--base", default=os.environ.get("OCRDOCS_HEADSHOTS_CORPUS", r"C:\Users\lnxzf\Desktop\llamaparse_bulk\data\headshots_corpus"),
                 help="headshots corpus root (default: desktop corpus, or $OCRDOCS_HEADSHOTS_CORPUS)")
_args = _ap.parse_args()
BASE = _args.base

_HAAR_DIR = os.path.join(os.path.dirname(cv2.__file__), "data")
_front = cv2.CascadeClassifier(os.path.join(_HAAR_DIR, "haarcascade_frontalface_default.xml"))
_profile = cv2.CascadeClassifier(os.path.join(_HAAR_DIR, "haarcascade_profileface.xml"))
_CASC = [c for c in (_front, _profile) if not c.empty()]


def redetect(img: Image.Image) -> bool:
    gray = np.asarray(img.convert("L"))
    h, w = gray.shape
    scale = min(1.0, 1600 / max(h, w))
    small = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1.0 else gray
    runs = []
    for sf in (1.05, 1.1):
        boxes = []
        for casc in _CASC:
            det = casc.detectMultiScale(small, scaleFactor=sf, minNeighbors=5,
                                        minSize=(max(20, int(24 * scale)),) * 2)
            boxes += [(int(x / scale), int(y / scale), int(w2 / scale), int(h2 / scale)) for (x, y, w2, h2) in det]
        runs.append(boxes)
    return any((abs(b[0] - o[0]) <= max(6.0, b[2] / 3.0) and abs(b[1] - o[1]) <= max(6.0, b[2] / 3.0))
               for b in runs[0] for o in runs[1])


def main() -> int:
    idx = [json.loads(l) for l in open(os.path.join(BASE, "index.jsonl"), encoding="utf-8")]
    rows = []
    verified = total = 0
    by_type: dict = {}
    by_doc: dict = {}
    for r in idx:
        rec = r.get("record")
        if not rec:
            continue
        for h in rec.get("headshots") or []:
            total += 1
            # locate the crop: prefer the recorded path, else search below BASE
            rel = h.get("path") or h["crop"]
            cp = Path(BASE) / rel
            if not cp.exists() and "path" not in h:
                for p in Path(BASE).rglob(h["crop"]):
                    cp = p
                    break
            ok_ = bool(cp.exists()) and redetect(Image.open(cp))
            verified += ok_
            dt = rec.get("doc_type") or "none"
            d = by_type.setdefault(dt, [0, 0])
            d[0] += 1
            d[1] += ok_
            d2 = by_doc.setdefault(rec["file"].split("\\")[-1], [0, 0])
            d2[0] += 1
            d2[1] += ok_
            rows.append([str(cp), rec["file"].split("\\")[-1], dt, ok_])
    with open(os.path.join(BASE, "headshots_qa.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["crop", "doc", "doc_type", "verified"])
        w.writerows(rows)
    print(f"crops: {total}  verified (re-detect): {verified} ({100 * verified / max(total, 1):.0f}%)")
    print("--- by document_type ---")
    for k, (n, v) in sorted(by_type.items(), key=lambda kv: -kv[1][1]):
        print(f"  {k:<22} {n:>4} crops, {v:>4} verified ({100 * v / max(n, 1):.0f}%)")
    print("--- worst docs (lowest verified ratio, >=3 crops) ---")
    worst = sorted(by_doc.items(), key=lambda kv: (kv[1][1] / kv[1][0], kv[1][0]))[:12]
    for name, (n, v) in worst:
        if n >= 3:
            print(f"  {name[:70]:<72} {v}/{n} verified")
    return 0


if __name__ == "__main__":
    main()