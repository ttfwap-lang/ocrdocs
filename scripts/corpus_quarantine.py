"""Move files out of the corpus into a quarantine folder, reversibly. Never deletes.

Takes the gates survey output and a status ("error", "no_text", ...), resolves each file through the app database, and
moves it (rename on the same filesystem) into <quarantine>/<id>_<name>. A manifest of every move is written so
--restore puts everything back exactly. Dry-run by default: without --apply it only counts.

Refuses anything that is not a regular file under --root, is a symlink, or is already missing. The app database is not
modified (documents stay 'failed'/'extracted' as they were); permanent deletion is a separate, later decision.

  python corpus_quarantine.py --survey survey.json --db app.db --status error --root /home/nick/ocr/parsed \
      --quarantine /home/nick/ocr/quarantine_corrupt [--apply]
  python corpus_quarantine.py --restore /home/nick/ocr/quarantine_corrupt/manifest.jsonl [--apply]
"""
import argparse
import json
import os
import sqlite3
import time
from collections import Counter
from pathlib import Path


def plan(survey: dict, db: str, status: str, root: str, quarantine: str, ai_confirmed=None):
    """status selects survey rows by their survey status; with ai_confirmed (a set of ids that passed BOTH AI looks),
    only those ids are selected and status is just the recorded reason."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    paths = dict(con.execute("select id, original_path from documents"))
    root_real = os.path.realpath(root)
    moves, skipped = [], Counter()
    for r in survey["results"]:
        if ai_confirmed is not None:
            if r["id"] not in ai_confirmed:
                continue
        elif r["status"] != status:
            continue
        src = paths.get(r["id"])
        if not src or not os.path.lexists(src):
            skipped["missing"] += 1
        elif os.path.islink(src) or not os.path.isfile(src):
            skipped["not a regular file"] += 1
        elif not os.path.realpath(src).startswith(root_real + os.sep):
            skipped["outside --root"] += 1
        else:
            dst = os.path.join(quarantine, f"{r['id']}_{os.path.basename(src)}")
            moves.append({"id": r["id"], "from": src, "to": dst, "size": os.path.getsize(src), "reason": status})
    return moves, skipped


def apply_moves(moves, quarantine: str):
    os.makedirs(quarantine, mode=0o700, exist_ok=True)
    manifest = os.path.join(quarantine, "manifest.jsonl")
    fd = os.open(manifest, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    done = 0
    with os.fdopen(fd, "a") as m:
        for mv in moves:
            if os.path.exists(mv["to"]):
                continue                        # never overwrite
            os.rename(mv["from"], mv["to"])     # same filesystem: atomic, reversible
            m.write(json.dumps({**mv, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
            done += 1
    return done


def restore(manifest: str, apply: bool):
    entries = [json.loads(line) for line in open(manifest) if line.strip()]
    back = 0
    for e in entries:
        if os.path.exists(e["to"]) and not os.path.exists(e["from"]):
            if apply:
                os.rename(e["to"], e["from"])
            back += 1
    return back, len(entries)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey")
    ap.add_argument("--db")
    ap.add_argument("--status")
    ap.add_argument("--root")
    ap.add_argument("--quarantine")
    ap.add_argument("--restore")
    ap.add_argument("--ai-confirmed", help="jsonl from corpus_ai_triage.py --verify; quarantine only ids with confirmed=true")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    if a.restore:
        n, total = restore(a.restore, a.apply)
        print(f"{'restored' if a.apply else 'would restore'} {n} of {total} files")
        return
    for need in ("survey", "db", "status", "root", "quarantine"):
        if not getattr(a, need):
            ap.error(f"--{need} is required")
    confirmed = None
    if a.ai_confirmed:
        confirmed = {json.loads(l)["id"] for l in open(a.ai_confirmed) if l.strip() and json.loads(l)["confirmed"]}
    moves, skipped = plan(json.load(open(a.survey)), a.db, a.status, a.root, a.quarantine, confirmed)
    size = sum(m["size"] for m in moves)
    print(f"{len(moves)} files ({size / 1e6:.1f} MB) would move to {a.quarantine}; skipped {dict(skipped)}")
    if a.apply:
        print(f"moved {apply_moves(moves, a.quarantine)} files; manifest at {a.quarantine}/manifest.jsonl")
    else:
        print("dry run: nothing was moved (add --apply)")


if __name__ == "__main__":
    main()
