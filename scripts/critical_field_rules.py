"""Conservative format checks for identity-critical persisted fields.

The corpus verifier answers whether a value came from a real extracted field;
it does not guarantee that a BSB/account/DOB is syntactically plausible. These
rules are deliberately format-only and never rewrite a value. They are shared
by the corpus loaders and the runtime audit so a field cannot be labelled valid
just because it came from a verified JSONL row.
"""
from __future__ import annotations

import re
from datetime import date

CRITICAL_FIELDS = (
    "Date of Birth (DOB)",
    "Bank State Branch (BSB)",
    "Australian Bank Account Number",
)

_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}


def _real_date(year: int, month: int, day: int) -> bool:
    try:
        date(year, month, day)
        return True
    except ValueError:
        return False


def _month(token: str) -> int | None:
    return _MONTHS.get(token.lower().replace(".", ""))


def _valid_dob(raw: str) -> bool:
    match = re.fullmatch(r"(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})", raw)
    if match:
        day, month, year = map(int, match.groups())
        if day > 12:
            return _real_date(year, month, day)
        return _real_date(year, month, day) or _real_date(year, day, month)
    match = re.fullmatch(r"(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})", raw)
    if match:
        return _real_date(*(int(x) for x in match.groups()))
    match = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})", raw)
    if match:
        day, month_token, year = match.groups()
        month = _month(month_token)
        return month is not None and _real_date(int(year), month, int(day))
    match = re.fullmatch(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", raw)
    if match:
        month_token, day, year = match.groups()
        month = _month(month_token)
        return month is not None and _real_date(int(year), month, int(day))
    match = re.fullmatch(r"(\d{1,2})([A-Za-z]{3,9})\.?(\d{4})", raw)
    if match:
        day, month_token, year = match.groups()
        month = _month(month_token)
        return month is not None and _real_date(int(year), month, int(day))
    match = re.fullmatch(r"(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})", raw)
    if match:
        day, month, year = map(int, match.groups())
        year += 2000 if year < 30 else 1900
        if day > 12:
            return _real_date(year, month, day)
        return _real_date(year, month, day) or _real_date(year, day, month)
    match = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{2})", raw)
    if match:
        day, month_token, year = match.groups()
        month = _month(month_token)
        year = int(year) + (2000 if int(year) < 30 else 1900)
        return month is not None and _real_date(year, month, int(day))
    return False


def classify_critical_field(name: str, value: str | None) -> tuple[bool, str]:
    """Return (format-valid, non-sensitive reason) for a persisted field."""
    raw = (str(value) if value is not None else "").strip()
    if name not in CRITICAL_FIELDS:
        return True, "not_critical"
    if not raw:
        return False, "empty"
    if name == "Bank State Branch (BSB)":
        return (bool(re.fullmatch(r"\d{3}[- ]?\d{3}", raw)), "bsb_shape")
    if name == "Australian Bank Account Number":
        compact = raw.replace(" ", "")
        return (bool(re.fullmatch(r"\d{6,10}", compact)), "account_shape")
    return (_valid_dob(raw), "dob_shape")
