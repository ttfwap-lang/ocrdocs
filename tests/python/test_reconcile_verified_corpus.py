import hashlib
import json
import sqlite3
import subprocess
import sys
from pathlib import Path


def _schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE documents (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, original_path TEXT NOT NULL,
          content_hash TEXT, mime_type TEXT, uploaded_at TEXT NOT NULL, status TEXT NOT NULL,
          user_id TEXT
        );
        CREATE TABLE extractions (
          id TEXT PRIMARY KEY, document_id TEXT NOT NULL, raw_text TEXT,
          extraction_json TEXT, extraction_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE fields (
          id TEXT PRIMARY KEY, extraction_id TEXT NOT NULL, field_name TEXT NOT NULL,
          field_value TEXT, confidence REAL NOT NULL DEFAULT 0, source_section TEXT,
          validated INTEGER NOT NULL DEFAULT 0, validation_status TEXT NOT NULL DEFAULT 'pending',
          corrected_value TEXT, approved INTEGER NOT NULL DEFAULT 0
        );
        """
    )


def _field(field_id: str, value: str, verified: str = "ok") -> dict:
    return {"name": field_id, "value": value, "verif": verified, "confidence": 0.99}


def test_reconcile_is_transactional_idempotent_and_protects_human_fields(tmp_path: Path):
    source_file = tmp_path / "source.txt"
    source_file.write_text("source bytes", encoding="utf-8")
    source_hash = hashlib.sha256(source_file.read_bytes()).hexdigest()
    source_jsonl = tmp_path / "verified.jsonl"
    source_jsonl.write_text(
        json.dumps(
            {
                "ok": True,
                "file": str(source_file),
                "fields": [
                    _field("family_name", "Verified Family"),
                    _field("given_names", "Verified Given"),
                    _field("date_of_birth", "01/02/1990"),
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    db_path = tmp_path / "app.db"
    con = sqlite3.connect(db_path)
    _schema(con)
    con.execute(
        "INSERT INTO documents VALUES (?, ?, ?, ?, ?, datetime('now'), 'failed', NULL)",
        ("doc-1", source_file.name, str(source_file), source_hash, None),
    )
    con.execute(
        "INSERT INTO extractions VALUES (?, ?, NULL, NULL, 1, datetime('now'))",
        ("ext-1", "doc-1"),
    )
    con.execute(
        "INSERT INTO fields VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', NULL, 0)",
        ("field-1", "ext-1", "Family Name / Surname", "Old Family", 0.5, None),
    )
    # A reviewer-approved value must win even under the verified policy.
    con.execute(
        "INSERT INTO fields VALUES (?, ?, ?, ?, ?, ?, 1, 'valid', NULL, 1)",
        ("field-2", "ext-1", "Given Names / First Name", "Reviewer Given", 0.5, None),
    )
    con.commit()
    con.close()

    script = Path(__file__).resolve().parents[2] / "scripts" / "reconcile_verified_corpus.py"
    backup = tmp_path / "before.db"
    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--in",
            str(source_jsonl),
            "--db",
            str(db_path),
            "--backup",
            str(backup),
            "--apply",
            "--conflict-policy",
            "verified",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    report = json.loads(result.stdout)
    assert report["stats"]["post_integrity"] == "ok"
    assert report["stats"]["matched_documents"] == 1
    assert backup.exists()

    con = sqlite3.connect(db_path)
    values = dict(con.execute("SELECT field_name, field_value FROM fields WHERE extraction_id='ext-1'"))
    pointer = con.execute("SELECT latest_extraction_id FROM documents WHERE id='doc-1'").fetchone()[0]
    con.close()
    assert values["Family Name / Surname"] == "Verified Family"
    assert values["Given Names / First Name"] == "Reviewer Given"
    assert values["Date of Birth (DOB)"] == "01/02/1990"
    assert pointer == "ext-1"

    # A second run is safe and does not duplicate fields.
    second_backup = tmp_path / "before-second.db"
    second = subprocess.run(
        [
            sys.executable,
            str(script),
            "--in",
            str(source_jsonl),
            "--db",
            str(db_path),
            "--backup",
            str(second_backup),
            "--apply",
            "--conflict-policy",
            "verified",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    second_report = json.loads(second.stdout)
    assert second_report["stats"].get("fields_inserted", 0) == 0
    assert second_report["stats"].get("fields_updated", 0) == 0
    con = sqlite3.connect(db_path)
    assert con.execute("SELECT COUNT(*) FROM fields").fetchone()[0] == 3
    assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    con.close()
