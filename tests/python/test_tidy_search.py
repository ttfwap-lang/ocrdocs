import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import tidy_search as ts  # noqa: E402


def test_finds_words_in_text_utf16_docx_and_names_and_skips_junk(tmp_path, monkeypatch):
    r = tmp_path / "root"
    r.mkdir()
    (r / "a.txt").write_bytes(b"Medicare card: 1234\nMY PASSWORD is x, Password again")
    (r / "b.txt").write_text("Driver Licence 42", encoding="utf-16")
    (r / "US_license.rtf").write_bytes(bytes([0x7b, 0x5c]) + b"rtf1 nothing here " + b"x" * 3000 + b"}")
    with zipfile.ZipFile(r / "c.docx", "w") as z:
        z.writestr("word/document.xml", "<w:t>medi</w:t><w:t>care</w:t> <w:t>Medicare</w:t>" + "<w:t>pad</w:t>" * 300)
    (r / "clean.txt").write_bytes(b"nothing to see" * 10)
    (r / "junk.dll").write_bytes(b"MZ" + b"password" * 1000)
    out = tmp_path / "hits.jsonl"
    ts.main([str(r), "--out", str(out)])
    import json
    got = {os.path.basename(j["file"]): j["words"] for j in map(json.loads, out.read_text().splitlines())}
    assert got["a.txt"] == {"medicare": 1, "password": 2}
    assert got["b.txt"] == {"licen[cs]e": 1}
    assert got["US_license.rtf"] == {"licen[cs]e": 1}      # matched by file name only
    assert got["c.docx"] == {"medicare": 1}                # split runs are not joined; the whole word is
    assert "clean.txt" not in got and "junk.dll" not in got
    assert (tmp_path / "hits.paths.txt").read_text().count("\n") == 4


def test_match_across_chunk_boundary_counted_once(tmp_path, monkeypatch):
    monkeypatch.setattr(ts, "CHUNK", 100)
    p = tmp_path / "big.txt"
    p.write_bytes(b"a" * 96 + b"password" + b"b" * 300 + b"password")
    pats = ts.compile_patterns(["password"])
    assert ts.count_stream(str(p), pats, overlap=16) == {"password": 2}


def test_ocr_reads_text_in_images_and_scanned_pdfs(tmp_path):
    import json
    import pytest
    pytest.importorskip("pytesseract")
    import shutil
    if not shutil.which("tesseract"):
        pytest.skip("tesseract not installed")
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("arial.ttf", 60)
    except OSError:
        pytest.skip("no arial.ttf")
    r = tmp_path / "root"
    r.mkdir()
    for name, text in (("s.png", "Medicare number 1234"), ("blank_words.png", "Nothing to see here")):
        im = Image.new("RGB", (1400, 300), "white")
        ImageDraw.Draw(im).text((30, 100), text, fill="black", font=font)
        im.save(r / name)
    scan = Image.new("RGB", (1400, 300), "white")
    ImageDraw.Draw(scan).text((30, 100), "Your PASSWORD is here", fill="black", font=font)
    scan.save(r / "scan.pdf")  # a PDF containing only a picture: no text layer
    for p in (r / "s.png", r / "blank_words.png", r / "scan.pdf"):
        p.write_bytes(p.read_bytes() + b"\0" * 3000)  # above the 2 KB tiny rule
    out = tmp_path / "h.jsonl"
    ts.main([str(r), "--out", str(out), "--ocr", "--workers", "2"])
    got = {os.path.basename(j["file"]): (j["words"], j["via"]) for j in map(json.loads, out.read_text().splitlines())}
    assert got["s.png"] == ({"medicare": 1}, ["ocr"])
    assert got["scan.pdf"] == ({"password": 1}, ["ocr"])
    assert "blank_words.png" not in got
