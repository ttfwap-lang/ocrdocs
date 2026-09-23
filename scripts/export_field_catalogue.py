#!/usr/bin/env python3
"""Regenerate scripts/field_catalogue.py from the TypeScript field catalogue.

The app (server/services/identityService.ts) resolves short field ids (e.g.
"given_names") to their human-readable display names through
BANK_FIELD_DEFINITIONS + CORE_IDENTIFIER_DEFINITIONS and sorts the identity
breakdown by each definition's logical `number`. The Python corpus loader must
store exactly those display names in data/app.db so the identities UI groups
and orders corpus data the same way -- so instead of hand-copying the strings,
this script dumps the catalogue through tsx and writes field_catalogue.py.

Usage:
    node/tsx is required. Run from the repo root:
        python scripts/export_field_catalogue.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "field_catalogue.py")

TS_SNIPPET = r"""
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from 'REPO_ROOT/src/data/bankFields';
const ids = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];
process.stdout.write(JSON.stringify(ids.map(d => [d.id, d.name, d.number])));
""".replace("REPO_ROOT", REPO.replace("\\", "/"))


def main() -> int:
    with tempfile.NamedTemporaryFile("w", suffix=".ts", delete=False, encoding="utf-8") as fh:
        fh.write(TS_SNIPPET)
        tmp = fh.name
    try:
        proc = subprocess.run(
            ["npx", "tsx", tmp],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=180,
            shell=True,
        )
    finally:
        os.unlink(tmp)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return proc.returncode

    entries = json.loads(proc.stdout.strip().splitlines()[-1])
    lines = [
        '"""GENERATED FILE — do not edit by hand.',
        "",
        "Field catalogue (id, display name, logical order number) dumped from src/data/bankFields.ts by",
        "scripts/export_field_catalogue.py. IdentityService resolves display names and the identity",
        "breakdown order through the same source; the corpus loader stores these display names so",
        "corpus data plugs into the app identically.",
        '"""',
        "",
        "# (short_id, display_name, number)",
        "FIELD_CATALOGUE = [",
    ]
    for fid, name, number in entries:
        lines.append(f"    ({json.dumps(fid)}, {json.dumps(name)}, {number}),")
    lines += ["]", "", "# short id -> (display_name, number)", "BY_ID = {fid: (name, number) for fid, name, number in FIELD_CATALOGUE}", ""]
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {OUT} with {len(entries)} fields")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())