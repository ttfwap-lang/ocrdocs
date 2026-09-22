"""Safely unpack .gz / .tar.gz files into a separate folder. Never touches the originals, never overwrites, never deletes.

Each archive goes to <out>/<archive stem>_<hash8>/ so two archives with the same name cannot collide. A single-file .gz is
decompressed to its stem; a tarball is unpacked member by member. Guards: per-archive expansion cap (a decompression bomb
cannot fill the disk), member-count cap, and every tar member path must stay inside its folder (no ../, no absolute paths,
no links, no devices). One bad archive is recorded and skipped, never fatal. Writes <out>/extract_manifest.jsonl.

  python extract_gz.py --list gz_files.txt --out D:\\extracted [--max-mb 500] [--max-members 5000]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import sys
import tarfile
import time
from pathlib import Path
from typing import List


def _copy_capped(src, dst_path: str, cap: int) -> int:
    n = 0
    with open(dst_path, "xb") as dst:
        while True:
            b = src.read(1 << 20)
            if not b:
                break
            n += len(b)
            if n > cap:
                raise ValueError(f"expands past the {cap // (1 << 20)} MB cap")
            dst.write(b)
    return n


def extract_one(path: str, out_root: str, cap: int, max_members: int) -> dict:
    h = hashlib.sha256(path.encode("utf-8", "ignore")).hexdigest()[:8]
    dest = os.path.join(out_root, f"{Path(path).stem[:60]}_{h}")
    rec = {"archive": path, "dest": dest, "files": 0, "bytes": 0}
    os.makedirs(dest, exist_ok=True)
    try:
        if tarfile.is_tarfile(path):
            with tarfile.open(path, "r:*") as tf:
                total = 0
                for i, m in enumerate(tf):
                    if i >= max_members:
                        raise ValueError(f"more than {max_members} members")
                    if not m.isfile():
                        continue  # dirs are implied; links/devices are never created
                    target = os.path.realpath(os.path.join(dest, m.name))
                    if not target.startswith(os.path.realpath(dest) + os.sep):
                        rec["skipped_unsafe"] = rec.get("skipped_unsafe", 0) + 1
                        continue
                    if os.path.exists(target):
                        continue
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    src = tf.extractfile(m)
                    total += _copy_capped(src, target, cap - total)
                    rec["files"] += 1
                rec["bytes"] = total
        else:
            name = Path(path).stem or "content"
            with gzip.open(path, "rb") as g:
                rec["bytes"] = _copy_capped(g, os.path.join(dest, name), cap)
            rec["files"] = 1
        rec["ok"] = True
    except Exception as e:  # noqa: BLE001 - a corrupt archive is recorded, not fatal
        rec["ok"] = False
        rec["error"] = f"{type(e).__name__}: {e}"[:200]
        if not os.listdir(dest):
            os.rmdir(dest)
    return rec


def main(argv: List[str] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-mb", type=int, default=500)
    ap.add_argument("--max-members", type=int, default=5000)
    a = ap.parse_args(argv)
    files = [l.strip() for l in open(a.list, encoding="utf-8") if l.strip()]
    os.makedirs(a.out, exist_ok=True)
    ok = bad = nfiles = 0
    with open(os.path.join(a.out, "extract_manifest.jsonl"), "a", encoding="utf-8") as mf:
        for i, p in enumerate(files, 1):
            r = extract_one(p, a.out, a.max_mb << 20, a.max_members)
            mf.write(json.dumps({**r, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
            mf.flush()
            ok += r["ok"]
            bad += not r["ok"]
            nfiles += r["files"]
            if i % 200 == 0:
                print(f"  {i}/{len(files)}  ok {ok}  failed {bad}  files out {nfiles}", flush=True)
    print(f"done: {ok} archives ok, {bad} failed, {nfiles} files extracted into {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
