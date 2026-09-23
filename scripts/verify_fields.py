#!/usr/bin/env python3
"""Full regex verifier for extracted values (the "guard between extraction and storage").

Applies the complete value-sanity logic from the repo (src/utils/valueSanity.ts -> rejectReason):
label-text, instruction-text, question, not-a-name, not-a-date, not-an-email, not-a-mobile,
not-an-address, not-an-id -- plus the APRA/pipeline numeric validators from
scripts/ocr_spark_engine.py (ABN mod-89, BSB, TFN, account number) on top.

Deltas from the TypeScript original (each one prevents genuine data from being thrown away):
  - CJK values are not judged by the English label model: they get a "cjk" review bucket instead of junk,
    and Chinese dates (1989年12月23日) pass the date check.
  - mobile accepts the international +61 04xx... form as well as 04xx/614xx.
  - STREET_WORD includes "cr" (crescent), a common Australian address abbreviation.
  - date_of_birth accepts day ordinals ("11th Nov 1986").
  - free-text fields (loan_purpose, employer_details, asset_holdings, liabilities, additional_income,
    income_verification_doc) are exempt from instruction-sentence rules: their value is the answer itself.

Every field of every ok record in --in gets a verdict: "ok", "cjk", or "junk" (+ reason), written to --out.
Rejected values are annotated, never silently deleted: --drop-rejected can remove them from --out.

Run:  python verify_fields.py --in results\\rc_extract.jsonl --out results\\rc_extract_verified.jsonl
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from typing import Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):  # corpus contains non-Latin names; never let cp1252 crash the verifier
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

LABEL_WORDS = set(
    (
        "given name names first last family surname middle other date of birth dob number phone mobile home work business "
        "address residential postal mailing email title suffix initials in full yes no male female mr mrs miss ms dr prof "
        "country occupation signature day month year dd mm yyyy preferred previous former tax file tfn contact and or the a "
        "employer employee started working for you gender sex marital status suburb state postcode town locality street "
        "unit apartment licence license passport medicare card expiry issue place age relationship "
        "withheld income amount total gross net description payer code type rate balance limit franked unfranked credit"
    ).split(" ")
)

INSTRUCTION_MARKERS = {
    "you", "your", "we", "our", "please", "must", "should", "will", "may", "if", "provide", "attach", "complete",
    "applicant", "applicants", "form", "section", "instructions", "required", "refer", "tick", "enter", "write",
}

STOP = {
    "the", "you", "your", "must", "provide", "if", "or", "of", "to", "and", "is", "are", "will", "with", "for",
    "that", "this", "may", "be", "by", "in", "on", "as", "at", "an", "a", "we", "our", "not", "from", "have",
    "has", "which", "should", "please",
}

PURE_LABELS = {"number", "address", "name", "email", "phone", "mobile", "date", "title", "suffix", "country", "details", "signature"}

ADDRESS_FIELDS = {"residential_address", "postal_address", "previous_address"}
NAME_FIELDS = {"given_names", "family_name", "middle_name", "preferred_name", "previous_name"}
# Fields whose value is the answer to a free-text question: instruction-sentence rules would reject real data.
FREE_TEXT_FIELDS = {
    "loan_purpose", "employer_details", "asset_holdings", "liability_mortgages", "liability_credit_cards",
    "liability_other_loans", "additional_income", "income_verification_doc",
}
STREET_WORD = re.compile(
    r"\b(street|st|road|rd|avenue|ave|av|drive|dr|court|ct|cr|crescent|cres|highway|hwy|parade|pde|"
    r"boulevard|blvd|terrace|tce|way|close|circuit|cct|square|sq|esplanade|esp|grove|rise|row|walk|track|trail|"
    r"mews|view|ridge|glen|loop|path|po box|gpo box|locked bag|unit|lot|apartment|apt|level)\b",
    re.I,
)

# Pipeline field name -> catalogue/verifier field id (only the ones that differ).
FIELD_ID = {"drivers_licence_number": "drivers_licence"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def field_id(name: str) -> str:
    return FIELD_ID.get(name, name)


def typed_field_rejection(fid: str, raw: str) -> Optional[str]:
    if fid == "email_address":
        return None if re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", raw) else "not-an-email"
    if fid == "mobile_number":
        digits = re.sub(r"\D", "", raw)
        # 04xx xxx xxx, +61 04xx xxx xxx, or +61 4xx xxx xxx. Excludes 13/1300/1800 business lines and landlines.
        if re.match(r"^(?:04\d{8}|614\d{8}|6104\d{8})$", digits) and not re.search(r"[a-z]{3,}", raw, re.I):
            return None
        return "not-a-mobile"
    if fid in ADDRESS_FIELDS:
        if re.search(r"\d", raw) and STREET_WORD.search(raw) and "|" not in raw and len(raw) >= 8:
            return None
        return "not-an-address"
    if fid in ("drivers_licence", "passport_details"):
        alpha_words = sum(1 for w in raw.split() if re.search(r"[a-z]{3,}", w, re.I))
        if re.search(r"\d", raw) and alpha_words <= 2 and len(raw) <= 24:
            return None
        return "not-an-id"
    return None


def strip_label_words(value: str) -> str:
    words = value.strip().split()
    is_label = lambda w: norm(w) in LABEL_WORDS or norm(w) == ""  # noqa: E731
    a, b = 0, len(words)
    while a < b and is_label(words[a]):
        a += 1
    while b > a and is_label(words[b - 1]):
        b -= 1
    return " ".join(words[a:b]).strip()


def _apra_digits(value: str) -> str:
    return re.sub(r"[^\d]", "", str(value))


def validate_abn(abn: str) -> bool:
    c = _apra_digits(abn)
    if len(c) != 11:
        return False
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    digits = [int(x) for x in c]
    digits[0] -= 1
    return sum(d * w for d, w in zip(digits, weights)) % 89 == 0


def validate_bsb(bsb: str) -> bool:
    c = _apra_digits(bsb)
    return len(c) == 6 and 1 <= int(c[:2]) <= 99 if c else False


def validate_tfn(tfn: str) -> bool:
    c = _apra_digits(tfn)
    return len(c) in (8, 9)


def validate_account(acct: str) -> bool:
    c = _apra_digits(acct)
    return 3 <= len(c) <= 20 if c else False


def validate_dob(dob: str) -> bool:
    """Real calendar date, not in the future, age 16..120 (mirrors validate_australian_dob)."""
    m = re.search(r"\b(0[1-9]|[12][0-9]|3[01])[-/.](0[1-9]|1[012])[-/.](19\d\d|20[0-2]\d)\b", str(dob))
    if not m:
        return False
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        born = date(year, month, day)
    except ValueError:
        return False
    today = date.today()
    if born > today:
        return False
    age = today.year - year - ((today.month, today.day) < (month, day))
    return 16 <= age <= 120


NUMERIC_CHECKS = {
    "bsb": (validate_bsb, "not-a-bsb"),
    "abn": (validate_abn, "not-an-abn"),
    "tax_file_number": (validate_tfn, "not-a-tfn"),
    "account_number": (validate_account, "not-an-account"),
}


def reject_reason(fid: str, value: str, own_labels: List[str] | None = None) -> Optional[str]:
    """Returns None when the value looks like real data, otherwise why it was rejected.
    CJK (Chinese) values bypass the English label-word model, which cannot judge them: they get the
    marker "cjk" (a pass, bucketed separately for review) except for date fields, which get a CJK shape check."""
    own_labels = own_labels or []
    raw = value.strip() if value else ""
    n = norm(raw)
    if not n:
        return "label-text"  # punctuation only or nothing left: there is no content
    words = n.split(" ")

    if re.search(r"[\u4e00-\u9fff]", raw):
        if fid == "date_of_birth":
            cjk_date = re.compile(r"\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日", re.I)
            return None if cjk_date.search(raw) and len(raw) <= 30 else "not-a-date"
        return "cjk"  # not junk: the English label/instruction model cannot judge CJK; review bucket

    if fid == "date_of_birth":
        # Exact valueSanity.ts behaviour: a date-ish value up to 24 chars is real data, no strict calendar gate.
        # Delta from TS: day ordinals ("11th Nov 1986") are accepted.
        dateish = re.compile(
            r"\d{1,2}\s*[\/\-. ]\s*\d{1,2}\s*[\/\-. ]\s*\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s*[a-z]{3,9}\s*\d{2,4}|"
            r"[a-z]{3,9}\s+\d{1,2},?\s+\d{4}",
            re.I,
        )
        return None if dateish.search(raw) and len(raw) <= 24 else "not-a-date"

    if raw.endswith("?"):
        return "question"

    if fid in NAME_FIELDS:
        cleaned = strip_label_words(raw)
        if not cleaned:
            return "label-text"
        if len(cleaned.split()) > 4 or re.search(r"\d", cleaned) or re.search(r"[()/\\@#]", cleaned):
            return "not-a-name"
        if fid == "family_name" and cleaned.split()[-1] in ("name", "names"):
            return "label-text"
        return None

    typed = typed_field_rejection(fid, raw)
    if typed:
        return typed

    # APRA/pipeline numeric shape checks on top of the value-sanity rejection.
    if fid in NUMERIC_CHECKS:
        check, reason = NUMERIC_CHECKS[fid]
        if not check(raw):
            return reason

    if not re.search(r"\s", raw):
        return "label-text" if n in PURE_LABELS else None
    if len(words) >= 2 and any(norm(l) == n for l in own_labels):
        return "label-text"

    labelish = sum(1 for w in words if w in LABEL_WORDS)
    if len(words) <= 10 and labelish / len(words) >= 0.8:
        return "label-text"

    markers = sum(1 for w in words if w in INSTRUCTION_MARKERS)
    stops = sum(1 for w in words if w in STOP)
    if fid not in FREE_TEXT_FIELDS:
        # Free-text fields are the answer itself: don't read their sentences as instructions ("Refinance current
        # land loan about $800K from NAB and borrow to build 5 townhouses..." is the loan purpose, not a false step).
        if len(words) >= 4 and markers >= 1:
            return "instruction-text"
        if len(words) >= 6 and stops / len(words) >= 0.3:
            return "instruction-text"
        if len(words) >= 4 and re.match(r"^[a-z]", raw):
            return "instruction-text"
    return None


def verify_record(rec: Dict) -> Tuple[Dict, Counter, Counter]:
    """Annotate every field of an ok record. Returns (record, per_reason, per_field(path-less)) counters."""
    rec = json.loads(json.dumps(rec))  # deep copy: never mutate the input
    per_reason: Counter = Counter()
    per_field: Counter = Counter()
    if not rec.get("ok"):
        return rec, per_reason, per_field
    fields = rec.get("fields") or []
    for f in fields:
        fid = field_id(f.get("name", ""))
        reason = reject_reason(fid, f.get("value", ""))
        if reason:
            if reason == "cjk":
                f["verif"] = "cjk"
            else:
                f["verif"] = "junk"
            f["reason"] = reason
        else:
            f["verif"] = "ok"
            f.pop("reason", None)
        per_reason[reason or "ok"] += 1
        per_field[f"{f.get('subject','?')}/{f.get('name','?')}"] += 0 if (reason and reason != "cjk") else 1
        per_field[f"{f.get('subject','?')}/{f.get('name','?')}|junk"] += 1 if (reason and reason != "cjk") else 0
        per_field[f"{f.get('subject','?')}/{f.get('name','?')}|cjk"] += 1 if reason == "cjk" else 0
    return rec, per_reason, per_field


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Full regex verifier for extracted values (valueSanity + APRA checks).")
    ap.add_argument("--in", dest="src", required=True, help="results JSONL from llamaparse_bulk.py")
    ap.add_argument("--out", dest="dst", help="verified JSONL (default: <in>.verified.jsonl)")
    ap.add_argument("--drop-rejected", action="store_true", help="remove fields verdict=junk from --out (default: annotate only)")
    ap.add_argument("--only-junk", action="store_true", help="write junk fields to --out/dump for review")
    a = ap.parse_args(argv)

    src, dst = a.src, a.dst or a.src.replace(".jsonl", "_verified.jsonl")
    if "{" in dst:
        dst = a.src + ".verified.jsonl"
    if dst == src:
        ap.error("--out must differ from --in")

    per_reason: Counter = Counter()
    per_field: Counter = Counter()
    ndocs = njunk_docs = 0
    out_fields: List[Dict] = []
    with open(src, encoding="utf-8") as fh, open(dst, "w", encoding="utf-8") as oh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            rec, r_c, f_c = verify_record(rec)
            per_reason.update(r_c)
            per_field.update(f_c)
            if rec.get("ok"):
                ndocs += 1
                if any(f.get("verif") == "junk" for f in (rec.get("fields") or [])):
                    njunk_docs += 1
                if a.drop_rejected and rec.get("fields"):
                    rec["fields"] = [f for f in rec["fields"] if f.get("verif") != "junk"]
            if a.only_junk and rec.get("ok"):
                for f in (rec.get("fields") or []):
                    if f.get("verif") == "junk":
                        rec.setdefault("_junk_fields", []).append(f)
            oh.write(json.dumps(rec) + "\n")

    cjk = per_reason.get("cjk", 0)
    total = sum(v for k, v in per_reason.items() if k not in ("ok", "cjk"))
    print(f"docs with ok rows: {ndocs}, docs with >=1 junk field: {njunk_docs}")
    print(f"fields: {sum(per_reason.values())} total, {per_reason['ok']} verified ok, {cjk} CJK (not judged), {total} junk")
    for reason, c in per_reason.most_common():
        if reason not in ("ok", "cjk"):
            print(f"  {reason:<18} {c}")
    print("--- junk per field (subject/name) ---")
    for f, c in sorted(per_field.items()):
        if f.endswith("|junk"):
            print(f"  {f[:-5]:<46} {c}")
    if cjk:
        print(f"--- CJK values (review bucket, {cjk} fields) ---")
        for f, c in sorted(per_field.items()):
            if f.endswith("|cjk"):
                print(f"  {f[:-4]:<46} {c}")
    print(f"verified results: {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())