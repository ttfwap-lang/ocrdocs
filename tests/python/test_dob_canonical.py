"""DOB canonicalization parity + regression.

The identity hash is computed in three places (identityService.ts, dobKey.ts,
build_headshots_index.py, build_local_index.py). If they disagree, head photos
attach to identityIds the app never produces. These tests pin the Python side to
the same contract the TS side enforces, using the exact values that split real
identities in the loaded corpus.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

from build_headshots_index import app_identity_id, canonical_dob  # noqa: E402


def test_same_date_different_spellings_collapse():
    target = "19631124"
    for value in (
        "24/11/1963", "24-11-1963", "24.11.1963", "24 / 11 / 1963",
        "24 NOV 1963", "24 Nov 1963", "24th Nov 1963", "24th November 1963",
        "1963-11-24", "November 24, 1963", "24NOV1963",
    ):
        assert canonical_dob(value) == target, value


def test_different_dates_never_collide():
    keys = {
        "24/11/1963": canonical_dob("24/11/1963"),
        "11/12/1963": canonical_dob("11/12/1963"),
        "3 Dec 1995": canonical_dob("3 Dec 1995"),
        "29/03/1988": canonical_dob("29/03/1988"),
    }
    # Provable day-first values differ.
    assert keys["24/11/1963"] != keys["11/12/1963"]
    # 3 Dec 1995 -> 19951203; 29/03/1988 -> 19880329. All distinct.
    assert len(set(keys.values())) == 4, keys


def test_ambiguous_numeric_and_alphabetic_stay_separate_by_design():
    # "03/12/1995" is ambiguous so it keeps raw digits; "3 Dec 1995" is
    # unambiguous so it canonicalises. They intentionally do NOT merge here --
    # that is the conservative contract (a wrong merge is worse than a
    # conservative split). The common real-world case is the provable one
    # (day > 12), which DOES merge; see test_same_date_different_spellings_collapse.
    assert canonical_dob("03/12/1995") == "03121995"
    assert canonical_dob("3 Dec 1995") == "19951203"


def test_ambiguous_numeric_keeps_digits():
    # 09/02/1991 is ambiguous (9 Feb vs 2 Sep). Must NOT be canonicalised to
    # one interpretation, or two different people could be merged.
    assert canonical_dob("09/02/1991") == "09021991"
    assert canonical_dob("09/02/1991") != canonical_dob("02/09/1991")


def test_day_first_only_when_provable():
    assert canonical_dob("24/11/1963") == "19631124"
    assert canonical_dob("05/06/1990") == "05061990"  # ambiguous -> digits


def test_two_digit_year_pivots_to_1900s():
    assert canonical_dob("14/06/88") == "19880614"
    assert canonical_dob("28 JUN 84") == "19840628"
    # 2020s two-digit year should stay 2000s (pivot at 30).
    assert canonical_dob("15/06/20") == "20200615"


def test_junk_is_empty_and_never_throws():
    assert canonical_dob("") == ""
    assert canonical_dob("   ") == ""
    assert canonical_dob("not a date") == ""
    # A compound/two-value DOB stays as raw digits, distinct from any single date.
    assert canonical_dob("14/06/1988; 14/06/1983") == "1406198814061983"


def test_identity_id_matches_across_spellings():
    a = app_identity_id("CHEN", "AIHUA", "24 NOV 1963")
    b = app_identity_id("CHEN", "AIHUA", "24/11/1963")
    assert a == b, "same person, two spellings, must share one identityId"
    # Different family stays distinct.
    assert app_identity_id("CHEN", "AIHUA", "24/11/1963") != app_identity_id("CHAN", "AIHUA", "24/11/1963")
