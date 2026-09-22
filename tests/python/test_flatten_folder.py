import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import flatten_folder as ff  # noqa: E402
import tidy_corpus as tc  # noqa: E402


def test_flatten_handles_clashes_and_restores_exactly(tmp_path):
    r = tmp_path / "m"
    (r / "202409").mkdir(parents=True)
    (r / "Pathology" / "deep").mkdir(parents=True)
    files = {r / "top.pdf": b"t", r / "202409" / "a.pdf": b"1", r / "Pathology" / "a.pdf": b"2", r / "Pathology" / "deep" / "A.PDF": b"3"}
    for p, d in files.items():
        p.write_bytes(d)
    moves = ff.plan(str(r))
    assert len({m["to"].lower() for m in moves}) == 3  # all destinations distinct, case-insensitively
    assert ff.apply(str(r), moves) == 3
    assert sorted(f for f in os.listdir(r) if f != ff.MANIFEST) and all(os.path.isfile(r / f) for f in os.listdir(r))
    assert not (r / "202409").exists() and not (r / "Pathology").exists()
    assert sum(1 for f in os.listdir(r) if f != ff.MANIFEST) == 4
    n, total = tc.restore(str(r / ff.MANIFEST), True)
    assert (n, total) == (3, 3)
    assert {p: p.read_bytes() for p in files} == files
