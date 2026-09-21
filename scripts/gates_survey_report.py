"""Read-only report over the gates survey output. Prints counts only: no file ids, no paths, no text.

  python gates_survey_report.py summary --survey survey.json
  python gates_survey_report.py errors  --survey survey.json --db /home/flak3dd/ocrdocs/data/app.db
"""
import argparse
import collections
import json
import os
import sqlite3

ap = argparse.ArgumentParser()
ap.add_argument("what", choices=["summary", "errors"])
ap.add_argument("--survey", required=True)
ap.add_argument("--db")
a = ap.parse_args()
d = json.load(open(a.survey))

if a.what == "summary":
    print("files", d["files"], "long_side", d["long_side"])
    for k, v in sorted(d["counts"].items(), key=lambda kv: -kv[1]):
        print(k, v)
else:
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    paths = dict(con.execute("select id, original_path from documents"))
    errs = [r for r in d["results"] if r["status"] == "error"]
    kinds = collections.Counter((os.path.splitext(paths[r["id"]])[1].lower(), r.get("error")) for r in errs)
    exist = [r for r in errs if os.path.exists(paths[r["id"]])]
    zero = sum(1 for r in exist if os.path.getsize(paths[r["id"]]) == 0)
    print("errors", len(errs), "| still on disk", len(exist), "| zero-byte", zero)
    for (ext, exc), n in kinds.most_common():
        print(f"  {ext or '(none)'}  {exc}  {n}")
    where = collections.Counter("/".join(paths[r["id"]].split("/")[:5]) for r in errs)
    print("by folder (first path components only):")
    for folder, n in where.most_common(8):
        print(f"  {folder}  {n}")
    status = dict(con.execute("select id, status from documents"))
    print("document status in the app database:", dict(collections.Counter(status.get(r["id"]) for r in errs)))
