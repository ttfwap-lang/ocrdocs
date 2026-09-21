"""S4 question score: which files are "even slightly questionable" and therefore go to the agent verifier.

"Questionable" is a fixed rule set, not a feeling. Every rule that fires produces a Flag naming the rule, the page and
the field, so a reviewer (or the agent) is told exactly what to look at and the flag rates can be measured on a real
corpus before the agent is switched on. Any single flag sends the file to the agent; the code never clears a flag.

Pure functions only: validators are injected so this module has no engine, network or GPU dependency.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence

LOW_HANDWRITING_CONF = 0.60
MIN_DIGITS_TOKEN = 6
IDENTITY_FIELDS = {
    "given_names", "family_name", "date_of_birth", "residential_address", "mobile_number", "email_address",
    "drivers_licence_number", "passport_details", "tax_file_number",
}
# What an applicant-owned page of each document type is expected to carry. A missing one is worth a look, not an error.
EXPECTED_FIELDS: Dict[str, List[str]] = {
    "loan_application": ["given_names", "family_name", "date_of_birth"],
    "drivers_licence": ["family_name", "date_of_birth", "drivers_licence_number"],
    "passport": ["family_name", "date_of_birth", "passport_details"],
    "bank_statement": ["account_number", "bsb"],
}

Validator = Callable[[str], Optional[bool]]


@dataclass(frozen=True)
class Flag:
    code: str
    detail: str
    page: Optional[int] = None
    field: Optional[str] = None


def digit_tokens(text: str, min_len: int = MIN_DIGITS_TOKEN) -> set:
    """Digit runs (spaces and dashes inside a number ignored) of at least min_len digits."""
    out = set()
    for m in re.finditer(r"\d[\d \-]{%d,}\d" % (min_len - 2), text or ""):
        d = re.sub(r"\D", "", m.group())
        if len(d) >= min_len:
            out.add(d)
    return out


def reader_disagreements(text_a: str, text_b: str) -> Dict[str, set]:
    """Long digit runs one printed-text reader saw and the other did not (e.g. Paddle-VL vs Chandra)."""
    a, b = digit_tokens(text_a), digit_tokens(text_b)
    return {"only_a": a - b, "only_b": b - a}


def reader_flags(reader_texts: Sequence[tuple]) -> List[Flag]:
    """READERS_DISAGREE flags from [(page_index, text_from_reader_a, text_from_reader_b)]."""
    flags: List[Flag] = []
    for page, a, b in reader_texts:
        d = reader_disagreements(a, b)
        if d["only_a"] or d["only_b"]:
            flags.append(Flag("READERS_DISAGREE", f"digit runs differ between readers: {sorted(d['only_a'] | d['only_b'])[:4]}", page))
    return flags


def question_flags(
    pages: Sequence[Mapping[str, Any]],
    fields: Sequence[Mapping[str, Any]],
    document_type: str = "other",
    validators: Optional[Mapping[str, Validator]] = None,
    reader_texts: Optional[Sequence[tuple]] = None,
    document_type_alt: Optional[str] = None,
) -> List[Flag]:
    """pages: worker page entries; fields: worker vlm field dicts; validators: {field name: text -> True/False/None};
    reader_texts: [(page_index, text_from_reader_a, text_from_reader_b)] when a second reader ran."""
    validators = validators or {}
    flags: List[Flag] = []

    for p in pages:
        idx = p.get("imageIndex")
        if p.get("degraded"):
            flags.append(Flag("PAGE_DEGRADED", "a reader or Qwen was unavailable for this page", idx))
        if p.get("kind") == "uncertain":
            flags.append(Flag("PAGE_KIND_UNCERTAIN", "triage could not tell printed from handwritten", idx))

    if document_type in ("other", "mixed", "", None):
        flags.append(Flag("DOC_TYPE_UNSURE", f"document type is '{document_type or 'unknown'}'"))
    if document_type_alt:
        flags.append(Flag("DOC_TYPE_DISAGREE", f"the local read says '{document_type_alt}', the cloud classifier says '{document_type}'"))

    applicant_values: Dict[str, set] = defaultdict(set)
    for f in fields:
        name, value = f.get("name", ""), str(f.get("value", ""))
        page = f.get("imageIndex")
        subject = f.get("subject", "unknown")
        if f.get("alternateValue"):
            flags.append(Flag("SOURCES_DISAGREE", f"'{value}' vs '{f['alternateValue']}' read by {f.get('alternateSource', 'the other source')}", page, name))
        if f.get("digits_verified") is False:
            flags.append(Flag("DIGITS_NOT_READ", f"'{value}' contains digits no OCR engine read", page, name))
        if f.get("source") == "handwriting" and float(f.get("confidence", 1.0)) < LOW_HANDWRITING_CONF:
            flags.append(Flag("LOW_CONFIDENCE", f"handwritten '{value}' read at {float(f.get('confidence', 0)):.2f}", page, name))
        check = validators.get(name)
        if check is not None and check(value) is False:
            flags.append(Flag("INVALID_VALUE", f"'{value}' fails the {name} check", page, name))
        if name in IDENTITY_FIELDS and subject == "unknown":
            flags.append(Flag("OWNER_UNKNOWN", f"no owner stated for {name}='{value}'", page, name))
        if subject in ("applicant", "unknown"):
            applicant_values[name].add(re.sub(r"[^a-z0-9]", "", value.lower()))

    for name, vals in applicant_values.items():
        vals.discard("")
        if name in IDENTITY_FIELDS and len(vals) > 1:
            flags.append(Flag("OWNER_AMBIGUOUS", f"{len(vals)} different applicant values for {name}", None, name))

    have = {f.get("name") for f in fields if f.get("subject") in ("applicant", "unknown")}
    for name in EXPECTED_FIELDS.get(document_type, []):
        if name not in have:
            flags.append(Flag("MISSING_EXPECTED", f"a {document_type} normally has {name}", None, name))

    return flags + reader_flags(reader_texts or [])


def needs_agent(flags: Sequence[Flag]) -> bool:
    return bool(flags)


def flag_rates(per_file_flags: Iterable[Sequence[Flag]]) -> Dict[str, Any]:
    """Corpus summary: how many files each rule flags, so the agent's workload is known before it is enabled."""
    files = [list(f) for f in per_file_flags]
    by_code: Counter = Counter()
    for fl in files:
        for code in {f.code for f in fl}:
            by_code[code] += 1
    total = len(files)
    return {
        "files": total,
        "flagged": sum(1 for f in files if f),
        "flagged_pct": round(100 * sum(1 for f in files if f) / total, 1) if total else 0.0,
        "by_rule": dict(by_code.most_common()),
    }
