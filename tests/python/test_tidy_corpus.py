import io
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import tidy_corpus as t  # noqa: E402


def png(color=(255, 255, 255), noise=False):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (300, 300), color)
    if noise:
        ImageDraw.Draw(im).rectangle((20, 20, 280, 200), fill=(0, 0, 0))
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue() + b"\0" * 3000  # trailing bytes are ignored by decoders; keeps the file above the 2 KB tiny rule


def build(tmp):
    a, b = tmp / "medica", tmp / "rec"
    (a / "202409").mkdir(parents=True)
    b.mkdir()
    files = {
        a / "202409" / "report.pdf": b"%PDF-1.4 " + b"x" * 5000,
        a / "202409" / "msg1.hl7": b"MSH|^~\\&|A|B",               # tiny but a real record: must be kept
        a / "202409" / "Thumbs.db": b"x" * 9000,                      # junk_name
        a / "202409" / "setup.dll": b"MZ" + b"\0" * 6000,             # junk_type
        a / "202409" / "tiny.png": b"\x89PNG",                        # tiny
        a / "202409" / "fake.jpg": os.urandom(6000),                  # corrupt
        a / "202409" / "white.png": png(),                            # blank
        a / "202409" / "scan.png": png(noise=True),                   # kept
        b / "scan_copy.png": png(noise=True),                         # duplicate of scan.png
        b / "mislabelled.jpg": png((0, 0, 0), True) + b"1",           # a PNG called .jpg
    }
    for p, data in files.items():
        p.write_bytes(data)
    return a, b, files


def test_dry_run_moves_nothing_and_plan_is_right(tmp_path):
    a, b, files = build(tmp_path)
    moves, counts = t.plan([str(a), str(b)], str(tmp_path / "q"), rename=True, log=lambda *_: None)
    assert all(os.path.exists(p) for p in files)
    stage = {os.path.basename(m["from"]): m["stage"] for m in moves}
    assert stage == {"Thumbs.db": "junk_name", "setup.dll": "junk_type", "tiny.png": "tiny", "fake.jpg": "corrupt",
                     "white.png": "blank", "scan_copy.png": "duplicate", "mislabelled.jpg": "rename"}
    assert "msg1.hl7" not in stage and "report.pdf" not in stage and "scan.png" not in stage


def test_apply_keeps_records_and_restore_is_exact(tmp_path):
    a, b, files = build(tmp_path)
    q = tmp_path / "q"
    moves, _ = t.plan([str(a), str(b)], str(q), rename=False, log=lambda *_: None)
    done = t.apply(moves, [str(a), str(b)], str(q))
    assert sum(done.values()) == 6
    assert (a / "202409" / "msg1.hl7").exists() and (a / "202409" / "scan.png").exists() and not (b / "scan_copy.png").exists()
    assert len(open(q / "manifest.jsonl").read().splitlines()) == 6
    n, total = t.restore(str(q / "manifest.jsonl"), True)
    assert (n, total) == (6, 6)
    assert {p: p.read_bytes() for p in files} == {p: d for p, d in files.items()}


def test_quarantine_inside_root_is_refused(tmp_path):
    a, _, _ = build(tmp_path)
    try:
        t.main([str(a), "--quarantine", str(a / "q")])
    except SystemExit as e:
        assert e.code == 2
    else:
        raise AssertionError("expected refusal")


def test_small_medical_records_are_kept_and_unsupported_is_opt_in(tmp_path):
    a = tmp_path / "m"
    a.mkdir()
    (a / "r.rri").write_bytes(b"x" * 459)
    (a / "p.htm").write_bytes(b"<html>" + b"x" * 1700)
    (a / "u16.json").write_bytes('{"a": 1, "b": "text here"}'.encode("utf-16-le"))
    (a / "blob.data").write_bytes(os.urandom(5000))
    (a / "empty.rri").write_bytes(b"")
    q = str(tmp_path / "q")
    names = lambda **kw: {os.path.basename(m["from"]): m["stage"] for m in t.plan([str(a)], q, False, log=lambda *_: None, **kw)[0]}
    assert names() == {"empty.rri": "tiny"}
    assert names(unsupported=True) == {"empty.rri": "tiny", "blob.data": "unsupported"}
