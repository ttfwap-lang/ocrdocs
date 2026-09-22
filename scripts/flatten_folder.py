"""Move every file in nested sub-folders up into the top folder. Reversible, never overwrites, never deletes a file.

A file whose name is already taken gets a short hash of its old relative path added (report.pdf -> report~1a2b3c4d.pdf), so
nothing is lost and the same input always gives the same names. Every move is written to <root>/flatten_manifest.jsonl in the
{from, to} form that `tidy_corpus.py --restore` understands, so the folder tree can be rebuilt exactly. Empty sub-folders are
removed afterwards (rmdir only: a folder that still holds anything is left alone). Dry run unless --apply.

  python flatten_folder.py ROOT [--apply]
  python tidy_corpus.py --restore ROOT/flatten_manifest.jsonl --apply        undo
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from typing import List, Optional

MANIFEST = "flatten_manifest.jsonl"


def plan(root: str) -> List[dict]:
    taken = {f.lower() for f in os.listdir(root) if os.path.isfile(os.path.join(root, f))}
    moves = []
    for dirpath, dirs, files in os.walk(root):
        if os.path.realpath(dirpath) == os.path.realpath(root):
            continue
        dirs.sort()
        for f in sorted(files):
            src = os.path.join(dirpath, f)
            if os.path.islink(src):
                continue
            name = f
            if name.lower() in taken:
                rel = os.path.relpath(src, root)
                stem, ext = os.path.splitext(f)
                name = f"{stem}~{hashlib.sha256(rel.encode('utf-8', 'ignore')).hexdigest()[:8]}{ext}"
                n = 1
                while name.lower() in taken:
                    name = f"{stem}~{hashlib.sha256(rel.encode('utf-8', 'ignore')).hexdigest()[:8]}_{n}{ext}"
                    n += 1
            taken.add(name.lower())
            moves.append({"from": src, "to": os.path.join(root, name), "renamed": name != f})
    return moves


def apply(root: str, moves: List[dict]) -> int:
    done = 0
    with open(os.path.join(root, MANIFEST), "a", encoding="utf-8") as m:
        for mv in moves:
            if not os.path.isfile(mv["from"]) or os.path.exists(mv["to"]):
                continue
            shutil.move(mv["from"], mv["to"])
            m.write(json.dumps({**mv, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
            m.flush()
            done += 1
    for dirpath, _, _ in os.walk(root, topdown=False):
        if os.path.realpath(dirpath) != os.path.realpath(root):
            try:
                os.rmdir(dirpath)  # only succeeds when empty
            except OSError:
                pass
    return done


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Flatten a folder tree reversibly.")
    ap.add_argument("root")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    root = os.path.realpath(a.root)
    if not os.path.isdir(root):
        ap.error(f"not a folder: {root}")
    moves = plan(root)
    print(f"{len(moves)} files to move up to {root}; {sum(m['renamed'] for m in moves)} need a new name to avoid a clash")
    if not a.apply:
        print("DRY RUN: nothing moved. Add --apply.")
        return 0
    print(f"moved {apply(root, moves)}; manifest {os.path.join(root, MANIFEST)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
