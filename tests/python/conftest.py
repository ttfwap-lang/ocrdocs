"""Shared fixtures for the Python OCR engine test suite.

Only Tesseract is assumed to be a real, installed binary (true on both the
DGX and common dev machines). PaddleOCR/EasyOCR/Surya are NOT assumed to be
installed — tests must not assert anything that only "passes" because those
engines are silently absent (see scripts/ocr_spark_engine.py optional-import
pattern). Where a test genuinely needs one of those engines, it should
explicitly skip via pytest.importorskip rather than let a vacuous pass hide
a real gap in coverage.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

# ocr_spark_engine.py reads NVME_ROOT and creates its directory layout at
# MODULE IMPORT TIME (top-level code), not lazily. It must be set before the
# first `import ocr_spark_engine` anywhere in the test session, which is why
# this runs as plain module-level code in conftest.py (guaranteed to execute
# before pytest imports any test module) rather than as a fixture — a
# per-test or even session-fixture env var would run too late for a module
# whose side effects fire on import.
if "NVME_ROOT" not in os.environ:
    os.environ["NVME_ROOT"] = tempfile.mkdtemp(prefix="ocrdocs_pytest_nvme_")


def _locate_tesseract() -> str:
    found = shutil.which("tesseract")
    if found:
        return found
    # Common Windows dev-machine install location, for local runs where
    # tesseract isn't on PATH but is genuinely installed.
    win_default = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe"
    if win_default.exists():
        return str(win_default)
    return ""


@pytest.fixture(scope="session", autouse=True)
def _configure_tesseract_path():
    import pytesseract

    cmd = _locate_tesseract()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
    yield


@pytest.fixture(scope="session")
def tesseract_available() -> bool:
    return bool(_locate_tesseract())


