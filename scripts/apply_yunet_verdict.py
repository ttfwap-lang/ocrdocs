#!/usr/bin/env python3
"""Apply the YuNet re-check verdict to the headshots corpus store.

Reads yunet_qa.csv (produced by scripts/yunet_check.py) and index.jsonl. Disputed
crops (Haar said face, YuNet found none -- almost certainly false positives) are
quarantined into _unverified_review/ exactly like the Haar-QA pass does; rescued
crops (currently quarantined, but YuNet found a face) are restored to their person
folder. Nothing is ever deleted -- the review folder is a reversible holding area.

Path matching is by the crop's absolute resolved path, so only rows belonging to
this store are touched (rows from other indexes are skipped silently).

Run:  python scripts/apply_yunet_verdict.py [--base ...] [--csv yunet_qa.csv]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Quarantine YuNet-disputed crops and restore YuNet-rescued crops.")
    ap.add_argument("--base", default=os.environ.get("OCRDOCS_HEADSHOTS_CORPUS", r"C:\Users\lnxzf\Desktop\llamaparse_bulk\data\headshots_corpus"),
                    help="headshots corpus root (default: desktop corpus, or $OCRDOCS_HEADSHOTS_CORPUS)")
    ap.add_argument("--csv", default="yunet_qa.csv", help="yunet_qa.csv path (absolute, or relative to --base)")
    a = ap.parse_args(argv)

    base = Path(a.base)
    review = base / "_unverified_review"
    review.mkdir(exist_ok=True)
    csv_path = Path(a.csv)
    if not csv_path.is_absolute():
        csv_path = base / csv_path

    bucket_of: dict[str, str] = {}
    for r in csv.DictReader(open(csv_path, encoding="utf-8")):
        bucket_of[str(Path(r["crop"]).resolve())] = r["bucket"]

    idx_path = base / "index.jsonl"
    if not idx_path.is_file():
        print(f"! no index at {idx_path}")
        return 1

    moved_disputed = restored = skipped = 0
    lines = idx_path.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        if not line.strip():
            continue
        j = json.loads(line)
        rec = j.get("record")
        if rec:
            rec = dict(rec)
            hs = list(rec.get("headshots") or [])
            new_hs = []
            for h in hs:
                rel = h.get("path") or h.get("relPath") or h.get("crop")
                cur = base / rel if rel else None
                if cur is None or not cur.is_file():
                    if cur is not None and cur.exists() and cur.is_dir():
                        new_hs.append(h)
                        continue
                    new_hs.append(h)
                    skipped += 1
                    continue
                b = bucket_of.get(str(cur.resolve()))
                if b == "disputed":
                    target = review / f"{cur.parent.name}__{cur.name}"
                    if target.exists():
                        target = review / f"{cur.parent.name}__{cur.stem}_{os.urandom(2).hex()}{cur.suffix}"
                    shutil.move(str(cur), str(target))
                    h = dict(h)
                    h["verified"] = False
                    h["path"] = str(target.relative_to(base))
                    moved_disputed += 1
                elif b == "rescued":
                    # review filename is "<original_folder>__<crop>"; put it back under the original folder
                    name = cur.name
                    folder, sep, crop = name.partition("__")
                    if sep and crop:
                        dest_dir = base / folder
                        dest_dir.mkdir(parents=True, exist_ok=True)
                        dest = dest_dir / crop
                        if dest.exists():
                            dest = dest_dir / f"{Path(crop).stem}_{os.urandom(2).hex()}{Path(crop).suffix}"
                        shutil.move(str(cur), str(dest))
                        h = dict(h)
                        h["verified"] = True
                        h["path"] = str(dest.relative_to(base))
                        restored += 1
                    else:
                        new_hs.append(h)
                        continue
                new_hs.append(h)
            if hs:
                rec["headshots"] = new_hs
            j["record"] = rec
        out.append(j)

    idx_path.write_text(encoding="utf-8", data="\n".join(json.dumps(o, ensure_ascii=False) for o in out) + "\n")
    print(f"quarantined {moved_disputed} disputed crop(s) -> {review}")
    print(f"restored {restored} rescued crop(s) to their person folders")
    if skipped:
        print(f"note: {skipped} entries left untouched (file missing / not in this store)")
    return 0


if __name__ == "__main__":
    sys.exit(main())