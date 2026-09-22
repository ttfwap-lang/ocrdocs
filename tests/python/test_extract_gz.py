import gzip
import io
import os
import sys
import tarfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import extract_gz as eg  # noqa: E402


def test_plain_gz_tarball_traversal_and_bomb(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.txt.gz").write_bytes(gzip.compress(b"hello"))
    with tarfile.open(src / "t.tar.gz", "w:gz") as tf:
        for name, data in (("ok/one.txt", b"1"), ("../evil.txt", b"x")):
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
    (src / "bomb.gz").write_bytes(gzip.compress(b"A" * (3 << 20)))  # not zeros: a zero stream reads as an empty tar
    (src / "bad.gz").write_bytes(b"not gzip at all")
    out = tmp_path / "out"
    recs = {os.path.basename(p): eg.extract_one(str(src / p), str(out), 1 << 20, 100) for p in os.listdir(src)}
    assert recs["a.txt.gz"]["ok"] and recs["a.txt.gz"]["files"] == 1
    assert recs["t.tar.gz"]["ok"] and recs["t.tar.gz"]["files"] == 1 and recs["t.tar.gz"]["skipped_unsafe"] == 1
    assert not (tmp_path / "evil.txt").exists() and not (out / "evil.txt").exists()
    assert not recs["bomb.gz"]["ok"] and "cap" in recs["bomb.gz"]["error"]
    assert not recs["bad.gz"]["ok"]
    assert (src / "a.txt.gz").exists()  # originals untouched
