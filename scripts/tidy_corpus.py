"""Tidy a document corpus in place: junk out, corrupt out, duplicates out, wrong extensions fixed, everything reported.
Combines the clean-up rules that were spread over pre-parse.sh, importService.verifyContent, corpus_quarantine.py and
ocr_gates.ink_ratio into one Windows-friendly script. Never deletes: every removal is a MOVE into --quarantine plus a line
in <quarantine>/manifest.jsonl, so --restore puts everything back exactly. Dry run unless --apply. Local only, no network.

  python tidy_corpus.py ROOT [ROOT ...] --quarantine Q                  dry run: counts per stage, moves nothing
  python tidy_corpus.py ROOT [ROOT ...] --quarantine Q --apply [--rename]
  python tidy_corpus.py --restore Q/manifest.jsonl [--apply]

Roots are ordered: when two files are identical the copy in the earlier root (then the shorter path) is kept.
Stages run in this order and the first one that matches a file decides it:
  1 junk_name   Windows/Mac metadata by exact name (Thumbs.db, desktop.ini, .DS_Store, pagefile.sys, ...)
  2 junk_type   executables/drivers/installers/shortcuts/icons by extension, or an MZ header under any extension
  3 tiny        images/PDF/Word <= 2 KB, or a zero-byte file of any type (a 459-byte .rri or 1 KB .htm is a real record)
  4 corrupt     extension says image/pdf/docx/text but the bytes are not (random-byte "images")
  5 blank       image that is essentially white (same ink test as the OCR gates)
  6 duplicate   identical SHA-256 to a file already kept
  7 unsupported (--unsupported only) type the OCR pipeline cannot read and that is not a known medical/text record
  8 rename      (--rename only) fix the extension to the true content type; the stem is kept
Anything else is kept, including unknown types (.hl7, .msg, .rpt, ...). Archives are only reported, never opened.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

JUNK_NAMES = {"thumbs.db", "ehthumbs.db", "ehthumbs_vista.db", "desktop.ini", "iconcache.db", "bootmgr", "hiberfil.sys",
              "pagefile.sys", "swapfile.sys", ".ds_store", "win386.swp"}
JUNK_NAME_PREFIXES = ("ntuser.dat",)
JUNK_EXT = {"exe", "com", "dll", "sys", "scr", "lnk", "cpl", "cab", "msi", "msp", "inf", "reg", "chm", "hlp", "bat", "cmd",
            "vbs", "vbe", "wsf", "wsc", "cur", "ani", "ico", "obj", "lib", "pdb"}
TINY_BYTES = 2048
TEXTLIKE = {"txt", "xml", "json", "rtf", "hl7", "oru", "rpt", "csv", "ini", "log", "orm", "adt"}
CHECKED = {"png", "jpg", "jpeg", "bmp", "tif", "tiff", "webp", "pdf", "docx", "rtf", "json", "xml", "txt"}
IMAGE_EXT = {"png", "jpg", "jpeg", "bmp", "tif", "tiff", "webp"}
ARCHIVE_EXT = {"zip", "rar", "7z", "gz", "tar", "bz2", "xz", "tgz"}
DOC_EXT = {"pdf", "docx", "doc", "rtf", "txt", "xlsx", "xls", "pptx", "csv"}
MEDICAL_EXT = {"hl7", "oru", "orm", "adt", "rpt", "rri", "rr", "ack", "msg", "htm", "html"}
KEEP_EXT = IMAGE_EXT | DOC_EXT | MEDICAL_EXT | TEXTLIKE | ARCHIVE_EXT
BLANK_MEAN, BLANK_INK = 240.0, 0.0005


def ext_of(p: str) -> str:
    return Path(p).suffix.lower().lstrip(".")


def read_head(path: str, n: int = 4096) -> bytes:
    with open(path, "rb") as f:
        return f.read(n)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sniff(head: bytes) -> Optional[str]:
    """True extension from magic bytes, for the types the OCR pipeline reads. None when not recognised."""
    if head.startswith(b"\x89PNG"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:2] == b"BM":
        return "bmp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "tif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if b"%PDF" in head[:1024]:
        return "pdf"
    if head[:5] == b"{\\rtf":
        return "rtf"
    return None


def _text_ok(head: bytes) -> Tuple[bool, str]:
    """Port of verifyContent's text(): decoded head must be >=95% printable (UTF-16 BOM aware, Latin-range for UTF-16)."""
    le, be = head[:2] == b"\xff\xfe", head[:2] == b"\xfe\xff"
    if not le and not be and len(head) >= 4 and head[0] != 0 and head[1] == 0 and head[2] != 0 and head[3] == 0:
        le, head = True, b"\xff\xfe" + head  # BOM-less UTF-16-LE (ASCII letters with a NUL between each)
    if not le and not be and b"\x00" in head:
        return False, ""
    if le:
        s = head[2:len(head) - (len(head) % 2)].decode("utf-16-le", "replace")
    elif be:
        s = head[2:len(head) - (len(head) % 2)].decode("utf-16-be", "replace")
    else:
        s = head.decode("utf-8", "replace")
    if not s:
        return False, ""
    printable = sum(1 for c in s if c in "\t\n\r" or (ord(c) >= 32 and c != "�"))
    latin = sum(1 for c in s if ord(c) < 0x250)
    if (le or be) and latin / len(s) < 0.9:
        return False, ""
    return printable / len(s) >= 0.95, s.lstrip("﻿").lstrip()


def content_matches(head: bytes, ext: str) -> bool:
    """Port of importService.verifyContent: do the leading bytes look like what the extension claims?"""
    if not head:
        return False
    if ext in ("png",):
        return head.startswith(b"\x89PNG")
    if ext in ("jpg", "jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == "bmp":
        return head[:2] == b"BM"
    if ext in ("tif", "tiff"):
        return head[:4] in (b"II*\x00", b"MM\x00*")
    if ext == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == "pdf":
        return b"%PDF" in head[:1024]
    if ext == "docx":
        return head[:2] == b"PK"
    ok, s = _text_ok(head)
    if ext == "rtf":
        return s.startswith("{\\rtf")
    if ext == "json":
        return ok and bool(s) and s[0] in '[{"0123456789-tfn'
    if ext == "xml":
        return ok and s.startswith("<")
    if ext == "txt":
        return ok
    return True


def is_blank_image(path: str) -> bool:
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        return False
    try:
        with Image.open(path) as im:
            im.draft("L", (512, 512))
            g = np.asarray(im.convert("L").resize((256, 256)))
        return float(g.mean()) >= BLANK_MEAN and float((g < 128).mean()) <= BLANK_INK
    except Exception:  # noqa: BLE001 - unreadable is the corrupt stage's business, never a reason to call it blank
        return False


def walk(roots: List[str], skip: str) -> Iterator[Tuple[int, str]]:
    skip = os.path.realpath(skip)
    for i, root in enumerate(roots):
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = sorted(d for d in dirs if os.path.realpath(os.path.join(dirpath, d)) != skip)
            for f in sorted(files):
                p = os.path.join(dirpath, f)
                if not os.path.islink(p):
                    yield i, p


def decide(path: str, size: int, head: bytes, unsupported: bool = False) -> Optional[Tuple[str, str]]:
    """Stages 1-5, the ones that look at a single file. Returns (stage, reason) or None to keep."""
    name, ext = os.path.basename(path).lower(), ext_of(path)
    if name in JUNK_NAMES or name.startswith(JUNK_NAME_PREFIXES) or ":zone.identifier" in name or name.endswith(".zone.identifier"):
        return "junk_name", name
    if ext in JUNK_EXT or (head[:2] == b"MZ" and ext not in TEXTLIKE | DOC_EXT | IMAGE_EXT):
        return "junk_type", ext or "MZ executable"
    if size == 0 or (size <= TINY_BYTES and (ext in IMAGE_EXT or ext in ("pdf", "docx"))):
        return "tiny", f"{size} bytes"
    if ext in CHECKED and not content_matches(head, ext) and sniff(head) is None:  # a real PNG named .jpg is kept (rename stage)
        return "corrupt", f"bytes are not a valid .{ext}"
    if ext in IMAGE_EXT and is_blank_image(path):
        return "blank", "essentially white image"
    if unsupported and ext not in KEEP_EXT:
        return "unsupported", f".{ext}" if ext else "no extension, not a recognised document"
    return None


def category(path: str) -> str:
    e = ext_of(path)
    return ("image" if e in IMAGE_EXT else "document" if e in DOC_EXT else "medical_message" if e in MEDICAL_EXT
            else "archive" if e in ARCHIVE_EXT else "other")


def plan(roots: List[str], quarantine: str, rename: bool, log=print, unsupported: bool = False) -> Tuple[List[dict], Counter]:
    moves: List[dict] = []
    kept: List[Tuple[int, str, int]] = []
    seen = 0
    for ri, p in walk(roots, quarantine):
        seen += 1
        if seen % 2000 == 0:
            log(f"  scanned {seen} files")
        try:
            size = os.path.getsize(p)
            d = decide(p, size, read_head(p), unsupported)
        except OSError as e:
            moves.append({"action": "skip", "from": p, "reason": f"unreadable: {type(e).__name__}"})
            continue
        if d:
            moves.append({"action": "quarantine", "stage": d[0], "reason": d[1], "from": p, "size": size})
        else:
            kept.append((ri, p, size))
    log(f"  hashing {len(kept)} kept files for duplicates")
    by_size: Dict[int, List[Tuple[int, str]]] = defaultdict(list)
    for ri, p, size in kept:
        by_size[size].append((ri, p))
    survivors: List[str] = []
    for size, group in by_size.items():
        if len(group) == 1:
            survivors.append(group[0][1])
            continue
        first: Dict[str, str] = {}
        for ri, p in sorted(group, key=lambda t: (t[0], len(t[1]), t[1])):
            h = sha256(p)
            if h in first:
                moves.append({"action": "quarantine", "stage": "duplicate", "reason": f"same content as {first[h]}",
                              "from": p, "size": size, "sha256": h})
            else:
                first[h] = p
                survivors.append(p)
    if rename:
        for p in survivors:
            true = sniff(read_head(p))
            e = ext_of(p)
            same = {"jpg": {"jpg", "jpeg"}, "tif": {"tif", "tiff"}}.get(true or "", {true})
            if true and e not in same:
                moves.append({"action": "rename", "stage": "rename", "reason": f".{e or '(none)'} -> .{true}", "from": p,
                              "to": str(Path(p).with_suffix("." + true))})
    return moves, Counter(m.get("stage", m["action"]) for m in moves)


def unique(dst: str) -> str:
    if not os.path.exists(dst):
        return dst
    stem, ext = os.path.splitext(dst)
    i = 1
    while os.path.exists(f"{stem}~{i}{ext}"):
        i += 1
    return f"{stem}~{i}{ext}"


def apply(moves: List[dict], roots: List[str], quarantine: str) -> Counter:
    os.makedirs(quarantine, exist_ok=True)
    done: Counter = Counter()
    with open(os.path.join(quarantine, "manifest.jsonl"), "a", encoding="utf-8") as m:
        for mv in moves:
            if mv["action"] == "skip" or not os.path.isfile(mv["from"]):
                continue
            if mv["action"] == "quarantine":
                rel = None
                for r in roots:
                    try:
                        rel = os.path.relpath(mv["from"], r)
                        if not rel.startswith(".."):
                            rel = os.path.join(os.path.basename(os.path.normpath(r)), rel)
                            break
                    except ValueError:
                        continue
                dst = unique(os.path.join(quarantine, mv["stage"], rel or os.path.basename(mv["from"])))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
            else:
                dst = mv["to"]
                if os.path.exists(dst):
                    continue  # never overwrite
            shutil.move(mv["from"], dst)
            m.write(json.dumps({**mv, "to": dst, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
            m.flush()
            done[mv["stage"]] += 1
    return done


def restore(manifest: str, do_apply: bool) -> Tuple[int, int]:
    entries = [json.loads(l) for l in open(manifest, encoding="utf-8") if l.strip()]
    back = 0
    for e in reversed(entries):
        if os.path.exists(e["to"]) and not os.path.exists(e["from"]):
            if do_apply:
                os.makedirs(os.path.dirname(e["from"]), exist_ok=True)
                shutil.move(e["to"], e["from"])
            back += 1
    return back, len(entries)


def report(roots: List[str], quarantine: str) -> None:
    cats: Counter = Counter()
    size = 0
    for _, p in walk(roots, quarantine):
        cats[category(p)] += 1
        size += os.path.getsize(p)
    print(f"remaining in roots: {sum(cats.values())} files, {size / 1e9:.2f} GB  {dict(cats)}")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Tidy a document corpus reversibly (never deletes).")
    ap.add_argument("roots", nargs="*")
    ap.add_argument("--quarantine")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--rename", action="store_true", help="also fix wrong extensions (stem kept)")
    ap.add_argument("--unsupported", action="store_true", help="also set aside types the OCR pipeline cannot read")
    ap.add_argument("--restore", metavar="MANIFEST")
    a = ap.parse_args(argv)
    if a.restore:
        n, total = restore(a.restore, a.apply)
        print(f"{'restored' if a.apply else 'would restore'} {n} of {total} entries")
        return 0
    if not a.roots or not a.quarantine:
        ap.error("give one or more ROOT folders and --quarantine")
    roots = [os.path.realpath(r) for r in a.roots]
    q = os.path.realpath(a.quarantine)
    for r in roots:
        if not os.path.isdir(r):
            ap.error(f"not a folder: {r}")
        if q == r or q.startswith(r + os.sep) or r.startswith(q + os.sep):
            ap.error("--quarantine must be outside every root (and not contain one)")
    moves, counts = plan(roots, q, a.rename, unsupported=a.unsupported)
    freed = sum(m.get("size", 0) for m in moves if m["action"] == "quarantine")
    print(f"\nplan: {dict(counts)}  ({freed / 1e9:.2f} GB would leave the roots)")
    for stage in ("junk_name", "junk_type", "tiny", "corrupt", "blank", "duplicate", "unsupported", "rename", "skip"):
        ex = [m for m in moves if m.get("stage", m["action"]) == stage][:3]
        for m in ex:
            print(f"  {stage:9} {m['from']}  [{m['reason']}]")
    if not a.apply:
        print("DRY RUN: nothing moved. Add --apply.")
        report(roots, q)
        return 0
    print(f"moved: {dict(apply(moves, roots, q))}; manifest {os.path.join(q, 'manifest.jsonl')}")
    report(roots, q)
    return 0


if __name__ == "__main__":
    sys.exit(main())
