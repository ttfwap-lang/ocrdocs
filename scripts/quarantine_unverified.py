#!/usr/bin/env python3
"""Move unverified crops into _unverified_review/ and enrich index.jsonl with per-crop status.

Reads headshots_qa.csv (crop path, verified) and index.jsonl. Unverified crops are moved to
data/headshots_corpus/_unverified_review/<person_folder>__<crop>.jpg (nothing deleted). index.jsonl
is rewritten with each headshot annotated: {"verified": bool, "path": current relative path}.
Run once, before the next extract pass.
"""
import argparse
import csv
import json
import os
import shutil
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ap = argparse.ArgumentParser(description="Move unverified crops into _unverified_review/ and enrich index.jsonl with per-crop status.")
_ap.add_argument("--base", default=os.environ.get("OCRDOCS_HEADSHOTS_CORPUS", r"C:\Users\lnxzf\Desktop\llamaparse_bulk\data\headshots_corpus"),
                 help="headshots corpus root (default: desktop corpus, or $OCRDOCS_HEADSHOTS_CORPUS)")
_args = _ap.parse_args()
BASE = Path(_args.base)
REVIEW = BASE / "_unverified_review"
REVIEW.mkdir(exist_ok=True)

# 1. unverified crops -> absolute old paths
unv = set()
for r in csv.DictReader(open(BASE / "headshots_qa.csv", encoding="utf-8")):
    if r["verified"] != "True":
        p = Path(r["crop"])
        if p.exists():
            unv.add(p)
        else:
            print("already gone:", p)

moved = {}
for p in unv:
    target = REVIEW / f"{p.parent.name}__{p.name}"
    if target.exists():
        target = REVIEW / f"{p.parent.name}__{p.stem}_{os.urandom(2).hex()}{p.suffix}"
    shutil.move(str(p), str(target))
    moved[str(p)] = str(target)
print(f"quarantined {len(moved)} crops -> {REVIEW}")

# 2. rewrite index.jsonl: annotate headshots with verified + current path
lines = (BASE / "index.jsonl").read_text(encoding="utf-8").splitlines()
out = []
for line in lines:
    j = json.loads(line)
    rec = j.get("record")
    if rec and rec.get("headshots"):
        for h in rec["headshots"]:
            towards = None
            rel = h.get("path") or h.get("crop")
            if rel:
                cand = BASE / rel
                if cand.is_file():
                    towards = cand
                else:
                    # this run moved it: map old-absolute -> new review file
                    towards = moved.get(str(cand.resolve())) or moved.get(str(cand))
                    if towards is None:
                        # a previous run already renamed it: *_<crop> inside REVIEW
                        hits = [x for x in REVIEW.rglob(f"*__{h['crop']}")]
                        towards = hits[0] if hits else None
            if towards is None:
                hits = [x for x in BASE.rglob(h["crop"])]
                towards = next((x for x in hits), None)
            if towards:
                h["verified"] = towards.parent != REVIEW
                h["path"] = str(towards.relative_to(BASE))
            else:
                h["verified"] = False
                h["path"] = h["crop"]
    out.append(j)
(BASE / "index.jsonl").write_text(encoding="utf-8",
                                  data="\n".join(json.dumps(o, ensure_ascii=False) for o in out) + "\n")
print("index.jsonl rewritten with verified/path per crop")