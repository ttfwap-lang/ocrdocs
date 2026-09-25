import hashlib
import json
import sqlite3
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "attach_rear_licences.py"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_db(path: Path, source_hash: str, duplicate: bool = False) -> None:
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE documents (id TEXT PRIMARY KEY, filename TEXT, original_path TEXT, content_hash TEXT, latest_extraction_id TEXT);
        CREATE TABLE extractions (id TEXT PRIMARY KEY, document_id TEXT, created_at TEXT);
        CREATE TABLE fields (id TEXT PRIMARY KEY, extraction_id TEXT, field_name TEXT, field_value TEXT, corrected_value TEXT);
        """
    )
    rows = [("doc-1", "licence.pdf", "/private/licence.pdf", source_hash, "ex-1")]
    if duplicate:
        rows.append(("doc-2", "copy.pdf", "/private/copy.pdf", source_hash, "ex-2"))
    db.executemany("INSERT INTO documents VALUES (?, ?, ?, ?, ?)", rows)
    for doc_id, extraction_id in [(r[0], r[4]) for r in rows]:
        db.execute("INSERT INTO extractions VALUES (?, ?, '2026-01-01')", (extraction_id, doc_id))
        db.executemany(
            "INSERT INTO fields VALUES (?, ?, ?, ?, NULL)",
            [
                (f"{extraction_id}-family", extraction_id, "Family Name / Surname", "Example"),
                (f"{extraction_id}-given", extraction_id, "Given Names / First Name", "Sample"),
                (f"{extraction_id}-dob", extraction_id, "Date of Birth (DOB)", "24/11/1980"),
            ],
        )
    db.commit()
    db.close()


def make_index(path: Path, source: Path, card: Path, page: Path, decision: str = "confirmed") -> None:
    row = {
        "key": "occurrence",
        "file": str(source),
        "page": 1,
        "part": "",
        "decision": decision,
        "category": "rear_licence" if decision == "confirmed" else "mixed_licences",
        "rear_bbox": [1, 2, 900, 500],
        "rear_text_visible": True,
        "vision_confidence": 0.95,
        "card_image": str(card),
        "page_image": str(page),
    }
    path.write_text(json.dumps(row) + "\n", encoding="utf-8")


def run_attach(tmp_path: Path, db: Path, index: Path, out: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--index", str(index), "--db", str(db), "--out", str(out), "--apply", *extra],
        text=True,
        capture_output=True,
        check=False,
    )


def test_attach_maps_unique_hash_and_copies_assets(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    card = tmp_path / "card.jpg"
    page = tmp_path / "page.jpg"
    source.write_bytes(b"source-document")
    card.write_bytes(b"card-image")
    page.write_bytes(b"page-image")
    db = tmp_path / "app.db"
    make_db(db, digest(source))
    index = tmp_path / "verified.jsonl"
    make_index(index, source, card, page)
    out = tmp_path / "out"

    result = run_attach(tmp_path, db, index, out)
    assert result.returncode == 0, result.stderr
    records = [json.loads(line) for line in (out / "index.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(records) == 1
    assert records[0]["documentId"] == "doc-1"
    assert len(records[0]["identityId"]) == 16
    assert (out / records[0]["cardAsset"]).read_bytes() == b"card-image"
    assert (out / records[0]["pageAsset"]).read_bytes() == b"page-image"


def test_attach_rejects_duplicate_document_hash(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    card = tmp_path / "card.jpg"
    page = tmp_path / "page.jpg"
    source.write_bytes(b"source-document")
    card.write_bytes(b"card-image")
    page.write_bytes(b"page-image")
    db = tmp_path / "app.db"
    make_db(db, digest(source), duplicate=True)
    index = tmp_path / "verified.jsonl"
    make_index(index, source, card, page)
    out = tmp_path / "out"

    result = run_attach(tmp_path, db, index, out)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["emitted"] == 0
    assert report["counts"]["ambiguous_or_unmatched_document"] == 1


def test_review_rows_are_excluded_unless_explicitly_included(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    card = tmp_path / "card.jpg"
    page = tmp_path / "page.jpg"
    source.write_bytes(b"source-document")
    card.write_bytes(b"card-image")
    page.write_bytes(b"page-image")
    db = tmp_path / "app.db"
    make_db(db, digest(source))
    index = tmp_path / "verified.jsonl"
    make_index(index, source, card, page, decision="review")
    out = tmp_path / "out"

    excluded = run_attach(tmp_path, db, index, out)
    assert excluded.returncode == 0, excluded.stderr
    assert json.loads(excluded.stdout)["emitted"] == 0
    included = run_attach(tmp_path, db, index, out, "--include-review")
    assert included.returncode == 0, included.stderr
    assert json.loads(included.stdout)["emitted"] == 1


def test_source_hash_map_allows_assets_to_stay_on_build_host(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    card = tmp_path / "card.jpg"
    page = tmp_path / "page.jpg"
    source.write_bytes(b"source-document")
    card.write_bytes(b"card-image")
    page.write_bytes(b"page-image")
    source_hash = digest(source)
    db = tmp_path / "app.db"
    make_db(db, source_hash)
    index = tmp_path / "verified.jsonl"
    make_index(index, source, card, page)
    source.unlink()
    hash_map = tmp_path / "source_hashes.json"
    hash_map.write_text(json.dumps({str(source): source_hash}), encoding="utf-8")
    out = tmp_path / "out"

    result = run_attach(tmp_path, db, index, out, "--source-hash-map", str(hash_map))
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["emitted"] == 1
