"""The quarantine tool moves, never deletes, refuses unsafe targets, and restores exactly."""
import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

import corpus_quarantine as cq


@pytest.fixture
def corpus(tmp_path):
    root = tmp_path / "parsed"
    root.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    files = {"a": root / "a.jpg", "b": root / "b.png", "c": root / "c.jpg", "out": outside / "o.jpg", "gone": root / "gone.jpg"}
    for k, p in files.items():
        if k != "gone":
            p.write_bytes(b"data-" + k.encode())
    (root / "link.jpg").symlink_to(files["a"]) if hasattr(os, "symlink") and sys.platform != "win32" else None
    db = tmp_path / "app.db"
    con = sqlite3.connect(db)
    con.execute("create table documents (id text, original_path text)")
    for k, p in files.items():
        con.execute("insert into documents values (?, ?)", (k, str(p)))
    con.commit()
    con.close()
    survey = {"results": [{"id": "a", "status": "error"}, {"id": "b", "status": "error"}, {"id": "c", "status": "blank"},
                          {"id": "out", "status": "error"}, {"id": "gone", "status": "error"}]}
    return {"root": str(root), "db": str(db), "survey": survey, "files": files, "q": str(tmp_path / "quarantine")}


def test_plan_selects_only_the_requested_status_and_skips_unsafe_targets(corpus):
    moves, skipped = cq.plan(corpus["survey"], corpus["db"], "error", corpus["root"], corpus["q"])
    assert sorted(m["id"] for m in moves) == ["a", "b"]
    assert dict(skipped) == {"outside --root": 1, "missing": 1}
    assert all(Path(m["from"]).exists() for m in moves)          # planning moves nothing


def test_apply_moves_the_files_writes_a_private_manifest_and_leaves_the_content_intact(corpus):
    moves, _ = cq.plan(corpus["survey"], corpus["db"], "error", corpus["root"], corpus["q"])
    assert cq.apply_moves(moves, corpus["q"]) == 2
    assert not corpus["files"]["a"].exists() and Path(moves[0]["to"]).read_bytes() == b"data-a"
    assert corpus["files"]["c"].exists() and corpus["files"]["out"].exists()   # other statuses and outside root untouched
    manifest = Path(corpus["q"]) / "manifest.jsonl"
    entries = [json.loads(l) for l in manifest.read_text().splitlines()]
    assert {e["id"] for e in entries} == {"a", "b"} and all(e["reason"] == "error" for e in entries)
    if sys.platform != "win32":
        assert oct(manifest.stat().st_mode & 0o777) == "0o600" and oct(Path(corpus["q"]).stat().st_mode & 0o777) == "0o700"


def test_restore_puts_every_file_back_exactly(corpus):
    moves, _ = cq.plan(corpus["survey"], corpus["db"], "error", corpus["root"], corpus["q"])
    cq.apply_moves(moves, corpus["q"])
    manifest = str(Path(corpus["q"]) / "manifest.jsonl")
    assert cq.restore(manifest, apply=False) == (2, 2) and not corpus["files"]["a"].exists()   # dry run changes nothing
    assert cq.restore(manifest, apply=True) == (2, 2)
    assert corpus["files"]["a"].read_bytes() == b"data-a" and corpus["files"]["b"].read_bytes() == b"data-b"


def test_apply_never_overwrites_an_existing_quarantined_file(corpus):
    moves, _ = cq.plan(corpus["survey"], corpus["db"], "error", corpus["root"], corpus["q"])
    os.makedirs(corpus["q"])
    Path(moves[0]["to"]).write_bytes(b"already here")
    assert cq.apply_moves(moves, corpus["q"]) == 1
    assert Path(moves[0]["to"]).read_bytes() == b"already here" and corpus["files"]["a"].exists()


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_symlinks_are_refused(corpus, tmp_path):
    con = sqlite3.connect(corpus["db"])
    con.execute("insert into documents values ('link', ?)", (str(Path(corpus["root"]) / "link.jpg"),))
    con.commit()
    survey = {"results": [{"id": "link", "status": "error"}]}
    moves, skipped = cq.plan(survey, corpus["db"], "error", corpus["root"], corpus["q"])
    assert moves == [] and dict(skipped) == {"not a regular file": 1}


def test_ai_confirmed_ids_select_the_files_regardless_of_survey_status(corpus):
    moves, _ = cq.plan(corpus["survey"], corpus["db"], "no_text", corpus["root"], corpus["q"], ai_confirmed={"c"})
    assert [m["id"] for m in moves] == ["c"] and moves[0]["reason"] == "no_text"
    moves, _ = cq.plan(corpus["survey"], corpus["db"], "no_text", corpus["root"], corpus["q"], ai_confirmed=set())
    assert moves == []
