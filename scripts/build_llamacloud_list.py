"""Build the LlamaCloud file list from the local triage output (option 3).

Triage ids are sha1(absolute path)[:12]; files with no label (or a label we keep)
stay on the list, photos and blanks come off it.

  python build_llamacloud_list.py --triage results/rc_local_triage.jsonl \
      --folder <Recovered_C> --out results/rc_llamacloud_list.txt
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llamaparse_bulk as lb  # noqa: E402


def doc_id(path: str) -> str:
    """The id corpus_ai_triage.py recorded for this file."""
    return hashlib.sha1(str(path).encode()).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--triage", required=True)
    ap.add_argument("--folder", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--exclude-kind", default="photo,blank",
                    help="kinds to drop entirely (default %(default)s); use '' to only drop fails=true")
    a = ap.parse_args()

    labels = {}
    dup = 0
    for line in open(a.triage, encoding="utf-8"):
        if not line.strip():
            continue
        r = json.loads(line)
        if r["id"] in labels:
            dup += 1
        labels[r["id"]] = r
    print(f"{len(labels)} triage labels ({dup} duplicate ids overwritten)")

    drop_kinds = {k for k in a.exclude_kind.split(",") if k}
    all_files = lb.collect(None, a.folder)
    print(f"{len(all_files)} supported files under {a.folder}")

    keep, dropped, unlabelled = [], Counter(), 0
    for p in all_files:
        lab = labels.get(doc_id(p))
        if lab is None:
            unlabelled += 1
            keep.append(p)
            continue
        if lab["kind"] in drop_kinds:
            dropped[f"kind:{lab['kind']}"] += 1
            continue
        if lab["fails"]:
            dropped["fails (photo/blank, no text, confident)"] += 1
            continue
        keep.append(p)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for p in keep:
            f.write(p + "\n")
    print(f"kept {len(keep)}, dropped {sum(dropped.values())} ({dict(dropped)}), unlabelled kept {unlabelled}")
    print(f"list written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
