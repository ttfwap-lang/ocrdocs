"""Tests for the key-identifier triple-check verifier and the credit-score extractor.

These pin the OWNER REQUIREMENTS:
  * triple-check = format check + cross-source corroboration (1+ source qualifies, 2+ is
    the stronger "triple_checked" signal),
  * passport/licence are the identifiers,
  * values are trace-sourced to exact files,
  * the credit-score extractor must NOT confuse the Equifax One Score with the
    Comprehensive Score or VedaScore that sit on the same page.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

from verify_identifiers import (  # noqa: E402
    canonicalise,
    classify,
    format_ok,
    strip_country,
)
from extract_credit_score import equifax_one_score, other_scores  # noqa: E402


# --- canonicalisation -------------------------------------------------------
def test_canonicalise_strips_country_prefix_and_separators():
    assert canonicalise("CHN EH9692611") == "EH9692611"
    assert canonicalise("AUS PB2337720") == "PB2337720"
    assert canonicalise("86 605 667") == "86605667"
    assert canonicalise("081793L") == "081793L"
    # multi-value cells keep the primary (first) number
    assert canonicalise("G50429525; EF7192314") == "G50429525"


# --- passport format --------------------------------------------------------
@pytest.mark.parametrize("value", ["G50429525", "E9628011", "PB24868462", "N6354675", "RA4711509", "KJ03214586"])
def test_valid_passports(value):
    assert format_ok("passport", canonicalise(value)), value


@pytest.mark.parametrize("value", ["12345678", "G12345", "EH9****11", "not-a-passport", "G5042952512345"])
def test_invalid_passports(value):
    assert not format_ok("passport", canonicalise(value)), value


# --- licence format ---------------------------------------------------------
@pytest.mark.parametrize("value", ["081793L", "P2945484", "038608335", "011912675", "D7213998", "86605667"])
def test_valid_licences(value):
    assert format_ok("licence", canonicalise(value)), value


@pytest.mark.parametrize("value", ["ABCDEFG", "123", "P", "3101011961013112220", ""])
def test_invalid_licences(value):
    assert not format_ok("licence", canonicalise(value)), value


# --- triple-check classification -------------------------------------------
def test_single_source_is_single_source():
    tier, canon = classify("passport", "G50429525", source_count=1)
    assert tier == "single_source" and canon == "G50429525"


def test_two_or_more_sources_is_triple_checked():
    tier, _ = classify("passport", "G50429525", source_count=2)
    assert tier == "triple_checked"
    tier, _ = classify("licence", "081793L", source_count=26)
    assert tier == "triple_checked"


def test_format_fail_overrides_source_count():
    tier, canon = classify("passport", "EH9****11", source_count=5)
    assert tier == "format_fail"
    assert canon  # canonical still computed for review, value not dropped


# --- credit score: the discrimination that matters --------------------------
EQUIFAX_PAGE = (
    "Equifax Apply One Score\r\n"
    "Report for: ERYA ZHANG Data level: Comprehensive\r\n"
    "Summary\r\nScores\r\n"
    "Equifax One Score\r\n"
    "740\r\n"
    "2% chance of adverse recorded at Equifax in the next 12 months\r\n"
    "Comprehensive Score: 785 VedaScore 1.1: 697\r\n"
)


def test_credit_score_returns_equifax_one_score_not_comprehensive_or_veda():
    assert equifax_one_score(EQUIFAX_PAGE) == "740"


def test_credit_score_ignores_title_only_match():
    # A page whose only "One Score" is the title has no score under it.
    title_only = "Equifax Apply One Score\r\nReport for: SOMEONE\r\nD.O.B. 01 January 1980\r\n"
    assert equifax_one_score(title_only) is None


def test_other_scores_are_detected_but_not_returned_as_one_score():
    others = other_scores(EQUIFAX_PAGE)
    kinds = {k for k, _ in others}
    assert "comprehensive score" in kinds
    assert any(k.startswith("vedascore") for k in kinds)
    # and the main extractor still returns only the One Score
    assert equifax_one_score(EQUIFAX_PAGE) == "740"


def test_credit_score_inline_fallback():
    inline = "Credit score: 886 out of 1000. Good standing."
    assert equifax_one_score(inline) == "886"


def test_credit_score_rejects_out_of_range():
    # 95 is below a plausible credit band and must not be taken as a score.
    assert equifax_one_score("Equifax One Score\r\n95\r\n") is None
