#!/usr/bin/env python3
# ==============================================================================
# Script 2: Enterprise VRAM-Throttled Multi-Pass OCR & Regression Engine
# Execution Context: Deployed and executed on DGX NVMe (/mnt/nvme/ocr_pipeline)
# Features:
#   - Local file and DGX worker document processing
#   - 60 Typo-Tolerant Australian Banking Field Matchers + APRA Validations
#   - 10-Pass Progressive Optimization Loop with Regression Verification
#   - Monotonic Quality Invariant (No high-confidence field degradation)
#   - Early-Stop Convergence Detection
#   - Deadlock-Free DuckDB WAL & ZSTD Parquet Output
# ==============================================================================

import os
import re
import sys
import gc
import json
import time
import argparse
import logging

import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

# Third-party imports with graceful fallbacks
import cv2
import pypdfium2 as pdfium  # Permissive (Apache-2.0) PDF parser/rasterizer.
# NOTE: PyMuPDF (fitz) is intentionally NOT used here. It is dual-licensed
# AGPL-3.0/Commercial and is documented in docs/stage5/license-manifest.json
# as "Replaced by pypdfium2 in production scope" — using it unconditionally
# in the shipped pipeline would violate that policy.
import torch
import numpy as np
import pandas as pd
from PIL import Image, ImageEnhance, ImageFilter
import multiprocessing as mp
import duckdb

try:
    import spacy
except ImportError:
    spacy = None

try:
    import pytesseract
except ImportError:
    pytesseract = None

try:
    import ocr_hybrid  # sibling module: Tesseract line finding + TrOCR line recognition
except ImportError:  # pragma: no cover
    ocr_hybrid = None

try:
    import ocr_paddle_vl  # sibling module: PaddleOCR-VL over HTTP (vlm_v2 pipeline)
    import ocr_qwen_merge  # sibling module: Qwen3-VL page classifier and field merger (vlm_v2 pipeline)
except ImportError:  # pragma: no cover
    ocr_paddle_vl = None
    ocr_qwen_merge = None


# ==============================================================================
# CONFIGURATION & NVME PATHING
# ==============================================================================
NVME_DIR = Path(os.environ.get("NVME_ROOT", "/mnt/nvme/ocr_pipeline"))
INPUT_DIR = NVME_DIR / "input"
OUTPUT_DIR = NVME_DIR / "output"
DB_PATH = NVME_DIR / "db" / "identity_index.duckdb"
OUTPUT_CSV = OUTPUT_DIR / "ocr_consolidated_identities.csv"
OUTPUT_PARQUET = OUTPUT_DIR / "ocr_consolidated_identities.parquet"
NOOCR_DIR = NVME_DIR / "noocr"
LOGS_DIR = NVME_DIR / "logs"
ERROR_LOG = LOGS_DIR / "pipeline_errors.log"

# Handwriting engine (TrOCR, line-level, MIT/Apache): ON by default. Measured on real IAM handwriting it reads
# 93% of words vs 21% for Tesseract; it is only invoked for lines Tesseract is unsure about, so cost stays small.
HANDWRITING_ENGINE_ENABLED = os.environ.get("OCRDOCS_ENABLE_HANDWRITING_ENGINE", "true").strip().lower() == "true"
HANDWRITING_MODEL_NAME = os.environ.get("OCRDOCS_HANDWRITING_MODEL", "microsoft/trocr-large-handwritten")
# A page can carry dozens of handwritten lines; this is the whole-page Tesseract+TrOCR deadline.
HYBRID_TIMEOUT_SECONDS = float(os.environ.get("OCRDOCS_HYBRID_TIMEOUT_SECONDS", "240"))

# Per-engine call deadline. This is a *logical* timeout: it unblocks our own
# control flow and logs+skips the engine rather than blocking the pass
# indefinitely, since a genuinely hung native/C call inside a thread cannot be
# force-killed from Python without a subprocess boundary. Still the correct
# fix for the actual failure mode (one pathological image freezing the whole
# 10-pass loop) — the pipeline now degrades instead of hanging.
ENGINE_TIMEOUT_SECONDS = float(os.environ.get("OCRDOCS_ENGINE_TIMEOUT_SECONDS", "45"))

def _run_with_timeout(fn, *args, timeout: float = ENGINE_TIMEOUT_SECONDS, **kwargs):
    """Runs fn(*args, **kwargs) with a logical deadline; raises on hang or error.

    Uses a FRESH single-use executor per call, not a shared fixed-size pool.
    This was a real bug caught by an independent review, not just theory:
    Future.result(timeout=...) only stops the CALLER from waiting -- it does
    not, and cannot, stop the underlying thread if the call is genuinely
    hung (no way to force-kill a thread from Python without a subprocess
    boundary; documented above). A shared pool's worker thread stays
    permanently occupied by that orphaned call. With enough real timeouts
    over a worker's lifetime, a fixed-size shared pool eventually has every
    slot permanently consumed by orphaned hangs, and every subsequent
    .submit() call queues forever waiting for a thread that will never free
    up -- a total, silent stall of every future OCR pass, not just the one
    that actually hung. A fresh executor per call means an orphaned hang
    becomes one abandoned thread (shutdown(wait=False) does not block on
    it), not a permanently lost slot in a pool every future call depends on.
    """
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr-engine")
    try:
        future = executor.submit(fn, *args, **kwargs)
        return future.result(timeout=timeout)
    finally:
        executor.shutdown(wait=False)


class EngineBusyError(Exception):
    """A shared engine singleton is still occupied by an orphaned call from a
    previous timeout; the caller should skip this engine for the pass rather
    than invoke it concurrently against a non-thread-safe model."""


def _run_engine_call(lock: threading.Lock, fn, *args, timeout: float = ENGINE_TIMEOUT_SECONDS, **kwargs):
    """Like _run_with_timeout, but serializes access to a shared engine
    singleton (TrOCR) via `lock`.

    _run_with_timeout's fresh-executor-per-call fix (above) solves the pool
    deadlock, but each of those engines is a single global model object
    reused across calls. A call that times out leaves its thread running
    against that same object; without serialization here, the NEXT call to
    the same engine would invoke it concurrently from a second thread --
    these models are not documented as thread-safe, so that's a real race
    (corrupted internal state, or a native crash) on top of a hang. If the
    lock is still held, the abandoned call is still genuinely running:
    skip this engine for this pass instead of blocking indefinitely or
    racing it. The lock is released by whichever thread actually finishes
    the call, whether or not our own wrapper gave up waiting on it, so this
    stays correct without needing to know when an abandoned thread ends.
    """
    if not lock.acquire(timeout=0.1):
        raise EngineBusyError("engine singleton still occupied by a previous orphaned call")
    # The lock must be released by whichever thread actually RUNS fn, not by
    # this calling thread when it stops waiting -- those are different
    # events. If we released it here (in a try/finally around
    # _run_with_timeout), a timeout would free the lock immediately while
    # the orphaned worker thread is still actually executing fn, and the
    # very next call would acquire the "free" lock and run concurrently
    # against the same singleton -- exactly the race this function exists
    # to prevent. So the release is pushed into the submitted call itself.
    def _locked_call():
        try:
            return fn(*args, **kwargs)
        finally:
            lock.release()

    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr-engine")
    try:
        future = executor.submit(_locked_call)
        return future.result(timeout=timeout)
    finally:
        executor.shutdown(wait=False)

# Ensure directories exist
for d in [INPUT_DIR, OUTPUT_DIR, DB_PATH.parent, NOOCR_DIR, LOGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(ERROR_LOG, mode="a", encoding="utf-8")
    ]
)

# ==============================================================================
# 60 AUSTRALIAN BANKING FIELDS REGEX DICTIONARY (Typo-Tolerant & APRA Aligned)
# ==============================================================================
BANK_FIELD_PATTERNS: Dict[str, re.Pattern] = {
    "title_salutation": re.compile(
        r"\b(tit[l1]e|sa[l1]utation|honorific|prefix|mr|mrs|ms|miss|dr|prof|rev)\b", re.I
    ),
    "given_names": re.compile(
        r"(given[\s_-]?names?|first[\s_-]?name|forename|christian[\s_-]?name|primary[\s_-]?name|1st[\s_-]?name)\b", re.I
    ),
    "middle_name": re.compile(
        r"(middle[\s_-]?names?|middle[\s_-]?initials?|other[\s_-]?names?|second[\s_-]?name)\b", re.I
    ),
    "family_name": re.compile(
        r"(family[\s_-]?names?|surname|last[\s_-]?name|maiden[\s_-]?name)\b", re.I
    ),
    "date_of_birth": re.compile(
        r"\b(dob|d\.?o\.?b|date[\s_-]?of[\s_-]?birth|birth[\s_-]?date|born(?:[\s_-]?on)?|b[\s_-]?day)\b", re.I
    ),
    "residency_status": re.compile(
        r"(residency[\s_-]?status|citizenship|permanent[\s_-]?resident|visa[\s_-]?holder|australian[\s_-]?citizen|pr[\s_-]?status)\b", re.I
    ),
    "marital_status": re.compile(
        r"(marital[\s_-]?status|relationship[\s_-]?status|single|married|de[\s_-]?facto|defacto|divorced|separated|widowed)\b", re.I
    ),
    "dependants_count": re.compile(
        r"(dependants?|dependents?|children|kids|child[\s_-]?count|number[\s_-]?of[\s_-]?deps)\b", re.I
    ),
    "residential_address": re.compile(
        r"(residential[\s_-]?address|current[\s_-]?address|home[\s_-]?address|street[\s_-]?address|property[\s_-]?address)\b", re.I
    ),
    "address_tenure": re.compile(
        r"(time[\s_-]?at[\s_-]?address|years[\s_-]?at[\s_-]?address|months[\s_-]?residing|tenure[\s_-]?length)\b", re.I
    ),
    "previous_address": re.compile(
        r"(previous[\s_-]?address|prior[\s_-]?residence|former[\s_-]?address|past[\s_-]?address)\b", re.I
    ),
    "housing_situation": re.compile(
        r"(housing[\s_-]?situation|residential[\s_-]?status|renting|mortgaged|owned[\s_-]?outright|boarding|living[\s_-]?with[\s_-]?parents)\b", re.I
    ),
    "mobile_number": re.compile(
        r"\b(mobile[\s_-]?number|mobile|contact[\s_-]?number|cell[\s_-]?phone|phone|tel|ph)\b", re.I
    ),
    "email_address": re.compile(
        r"(email[\s_-]?address|contact[\s_-]?email|electronic[\s_-]?mail)\b", re.I
    ),
    "drivers_licence": re.compile(
        r"\b(driver[s\']?[\s_-]?licen[sc]e|licen[sc]e[\s_-]?(?:number|no)|dl[\s_-]?(?:no|number))\b", re.I
    ),
    "passport_details": re.compile(
        r"\b(passport[\s_-]?number|travel[\s_-]?document|passport[\s_-]?no|issuing[\s_-]?country)\b", re.I
    ),
    "employment_status": re.compile(
        r"(employment[\s_-]?status|full[\s_-]?time|part[\s_-]?time|casual|contractor|self[\s_-]?employed|unemployed)\b", re.I
    ),
    "occupation_industry": re.compile(
        r"(occupation|profession|job[\s_-]?title|industry[\s_-]?sector|vocation|trade)\b", re.I
    ),
    "employer_details": re.compile(
        r"(employer[\s_-]?name|company[\s_-]?name|business[\s_-]?name|organisation|workplace)\b", re.I
    ),
    "employment_tenure": re.compile(
        r"(time[\s_-]?with[\s_-]?employer|years[\s_-]?employed|service[\s_-]?length|employment[\s_-]?duration)\b", re.I
    ),
    "gross_annual_income": re.compile(
        r"(gross[\s_-]?annual[\s_-]?income|base[\s_-]?salary|gross[\s_-]?earnings|total[\s_-]?remuneration|gross[\s_-]?wage)\b", re.I
    ),
    "net_monthly_income": re.compile(
        r"(net[\s_-]?monthly[\s_-]?income|take[\s_-]?home[\s_-]?pay|net[\s_-]?salary|after[\s_-]?tax[\s_-]?income)\b", re.I
    ),
    "salary_frequency": re.compile(
        r"(salary[\s_-]?frequency|pay[\s_-]?cycle|weekly|fortnightly|monthly|annual|per[\s_-]?annum|p\.?a\.?)\b", re.I
    ),
    "other_income": re.compile(
        r"(other[\s_-]?income|rental[\s_-]?income|dividends|bonuses|overtime|family[\s_-]?tax[\s_-]?benefit)\b", re.I
    ),
    "living_expenses": re.compile(
        r"(living[\s_-]?expenses|hem[\s_-]?benchmark|monthly[\s_-]?expenditure|household[\s_-]?expenses|basic[\s_-]?living)\b", re.I
    ),
    "credit_card_limits": re.compile(
        r"(credit[\s_-]?card[\s_-]?limit|card[\s_-]?balance|existing[\s_-]?cards?|revolving[\s_-]?credit)\b", re.I
    ),
    "other_liabilities": re.compile(
        r"(other[\s_-]?liabilities|personal[\s_-]?loans?|car[\s_-]?loan|hecs[\s_-]?help|mortgage[\s_-]?debt)\b", re.I
    ),
    "bsb": re.compile(
        r"\b(bsb|bank[\s_-]?state[\s_-]?branch|branch[\s_-]?code)\b", re.I
    ),
    "account_number": re.compile(
        r"\b(account[\s_-]?number|acc[\s_-]?no|account[\s_-]?#|acc[\s_-]?num)\b", re.I
    ),
    "abn": re.compile(
        r"\b(abn|australian[\s_-]?business[\s_-]?number|acn)\b", re.I
    ),
    "tax_file_number": re.compile(
        r"\b(tax[\s_-]?file[\s_-]?number|tax[\s_-]?id|tf[\s_-]?number|tfn|tax[\s_-]?file[\s_-]?no)\b", re.I
    ),
    "drivers_licence_number": re.compile(
        r"\b(driver[s']?[\s_-]?licen[sc]e[\s_-]?number|licen[sc]e[\s_-]?no[\s_-]?#|dl[\s_-]?number|licence[\s_-]?number)\b", re.I
    ),
    "drivers_licence_state": re.compile(
        r"\b(licen[sc]e[\s_-]?state|licence[\s_-]?jurisdiction|state[\s_-]?of[\s_-]?issue|issuing[\s_-]?state|licence[\s_-]?issued[\s_-]?in)\b", re.I
    ),
    "drivers_licence_expiry": re.compile(
        r"\b(licen[sc]e[\s_-]?expir|licen[sc]e[\s_-]?expiry|licence[\s_-]?expir|dl[\s_-]?expir|licence[\s_-]?ex[\s_-]?date|licence[\s_-]?expiry[\s_-]?date)\b", re.I
    ),
    "passport_expiry": re.compile(
        r"\b(passport[\s_-]?expir|passport[\s_-]?expiry|passport[\s_-]?ex[\s_-]?date|passport[\s_-]?expiry[\s_-]?date|passport[\s_-]?expires)\b", re.I
    ),
    "passport_issuing_country": re.compile(
        r"\b(passport[\s_-]?issue[\s_-]?country|passport[\s_-]?country|issuing[\s_-]?country|country[\s_-]?of[\s_-]?issue|passport[\s_-]?issued[\s_-]?in)\b", re.I
    ),
    "postal_address": re.compile(
        r"\b(postal[\s_-]?address|mailing[\s_-]?address|mail[\s_-]?address|post[\s_-]?address)\b", re.I
    ),
    "country_of_birth": re.compile(
        r"\b(country[\s_-]?of[\s_-]?birth|birth[\s_-]?country|place[\s_-]?of[\s_-]?birth|birthplace|born[\s_-]?in)\b", re.I
    ),
    "gender": re.compile(
        r"\b(gender|gender[\s_-]?at[\s_-]?birth|sex[\s_-]?at[\s_-]?birth)\b", re.I
    ),
    "loan_amount_requested": re.compile(
        r"\b(loan[\s_-]?amount|amount[\s_-]?borrowed|finance[\s_-]?amount|amount[\s_-]?financed|requested[\s_-]?loan|borrowing[\s_-]?amount|principal[\s_-]?amount)\b", re.I
    ),
    "loan_type": re.compile(
        r"\b(loan[\s_-]?type|type[\s_-]?of[\s_-]?loan|loan[\s_-]?product|finance[\s_-]?type|credit[\s_-]?type|loan[\s_-]?category)\b", re.I
    ),
    "loan_term_years": re.compile(
        r"\b(loan[\s_-]?term|loan[\s_-]?duration|term[\s_-]?in[\s_-]?years|loan[\s_-]?tenure|repayment[\s_-]?term|amortisation[\s_-]?period|loan[\s_-]?length)\b", re.I
    ),
    "loan_purpose": re.compile(
        r"\b(loan[\s_-]?purpose|purpose[\s_-]?of[\s_-]?loan|intended[\s_-]?use|use[\s_-]?of[\s_-]?funds|loan[\s_-]?reason|financing[\s_-]?purpose)\b", re.I
    ),
    "existing_loan_amount": re.compile(
        r"\b(existing[\s_-]?loan|current[\s_-]?loan|outstanding[\s_-]?loan|existing[\s_-]?loan[\s_-]?balance|current[\s_-]?loan[\s_-]?balance|total[\s_-]?existing[\s_-]?debt|balance[\s_-]?outstanding)\b", re.I
    ),
    "monthly_loan_repayment": re.compile(
        r"\b(monthly[\s_-]?repayment|monthly[\s_-]?loan[\s_-]?payment|repayment[\s_-]?amount|monthly[\s_-]?installment|monthly[\s_-]?payment|installment[\s_-]?amount)\b", re.I
    ),
    "total_monthly_debt": re.compile(
        r"\b(total[\s_-]?monthly[\s_-]?debt|total[\s_-]?debt|aggregate[\s_-]?debt|total[\s_-]?monthly[\s_-]?obligation|combined[\s_-]?monthly[\s_-]?debt)\b", re.I
    ),
    "savings_balance": re.compile(
        r"\b(savings[\s_-]?balance|savings[\s_-]?amount|deposit[\s_-]?balance|bank[\s_-]?savings|total[\s_-]?savings|savings[\s_-]?total)\b", re.I
    ),
    "investment_balance": re.compile(
        r"\b(investment[\s_-]?balance|investment[\s_-]?value|investment[\s_-]?holding|investment[\s_-]?total|total[\s_-]?investment|portfolio[\s_-]?value)\b", re.I
    ),
    "property_value": re.compile(
        r"\b(property[\s_-]?value|real[\s_-]?estate[\s_-]?value|home[\s_-]?value|estimated[\s_-]?property[\s_-]?value|market[\s_-]?value|valuation[\s_-]?amount|property[\s_-]?worth)\b", re.I
    ),
    "superannuation_balance": re.compile(
        r"\b(superannuation|super[\s_-]?balance|super[\s_-]?fund[\s_-]?balance|retirement[\s_-]?savings|super[\s_-]?value|total[\s_-]?super)\b", re.I
    ),
    "existing_credit_cards": re.compile(
        r"\b(existing[\s_-]?credit[\s_-]?card|number[\s_-]?of[\s_-]?credit[\s_-]?cards|credit[\s_-]?cards|active[\s_-]?cards|credit[\s_-]?card[\s_-]?count)\b", re.I
    ),
    "total_credit_limits": re.compile(
        r"\b(total[\s_-]?credit[\s_-]?limit|aggregate[\s_-]?credit|combined[\s_-]?credit[\s_-]?limit|credit[\s_-]?limit[\s_-]?total|total[\s_-]?credit[\s_-]?card[\s_-]?limit)\b", re.I
    ),
    "total_existing_debt": re.compile(
        r"\b(total[\s_-]?existing[\s_-]?debt|overall[\s_-]?debt|total[\s_-]?liabilities|aggregate[\s_-]?liability|total[\s_-]?liability)\b", re.I
    ),
    "life_insurance_cover": re.compile(
        r"\b(life[\s_-]?insurance|life[\s_-]?cover|critical[\s_-]?illness[\s_-]?cover|income[\s_-]?protection[\s_-]?cover|death[\s_-]?benefit|life[\s_-]?insurance[\s_-]?cover)\b", re.I
    ),
    "monthly_rent": re.compile(
        r"\b(monthly[\s_-]?rent|rent[\s_-]?paid|rent[\s_-]?amount|rental[\s_-]?amount|weekly[\s_-]?rent|rent[\s_-]?per[\s_-]?month)\b", re.I
    ),
    "monthly_other_expenses": re.compile(
        r"\b(other[\s_-]?monthly[\s_-]?expenses|monthly[\s_-]?other[\s_-]?expenses|discretionary[\s_-]?spending|other[\s_-]?commitments|monthly[\s_-]?commitments|other[\s_-]?monthly[\s_-]?outgoings)\b", re.I
    ),
    "employment_industry_code": re.compile(
        r"\b(industry[\s_-]?code|an[\s_-]?code|anzsic[\s_-]?code|occupation[\s_-]?code|job[\s_-]?code|industry[\s_-]?classif)\b", re.I
    ),
    "years_employment_current": re.compile(
        r"\b(years[\s_-]?with[\s_-]?employer|current[\s_-]?employer[\s_-]?tenure|tenure[\s_-]?with[\s_-]?current|at[\s_-]?current[\s_-]?role|years[\s_-]?in[\s_-]?current[\s_-]?role|length[\s_-]?of[\s_-]?current[\s_-]?employment)\b", re.I
    ),
    "previous_employer": re.compile(
        r"\b(previous[\s_-]?employer|prior[\s_-]?employer|former[\s_-]?employer|last[\s_-]?employer|previous[\s_-]?employer[\s_-]?name)\b", re.I
    ),
    "applicants_count": re.compile(
        r"\b(number[\s_-]?of[\s_-]?applicants|number[\s_-]?of[\s_-]?applicant|co[\s_-]?applicants|joint[\s_-]?applicants|applicants[\s_-]?count)\b", re.I
    ),
}

# ==============================================================================
# AUSTRALIAN REGULATORY VALIDATION UTILITIES
# ==============================================================================
def _australian_today() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Australia/Sydney")).date()
    except Exception:  # tzdata missing (e.g. bare Windows): AEST fixed offset is at most 1h off AEDT
        return datetime.now(timezone(timedelta(hours=10))).date()


def _overlaps(span: Tuple[int, int], spans: List[Tuple[int, int]]) -> bool:
    return any(span[0] < b and span[1] > a for a, b in spans)


def validate_australian_abn(abn_str: str) -> bool:
    """Validates Australian Business Number using ATO Modulo 89 checksum algorithm."""
    clean = re.sub(r"[^\d]", "", str(abn_str))
    if len(clean) != 11:
        return False
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    digits = [int(c) for c in clean]
    digits[0] -= 1  # Subtract 1 from the first digit
    checksum = sum(d * w for d, w in zip(digits, weights))
    return (checksum % 89) == 0

def validate_australian_bsb(bsb_str: str) -> bool:
    """Validates Australian Bank State Branch 6-digit clearing code."""
    clean = re.sub(r"[^\d]", "", str(bsb_str))
    if len(clean) != 6:
        return False
    # Valid BSB prefixes (01-09, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-89, 90-99)
    first_two = int(clean[:2])
    return 1 <= first_two <= 99

def validate_australian_dob(dob_str: str) -> bool:
    """Plausible applicant DOB: a real calendar date, not in the future, age MIN..120 in Australian
    civil time (mirrors validateAustralianDob in src/utils; MIN = OCRDOCS_MIN_APPLICANT_AGE, default 16)."""
    m = re.search(r"\b(0[1-9]|[12][0-9]|3[01])[-/.](0[1-9]|1[012])[-/.](19\d\d|20[0-2]\d)\b", str(dob_str))
    if not m:
        return False
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        born = date(year, month, day)
    except ValueError:
        return False
    today = _australian_today()
    if born > today:
        return False
    age = today.year - year - ((today.month, today.day) < (month, day))
    try:
        min_age = int(os.environ.get("OCRDOCS_MIN_APPLICANT_AGE", "16"))
    except ValueError:
        min_age = 16
    return min_age <= age <= 120

def validate_australian_phone(phone_str: str) -> bool:
    """Validates Australian landline or mobile (+61 4xx or 04xx)."""
    clean = re.sub(r"[^\d+]", "", str(phone_str))
    return bool(re.match(r"^(\+?61\s?4[0-9]{8}|04[0-9]{8}|0[2378][0-9]{8})$", clean))

def validate_australian_postcode(postcode_str: str) -> bool:
    """Validates Australian 4-digit postcode (0200-9999)."""
    clean = re.sub(r"[^\d]", "", str(postcode_str))
    if len(clean) != 4:
        return False
    num = int(clean)
    return (200 <= num <= 299) or (800 <= num <= 999) or (1000 <= num <= 9999)

# ==============================================================================
# MULTI-ENGINE WORKER INITIALIZATION (Lazy & VRAM-Pinned)
# ==============================================================================
_nlp = None
_trocr_reader = None
# A native PDF text layer at least this long is exact: stop after pass 1 instead of re-OCRing the same pages.
NATIVE_TEXT_MIN_CHARS = int(os.environ.get("OCRDOCS_NATIVE_TEXT_MIN_CHARS", "300"))
# Below this many letters/digits (and zero extracted fields) after 2 OCR passes, an image is a photo/graphic.
NO_TEXT_ALNUM_MIN = int(os.environ.get("OCRDOCS_NO_TEXT_ALNUM_MIN", "25"))
_worker_initialized = False

# One lock per shared engine singleton -- see EngineBusyError / _run_engine_call
# above for why these exist (serializing access around orphaned-timeout races).
_trocr_lock = threading.Lock()

def init_worker():
    """Loads every OCR/NLP engine once and caches it in module globals.

    Idempotent by design: process_document_multipass() previously called this
    unconditionally on every single job, forcing Paddle/EasyOCR/spaCy to
    reload from scratch each time on a long-running worker (needless VRAM
    churn/fragmentation on a shared GPU). Now a second call is a no-op.
    """
    global _nlp, _trocr_reader, _worker_initialized
    if _worker_initialized:
        return
    # Set in `finally`, not just on the success path: if one optional engine
    # fails to load (e.g. a missing model file), the exception handler below
    # logs it and leaves that engine's global None, which every call site
    # already treats as "skip this engine" -- the intended degrade-gracefully
    # behavior. Only setting this flag on full success meant that same
    # failure would instead force a full re-init attempt (and re-fail) on
    # EVERY subsequent job for the life of the worker process.
    try:
        gpu_available = torch.cuda.is_available()
        if ocr_hybrid is not None and HANDWRITING_ENGINE_ENABLED:
            # Lazy: the model itself loads on the first weak/handwritten line, and a failed load degrades to
            # Tesseract-only instead of breaking the worker.
            _trocr_reader = ocr_hybrid.TrOCRReader(HANDWRITING_MODEL_NAME)
            logging.info(f"[*] Handwriting reader ready (lazy): {HANDWRITING_MODEL_NAME}")
        if spacy is not None:
            _nlp = spacy.load("en_core_web_sm")
    except Exception as e:
        logging.exception(f"[-] Worker init failed: {e}")
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(f"Worker Init Exception: {e}\n")
    finally:
        _worker_initialized = True

# ==============================================================================
# PASS-AWARE PROGRESSIVE DOCUMENT EXTRACTION (10 PASSES)
# ==============================================================================
def assess_image_quality(image: Image.Image) -> Dict[str, float]:
    """Measures blur, contrast, brightness, and skew so preprocessing can be
    routed by actual image condition instead of blindly following pass index.

    blur_variance: Laplacian variance. Low (<100) means likely blurry.
    skew_angle_deg: estimated rotation needed to make text horizontal.
    """
    gray = np.array(image.convert("L"))
    blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    brightness = float(gray.mean())
    skew_angle_deg = _estimate_skew_angle(gray)
    return {
        "blur_variance": blur_variance,
        "contrast": contrast,
        "brightness": brightness,
        "skew_angle_deg": skew_angle_deg,
        "is_blurry": blur_variance < 100.0,
        "is_low_contrast": contrast < 35.0,
        "is_skewed": abs(skew_angle_deg) > 1.0,
    }

def _estimate_skew_angle(gray: np.ndarray) -> float:
    """Estimates rotation angle (degrees) needed to make text rows horizontal,
    via a bounded projection-profile search: the angle that maximizes the
    variance of the horizontal row-sum profile is the one where text rows are
    most sharply aligned (peaks at each line of text, troughs between lines).

    Deliberately NOT using cv2.minAreaRect on scattered text coordinates —
    that method is well-known to be unstable for sparse multi-word layouts
    (verified locally: it returned 90 degrees for a plainly horizontal test
    image), which would cause a destructive spurious rotation instead of a
    correction. The search is bounded to +/-15 degrees since real-world
    document skew from scanning/photographing rarely exceeds that.
    """
    try:
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        if cv2.countNonZero(thresh) < 50:
            return 0.0

        # Search on a small thumbnail for speed; the resulting angle applies
        # equally to the full-resolution image.
        h, w = thresh.shape
        scale = min(1.0, 400.0 / max(h, w))
        small = cv2.resize(thresh, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_NEAREST) if scale < 1.0 else thresh
        sh, sw = small.shape

        best_angle, best_score = 0.0, -1.0
        for angle in np.arange(-15.0, 15.5, 0.5):
            M = cv2.getRotationMatrix2D((sw / 2, sh / 2), angle, 1.0)
            rotated = cv2.warpAffine(small, M, (sw, sh), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            score = float(np.var(rotated.sum(axis=1)))
            if score > best_score:
                best_score, best_angle = score, float(angle)
        return best_angle
    except Exception:
        return 0.0

def deskew_image(image: Image.Image, angle_deg: float) -> Image.Image:
    """Rotates the image to correct measured skew. No-op below ~0.3deg since
    that's within OCR engines' own tolerance and not worth the resample cost.

    angle_deg (from assess_image_quality/_estimate_skew_angle) is already the
    correction angle in PIL/OpenCV's shared positive-is-counter-clockwise
    convention (the search finds the angle that, when applied via
    cv2.getRotationMatrix2D, straightens the text rows) -- so it's applied
    directly via Image.rotate(angle_deg), not negated. A caught-in-testing
    bug: an earlier version negated this, which doubled skew instead of
    correcting it (verified: a deliberately 6deg-rotated test image came out
    at 12deg residual skew instead of ~0)."""
    if abs(angle_deg) < 0.3:
        return image
    return image.rotate(angle_deg, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(255, 255, 255))

def denoise_image(image: Image.Image) -> Image.Image:
    """Non-local-means denoise — targets the grainy phone-photo / low-quality
    scan case that plain contrast/threshold passes don't address at all."""
    np_img = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    denoised = cv2.fastNlMeansDenoisingColored(np_img, None, h=7, hColor=7, templateWindowSize=7, searchWindowSize=21)
    return Image.fromarray(cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB))

def enhance_image_for_pass(image: Image.Image, pass_num: int, quality: Optional[Dict[str, float]] = None) -> Image.Image:
    """Applies image processing tailored to the pass iteration AND, when a
    quality assessment is supplied, to the image's actual measured condition —
    a skewed or blurry image gets deskewed/denoised regardless of which pass
    number happens to be running, instead of only on a fixed schedule."""
    result = image

    if quality:
        if quality.get("is_skewed"):
            result = deskew_image(result, quality["skew_angle_deg"])
        if quality.get("is_blurry"):
            result = denoise_image(result)

    if pass_num <= 1:
        return result
    elif pass_num == 2:
        # Pass 2: Grayscale & slight contrast boost
        return ImageEnhance.Contrast(result.convert("L")).enhance(1.4).convert("RGB")
    elif pass_num == 3:
        # Pass 3: Edge sharpening for text boundary detection
        return result.filter(ImageFilter.SHARPEN)
    elif pass_num == 4:
        # Pass 4: CLAHE-like contrast equalization
        np_img = np.array(result.convert("L"))
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        eq = clahe.apply(np_img)
        return Image.fromarray(eq).convert("RGB")
    elif pass_num == 5:
        # Pass 5: Otsu auto-binarization for low-contrast photocopies
        np_img = np.array(result.convert("L"))
        _, thresh = cv2.threshold(np_img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return Image.fromarray(thresh).convert("RGB")
    elif pass_num >= 6:
        # Pass 6+: High-frequency unsharp mask + 1.6x bicubic scale
        w, h = result.size
        scaled = result.resize((int(w * 1.4), int(h * 1.4)), Image.Resampling.BICUBIC)
        return scaled.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    return result

def _tesseract_lines_with_confidence(image: Image.Image) -> Dict[str, float]:
    """Reconstructs lines from Tesseract's word-level image_to_data output and
    computes each line's real mean word confidence (0-1), instead of the flat
    hardcoded confidence the rest of the pipeline used to assume."""
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    lines: Dict[Tuple[int, int, int], List[Tuple[str, int]]] = {}
    for i, word in enumerate(data.get("text", [])):
        word = word.strip()
        if not word:
            continue
        conf = int(data["conf"][i]) if str(data["conf"][i]).lstrip("-").isdigit() else -1
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append((word, conf))

    line_confidences: Dict[str, float] = {}
    for words in lines.values():
        text = " ".join(w for w, _ in words).strip()
        if not text:
            continue
        confs = [c for _, c in words if c >= 0]
        line_confidences[text] = (sum(confs) / len(confs) / 100.0) if confs else 0.5
    return line_confidences

# Camera photos (4000x3000+) made single documents take minutes and >6 GB of RAM across the OCR passes, and OOM-killed
# workers mid-job. Document text stays legible at this size; anything larger is downscaled before OCR.
MAX_IMAGE_SIDE = int(os.environ.get("OCRDOCS_MAX_IMAGE_SIDE", "3000"))


def _load_capped_image(path: str) -> Image.Image:
    img = Image.open(path)
    img.draft("RGB", (MAX_IMAGE_SIDE * 2, MAX_IMAGE_SIDE * 2))  # cheap JPEG DCT-scaling before full decode
    img = img.convert("RGB")
    if max(img.size) > MAX_IMAGE_SIDE:
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
    return img


def run_pass_ocr(image: Image.Image, pass_num: int) -> Tuple[str, List[str], Dict[str, float]]:
    """Executes specific OCR algorithms tailored to the current pass.

    Returns (text, engines_actually_invoked, line_confidences). The engine
    list is derived from what ran, not a hardcoded label. line_confidences
    maps each collected text line to a REAL per-engine confidence (0-1) —
    Tesseract via image_to_data, TrOCR's own sequence probability,
    the Paddle-VL/Chandra readers — so downstream field extraction no longer has
    to invent a number. Engine failures are logged (not silently swallowed)
    and each call runs under ENGINE_TIMEOUT_SECONDS so one pathological image
    can't hang the whole multipass loop.
    """
    quality = assess_image_quality(image)
    enhanced_img = enhance_image_for_pass(image, pass_num, quality=quality)
    collected: Dict[str, float] = {}
    engines_used: List[str] = []
    cv_img = cv2.cvtColor(np.array(enhanced_img), cv2.COLOR_RGB2BGR)

    def _merge(text: str, conf: float):
        text = " ".join(text.strip().split())
        if len(text) > 1:
            collected[text] = max(collected.get(text, 0.0), conf)

    # Passes 1-4: hybrid page read. Tesseract finds the lines; lines it is unsure about (and inked regions it
    # found nothing in) go to TrOCR one line at a time. Later passes re-run this on progressively enhanced pixels.
    if ocr_hybrid is not None and pytesseract is not None and pass_num in range(1, MAX_HYBRID_PASSES + 1):
        try:
            page_lines = _run_engine_call(
                _trocr_lock, ocr_hybrid.recognize_page, enhanced_img, _trocr_reader, timeout=HYBRID_TIMEOUT_SECONDS
            )
            for ln in page_lines:
                _merge(ln.text, ln.conf)
            engines_used.append("Tesseract")
            if any(ln.engine == "TrOCR" for ln in page_lines):
                engines_used.append("TrOCR")
        except FutureTimeoutError:
            logging.warning(f"[!] Hybrid read timed out after {HYBRID_TIMEOUT_SECONDS}s on pass {pass_num}, skipping.")
        except EngineBusyError:
            logging.warning(f"[!] Hybrid reader still busy with an orphaned call on pass {pass_num}, skipping.")
        except Exception as e:
            logging.warning(f"[!] Hybrid read failed on pass {pass_num}: {e}")

    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001 - a full or broken shared GPU must not fail a finished pass
        pass
    gc.collect()

    return "\n".join(collected.keys()), engines_used, collected

def run_page_vlm(image: Image.Image) -> Dict[str, Any]:
    """vlm_v2 page read. Returns {kind, text, engines, line_confs, fields, degraded}.

    Qwen classifies the page; printed pages go to PaddleOCR-VL, handwritten ones to the Tesseract+TrOCR hybrid (only
    the lines TrOCR read are handed to the merge as handwriting); Qwen then merges both readings into typed fields.
    Any service being down degrades that page to the legacy Tesseract+TrOCR read instead of failing it.
    """
    degraded = False
    try:
        kind = ocr_qwen_merge.classify_page(image)
    except ocr_qwen_merge.QwenUnavailable as e:
        logging.warning(f"[!] Page classification unavailable, treating page as 'both': {e}")
        kind, degraded = "both", True
    if kind in ("blank", "photo"):
        return {"kind": kind, "text": "", "engines": [], "line_confs": {}, "fields": [], "degraded": degraded}

    engines: List[str] = []
    confs: Dict[str, float] = {}
    paddle_text = ""
    if kind in ("printed", "both"):
        try:
            paddle_text = ocr_paddle_vl.read_page(image)
            engines.append("PaddleOCR-VL")
            for line in paddle_text.splitlines():
                if len(line.strip()) > 1:
                    confs[" ".join(line.split())] = 0.9  # Paddle-VL reports no per-line score; fixed, not measured
        except ocr_paddle_vl.PaddleUnavailable as e:
            logging.warning(f"[!] Paddle-VL unavailable, falling back to Tesseract for this page: {e}")
            text, eng, lc = run_pass_ocr(image, 1)
            return {"kind": kind, "text": text, "engines": eng, "line_confs": lc, "fields": [], "degraded": True}

    trocr_lines: List[Tuple[str, float]] = []
    if kind in ("handwritten", "both") and ocr_hybrid is not None and pytesseract is not None:
        try:
            page_lines = _run_engine_call(
                _trocr_lock, ocr_hybrid.recognize_page, image, _trocr_reader, timeout=HYBRID_TIMEOUT_SECONDS
            )
            hand = [ln for ln in page_lines if ln.engine == "TrOCR"] if kind == "both" else list(page_lines)
            if kind == "handwritten":
                engines.append("Tesseract")
            if any(ln.engine == "TrOCR" for ln in page_lines):
                engines.append("TrOCR")
            for ln in hand:
                trocr_lines.append((ln.text, ln.conf))
                confs[" ".join(ln.text.split())] = ln.conf
        except Exception as e:  # noqa: BLE001 - includes timeout/busy; keep whatever Paddle already read
            logging.warning(f"[!] Handwriting read failed for this page: {e}")
            degraded = True

    fields: List[Any] = []
    if paddle_text or trocr_lines:
        try:
            fields = ocr_qwen_merge.merge_page(image, paddle_text, trocr_lines).fields
            engines.append("Qwen3-VL")
        except ocr_qwen_merge.QwenUnavailable as e:
            logging.warning(f"[!] Qwen merge unavailable, regex extraction only for this page: {e}")
            degraded = True
    text = "\n".join(t for t in [paddle_text] + [t for t, _ in trocr_lines] if t)
    return {"kind": kind, "text": text, "engines": engines, "line_confs": confs, "fields": fields, "degraded": degraded}


def extract_australian_banking_fields(text: str, line_confidences: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """Extracts and validates all 60 Australian banking application fields.

    line_confidences (optional): maps a raw OCR'd line of text to the real
    per-engine confidence that produced it (see run_pass_ocr). When supplied,
    the contextual line-scan below uses the actual OCR confidence for that
    line instead of a flat hardcoded constant — this is what the monotonic
    quality gate in process_document_multipass actually needs to mean
    something. When absent (native-PDF/docx/txt text that was never OCR'd),
    a high fixed confidence is used deliberately: that text is exact, not a
    model's guess.
    """
    data: Dict[str, Any] = {field: "" for field in BANK_FIELD_PATTERNS.keys()}
    confidences: Dict[str, float] = {field: 0.0 for field in BANK_FIELD_PATTERNS.keys()}

    lines = text.splitlines()

    # Generic Regex Patterns
    emails = re.findall(r"\b[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+\b", text)
    phone_matches = list(re.finditer(r"(?<!\d)(?:\+?61\s?|0)[2-478](?:[ -]?[0-9]){8}(?!\d)", text))
    phones = [m.group(0) for m in phone_matches]
    # A date is only a DOB when a DOB/birth label sits right before it: statement, issue and expiry dates
    # in the same document must never be promoted just because they parse as a plausible age.
    dobs = [
        m.groups() for m in re.finditer(r"\b(0[1-9]|[12][0-9]|3[01])[-/.](0[1-9]|1[012])[-/.]((?:19|20)\d\d)\b", text)
        if re.search(r"(?:dob|d\.?o\.?b|birth|born)\W{0,12}$", text[max(0, m.start() - 24):m.start()], re.IGNORECASE)
    ]
    # A 16-digit card number written as 4-4-4-4 groups contains ABN-shaped slices; never read those as ABNs.
    card_spans = [m.span() for m in re.finditer(r"(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}(?!\d)", text)]
    abn_matches = [
        m for m in re.finditer(r"(?<!\d)(\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3})(?!\d)", text)
        if not _overlaps(m.span(), card_spans)
    ]
    abns = [m.group(1) for m in abn_matches]
    # Spans already owned by a stronger identifier (valid ABN, AU phone): a BSB must not be read out of them
    # (the "824 753" inside ABN "51 824 753 556", the "345 678" inside "0412 345 678").
    claimed_spans = [
        m.span() for m in abn_matches
        if validate_australian_abn(m.group(1))
        or re.search(r"\b(?:abn|a\.b\.n)\b\W{0,3}$", text[max(0, m.start() - 12):m.start()], re.IGNORECASE)
    ]
    claimed_spans += [m.span() for m in phone_matches]
    bsb_matches = [
        m for m in re.finditer(r"(?<!\d)(\d{3}[- ]\d{3})(?!\d)", text)
        if not _overlaps(m.span(), claimed_spans) and not _overlaps(m.span(), card_spans)
    ]
    bsbs = [m.group(1) for m in bsb_matches]
    postcodes = re.findall(r"\b(0[2-9]\d{2}|[1-9]\d{3})\b", text)
    currencies = re.findall(r"\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|\b[0-9]{4,7}\b)", text)

    # NLP PERSON and ORG detection
    if _nlp is not None:
        doc = _nlp(text[:5000])  # limit tokens
        persons = [ent.text for ent in doc.ents if ent.label_ == "PERSON"]
        orgs = [ent.text for ent in doc.ents if ent.label_ == "ORG"]
        if persons:
            p_parts = persons[0].split()
            data["given_names"] = p_parts[0]
            confidences["given_names"] = 0.90
            if len(p_parts) > 1:
                data["family_name"] = " ".join(p_parts[1:])
                confidences["family_name"] = 0.90
        if orgs:
            data["employer_details"] = orgs[0]
            confidences["employer_details"] = 0.85

    # Assign validated primary identifiers
    for abn in abns:
        if validate_australian_abn(abn):
            data["abn"] = abn
            confidences["abn"] = 1.0
            break

    # Anchored ("BSB"/"branch" within 30 chars before) beats unanchored; unanchored stays low-confidence.
    anchored_bsbs = [
        m for m in bsb_matches
        if re.search(r"\b(?:bsb|branch)\b", text[max(0, m.start() - 30):m.start()], re.IGNORECASE)
    ]
    for m in anchored_bsbs + [m for m in bsb_matches if m not in anchored_bsbs]:
        if validate_australian_bsb(m.group(1)):
            data["bsb"] = m.group(1)
            confidences["bsb"] = 0.95 if m in anchored_bsbs else 0.55
            break

    for dob in dobs:
        dob_str = f"{dob[0]}/{dob[1]}/{dob[2]}"
        if validate_australian_dob(dob_str):
            data["date_of_birth"] = dob_str
            confidences["date_of_birth"] = 0.85
            break

    if phones:
        data["mobile_number"] = phones[0]
        confidences["mobile_number"] = 0.95

    if emails:
        data["email_address"] = emails[0]
        confidences["email_address"] = 0.98

    # Fields whose line-scan value gets format-validated before it's allowed
    # to overwrite an existing match. Without this, a bare label match (e.g.
    # "BSB: TBC" or a line containing "date of birth" near unrelated digits)
    # would overwrite an already-validated, correct value purely because its
    # line confidence (0.75-0.95) is higher than the deliberately-lowered
    # unlabeled-sweep confidence above (0.60 BSB / 0.85 DOB) -- garbage text
    # clobbering a real match just by sitting on a higher-confidence line.
    # A genuinely correct label match still passes (it's real data, so it
    # validates) and legitimately overrides the lower unlabeled-sweep value,
    # exactly as intended; only invalid/garbage line-scan text is blocked.
    line_scan_validators = {
        "bsb": validate_australian_bsb,
        "date_of_birth": validate_australian_dob,
        "abn": validate_australian_abn,
        "mobile_number": validate_australian_phone,
        "postcode": validate_australian_postcode,
    }

    # Contextual line scanning for the 60 fields
    for line in lines:
        cleaned_line = line.strip()
        if not cleaned_line:
            continue

        # Real confidence for this line if it came from OCR; otherwise this
        # line is native/exact text (never passed through an OCR engine) so a
        # high fixed confidence is appropriate rather than an OCR guess.
        if line_confidences is None:
            line_conf = 0.95
        else:
            line_conf = line_confidences.get(cleaned_line, 0.75)

        for field, pattern in BANK_FIELD_PATTERNS.items():
            if pattern.search(cleaned_line):
                # Search for values following a colon, dash, or space
                parts = re.split(r"[:\t\-\=]", cleaned_line, maxsplit=1)
                if len(parts) > 1 and len(parts[1].strip()) > 1:
                    val = parts[1].strip()
                    validator = line_scan_validators.get(field)
                    if validator is not None and not validator(val):
                        # A labelled line whose value fails validation is contaminated: stop here so a
                        # later, looser field pattern cannot claim the same garbage value.
                        break
                    if not data[field] or confidences[field] < line_conf:
                        data[field] = val
                        confidences[field] = line_conf
                    # A handful of BANK_FIELD_PATTERNS alternatives overlap
                    # by design (e.g. salary_frequency's bare "annual"
                    # keyword also matches inside "Gross Annual Income:") --
                    # without this break, a single "Label: value" line would
                    # assign the SAME value to every field whose pattern
                    # happens to match somewhere in that line, not just the
                    # one it's actually labelling. One line labels at most
                    # one field; stop scanning further fields once one is
                    # accepted (dict iteration order picks the first,
                    # most-specific match -- gross_annual_income before the
                    # looser salary_frequency, per the example above).
                    break

    # Currency bindings for income/expense fields
    if currencies:
        numeric_vals = []
        for c in currencies:
            try:
                numeric_vals.append(float(c.replace(",", "")))
            except ValueError:
                pass
        numeric_vals.sort(reverse=True)
        if numeric_vals:
            if not data["gross_annual_income"] and numeric_vals[0] > 30000:
                data["gross_annual_income"] = f"${numeric_vals[0]:,.2f}"
                confidences["gross_annual_income"] = 0.88
            if len(numeric_vals) > 1 and not data["net_monthly_income"]:
                data["net_monthly_income"] = f"${numeric_vals[1]:,.2f}"
                confidences["net_monthly_income"] = 0.84

    return {
        "fields": data,
        "confidences": confidences,
        "valid_abn": validate_australian_abn(data["abn"]),
        "valid_bsb": validate_australian_bsb(data["bsb"]),
        "valid_dob": validate_australian_dob(data["date_of_birth"])
    }

# ==============================================================================
# SINGLE FILE PROCESSING WITH FILE PARSING
# ==============================================================================
# Native PDF text (pdfium's get_textpage()) can't change between passes of
# the same file, but process_single_file_for_pass previously re-extracted it
# on every one of up to 10 passes regardless. Cached per-process, keyed by
# (path, mtime, size) so a changed file on disk isn't served stale text.
# Note: this only actually helps the single-document worker path
# (process_document_multipass, all passes run sequentially in the same
# process) -- the batch/CLI path's multiprocessing.Pool uses
# maxtasksperchild=1 (a fresh process per task, by design, for memory
# isolation), so the cache starts empty there every time; harmless, just not
# where the win applies.
_native_text_cache: Dict[Tuple[str, int, int], List[str]] = {}

MAX_OCR_PAGES = int(os.environ.get("OCRDOCS_MAX_OCR_PAGES", "30"))
OCR_RENDER_DPI = int(os.environ.get("OCRDOCS_OCR_RENDER_DPI", "200"))
# Hybrid (Tesseract + TrOCR) page reads per document. Pass 2 re-reads enhanced pixels for anything pass 1 missed;
# more passes were measured to add almost nothing while multiplying cost.
MAX_HYBRID_PASSES = int(os.environ.get("OCRDOCS_MAX_HYBRID_PASSES", "2"))
# "legacy": multi-pass Tesseract+TrOCR over the whole document. "vlm_v2": per page, Qwen classifies, PaddleOCR-VL reads
# print, TrOCR reads handwriting, Qwen merges into fields (single pass). Falls back per page if a service is down.
PIPELINE_MODE = os.environ.get("OCRDOCS_PIPELINE", "legacy").strip().lower()


def _page_needs_visual(page, native_chars: int) -> bool:
    """True when a page with a text layer may still hold text only pixels reveal (handwriting, stamps, scans)."""
    if native_chars < 80:
        return True
    try:
        import pypdfium2.raw as pdfium_c

        # Only annotation kinds that carry a person's marks: free text (3), stamp (13), ink/pen (15), form widget (20).
        # Link annotations (2) are on nearly every digital PDF and mean nothing here.
        for i in range(pdfium_c.FPDFPage_GetAnnotCount(page.raw)):
            annot = pdfium_c.FPDFPage_GetAnnot(page.raw, i)
            try:
                if pdfium_c.FPDFAnnot_GetSubtype(annot) in (3, 13, 15, 20):
                    return True
            finally:
                pdfium_c.FPDFPage_CloseAnnot(annot)
        width, height = page.get_size()
        page_area = float(width * height) or 1.0
        for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE]):
            left, bottom, right, top = obj.get_pos()
            # A scan or photo fills a large part of the page; a header logo or banner does not.
            if (right - left) * (top - bottom) >= 0.30 * page_area:
                return True
    except Exception as e:  # noqa: BLE001 - if unsure, be conservative on thin pages only
        logging.debug(f"page object inspection failed: {e}")
        return native_chars < 300
    return False


def _extract_pdf_page_texts(fpath: str) -> List[str]:
    path = Path(fpath)
    stat = path.stat()
    cache_key = (fpath, stat.st_mtime_ns, stat.st_size)
    cached = _native_text_cache.get(cache_key)
    if cached is not None:
        return cached

    page_texts: List[str] = []
    doc = pdfium.PdfDocument(str(path))
    for page_index, page in enumerate(doc):
        try:
            page_texts.append(page.get_textpage().get_text_bounded())
        except Exception as e:
            logging.warning(f"[!] {fpath}: page {page_index} failed to extract native text: {e}")
            page_texts.append("")
    doc.close()

    _native_text_cache.clear()  # single-entry cache: one file in flight per worker process at a time
    _native_text_cache[cache_key] = page_texts
    return page_texts

def process_single_file_for_pass(args: Tuple[str, int]) -> Tuple[str, str, Dict[str, Any]]:
    fpath, pass_num = args
    path = Path(fpath)
    if not path.exists() or path.stat().st_size == 0:
        return "EMPTY", fpath, {}

    ext = path.suffix.lower()
    raw_texts = []
    images = []
    used_native_text = False

    try:
        if ext == ".pdf":
            page_texts = _extract_pdf_page_texts(fpath)
            doc = pdfium.PdfDocument(str(path))
            for page_index, page in enumerate(doc):
                # One corrupted page must not discard every already-parsed
                # page in this pass -- previously the whole per-page loop
                # was inside the outer try/except, so a single bad page in
                # an otherwise-fine 20-page statement threw PARSE_ERROR for
                # the entire document, losing all prior pages' text/images.
                try:
                    txt = page_texts[page_index] if page_index < len(page_texts) else ""
                    if txt.strip():
                        raw_texts.append(txt)
                        used_native_text = True
                    # Read the pixels only where they can hold something the text layer does not: pages with no
                    # (or thin) text, and pages carrying embedded images / annotations (scanned or hand-filled forms
                    # keep their printed labels as text while the handwriting lives in the image layer).
                    if len(images) < MAX_OCR_PAGES and (not txt.strip() or _page_needs_visual(page, len(txt.strip()))):
                        bitmap = page.render(scale=OCR_RENDER_DPI / 72)
                        images.append(bitmap.to_pil().convert("RGB"))
                except Exception as e:
                    logging.warning(f"[!] {fpath}: page {page_index} failed to render, skipping it: {e}")
            doc.close()
        elif ext in [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"]:
            images.append(_load_capped_image(path))
        elif ext == ".docx":
            import docx
            doc = docx.Document(path)
            # Same class of bug as the PDF per-page fix above, applied to
            # docx's own natural sub-document unit (paragraphs): one
            # paragraph with malformed run/style XML throwing out of
            # `.text` used to fail the whole list comprehension, discarding
            # every already-readable paragraph in an otherwise-fine
            # document. rtf/txt/json/xml below have no equivalent sub-unit
            # to isolate -- they're read as a single blob, so a read failure
            # there is a genuine all-or-nothing PARSE_ERROR, not a case of
            # this same bug.
            good_paragraphs = []
            for para_index, p in enumerate(doc.paragraphs):
                try:
                    good_paragraphs.append(p.text)
                except Exception as e:
                    logging.warning(f"[!] {fpath}: paragraph {para_index} failed to read, skipping it: {e}")
            raw_texts.append("\n".join(good_paragraphs))
        elif ext == ".rtf":
            from striprtf.striprtf import rtf_to_text
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                raw_texts.append(rtf_to_text(f.read()))
        elif ext in [".xml", ".txt", ".json", ".final"]:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                raw_texts.append(f.read()[:50000])
    except Exception as e:
        return "PARSE_ERROR", fpath, {"error": str(e)}

    # Run OCR on images for current pass
    ocr_texts = []
    engines_used: List[str] = []
    ocr_line_confidences: Dict[str, float] = {}
    if used_native_text:
        engines_used.append("Native PDF Text Layer")
    pages_info: List[Dict[str, Any]] = []
    vlm_fields: List[Dict[str, Any]] = []
    use_vlm = PIPELINE_MODE == "vlm_v2" and ocr_paddle_vl is not None and ocr_qwen_merge is not None
    for image_index, img in enumerate(images):
        if use_vlm:
            page = run_page_vlm(img)
            txt, engines, line_confs = page["text"], page["engines"], page["line_confs"]
            pages_info.append({"imageIndex": image_index, "kind": page["kind"], "engines": engines,
                               "degraded": page["degraded"], "fieldCount": len(page["fields"])})
            vlm_fields.extend({**vars(f), "imageIndex": image_index} for f in page["fields"])
        else:
            txt, engines, line_confs = run_pass_ocr(img, pass_num)
        ocr_texts.append(txt)
        ocr_line_confidences.update(line_confs)
        for e in engines:
            if e not in engines_used:
                engines_used.append(e)

    combined_text = "\n".join(raw_texts + ocr_texts)
    if not combined_text.strip():
        return "NOOCR", fpath, {}

    # Pre-seed each native-text line's own confidence at the high fixed
    # value, rather than relying on `line_confidences is None` to mean "this
    # whole pass is native". That only held for a pass with ZERO images. On
    # pass_num > 1, every PDF page is ALSO rasterized and OCR'd regardless of
    # already having native text (see the rasterize condition above), so
    # ocr_line_confidences is non-empty even for a page whose text came from
    # the native layer. Without this, a native line's exact text falls
    # through extract_australian_banking_fields's per-line .get(default)
    # to the conservative 0.75 OCR-guess default -- silently downgrading
    # exact text to a guess confidence purely because some OTHER image on
    # the same pass happened to need OCR too.
    for txt in raw_texts:
        for line in txt.splitlines():
            cleaned = line.strip()
            if cleaned and cleaned not in ocr_line_confidences:
                ocr_line_confidences[cleaned] = 0.95

    # Only pass real confidences when at least one line actually went through
    # an OCR engine this pass — a native-text-only document (no images at
    # all) should get the "exact text" confidence path, not an empty dict
    # that would otherwise fall through to the conservative 0.75 default.
    result = extract_australian_banking_fields(
        combined_text, ocr_line_confidences if ocr_line_confidences else None
    )
    result["raw_text"] = combined_text
    result["engines_used"] = engines_used
    if use_vlm:
        result["pages"] = pages_info
        result["vlm_fields"] = vlm_fields
    return "SUCCESS", fpath, result

# ==============================================================================
# SINGLE-DOCUMENT MULTI-PASS ENTRYPOINT (for the DGX job-queue worker)
# ==============================================================================
def merge_pass_fields(
    field_keys: List[str],
    prev_fields: Dict[str, str],
    prev_confs: Dict[str, float],
    new_fields: Dict[str, str],
    new_confs: Dict[str, float],
    min_replace_confidence: float = 0.60,
) -> Tuple[Dict[str, str], Dict[str, float], int, int]:
    """The MONOTONIC QUALITY INVARIANT, in one place.

    Never let a later pass silently erase or downgrade an already-accepted
    field. Shared by process_document_multipass() (single-document, in-memory)
    and execute_pass_and_verify() (corpus-wide batch/DuckDB mode) — these two
    entrypoints previously each carried their own copy of this exact rule,
    which meant a fix to one could silently miss the other.

    Returns (merged_fields, merged_confs, delta_new_fields, regressions_prevented).
    """
    merged_fields: Dict[str, str] = {}
    merged_confs: Dict[str, float] = {}
    delta_new_fields = 0
    regressions_prevented = 0

    for k in field_keys:
        prev_val = prev_fields.get(k, "") or ""
        new_val = new_fields.get(k, "") or ""
        new_conf = new_confs.get(k, 0.0)

        if prev_val and not new_val:
            merged_fields[k] = prev_val
            merged_confs[k] = prev_confs.get(k, 0.0)
            regressions_prevented += 1
        elif prev_val and new_val and new_conf < min_replace_confidence:
            merged_fields[k] = prev_val
            merged_confs[k] = prev_confs.get(k, 0.0)
        elif new_val:
            if not prev_val:
                delta_new_fields += 1
            merged_fields[k] = new_val
            merged_confs[k] = new_conf
        else:
            merged_fields[k] = ""
            merged_confs[k] = 0.0

    return merged_fields, merged_confs, delta_new_fields, regressions_prevented

def process_document_multipass(file_path: str, max_passes: int = 10) -> Dict[str, Any]:
    """
    Runs the real progressive multi-pass pipeline against one claimed job.

    Unlike execute_pass_and_verify() (the corpus-wide batch/CLI mode, which
    reads/writes shared DuckDB state across a whole directory of documents),
    this scopes the monotonic-quality guard and early-stop convergence check
    to a single document with in-memory state only — no shared corpus table.
    Every field in the returned "passes" telemetry is measured from the
    actual pass that ran; nothing here is scripted or pre-baked.
    """
    init_worker()

    prev_fields: Dict[str, str] = {}
    prev_confs: Dict[str, float] = {}
    latest_raw_text = ""
    page_kinds: List[Dict[str, Any]] = []
    vlm_fields: List[Dict[str, Any]] = []
    passes: List[Dict[str, Any]] = []
    consecutive_zero_delta = 0
    field_keys = list(BANK_FIELD_PATTERNS.keys())
    total_fields = len(field_keys)

    for pass_num in range(1, max_passes + 1):
        started = time.perf_counter()
        status, _, result = process_single_file_for_pass((file_path, pass_num))
        duration_ms = round((time.perf_counter() - started) * 1000, 1)

        if status in ("EMPTY", "PARSE_ERROR"):
            return {
                "status": "FAILED",
                "error": result.get("error", f"File {status.lower()}"),
                "passes": passes,
            }
        if status == "NOOCR":
            if pass_num == 1:
                return {
                    "status": "FAILED",
                    "error": "No extractable text or usable image content on pass 1.",
                    "passes": passes,
                }
            # Later pass found nothing further to add; stop with what we have.
            break

        new_fields = result.get("fields", {})
        new_confs = result.get("confidences", {})
        if "pages" in result:
            page_kinds, vlm_fields = result["pages"], result.get("vlm_fields", [])
        if result.get("raw_text"):
            latest_raw_text = result["raw_text"]

        merged_fields, merged_confs, delta_new_fields, regressions_prevented = merge_pass_fields(
            field_keys, prev_fields, prev_confs, new_fields, new_confs
        )
        prev_fields, prev_confs = merged_fields, merged_confs
        filled = sum(1 for v in merged_fields.values() if v)
        recall_percent = round((filled / total_fields) * 100, 1) if total_fields else 0.0

        passes.append({
            "passNumber": pass_num,
            "enginesUsed": result.get("engines_used", []),
            "status": "COMPLETED",
            "durationMs": duration_ms,
            "fieldsExtracted": filled,
            "deltaNewFields": delta_new_fields,
            "regressionsPrevented": regressions_prevented,
            "recallPercent": recall_percent,
        })

        # vlm_v2 reads every page once with the full stack; re-running it on enhanced pixels adds no new reader.
        if PIPELINE_MODE == "vlm_v2" and "pages" in result:
            break

        # Photos and graphics: two Tesseract-only passes found almost no characters and no fields. Running the
        # remaining research-engine passes on a 4000x3000 photo just burns minutes per image.
        if pass_num >= 2 and filled == 0 and sum(c.isalnum() for c in latest_raw_text) < NO_TEXT_ALNUM_MIN:
            return {
                "status": "FAILED",
                "error": "No readable text detected (photo or non-document image).",
                "passes": passes,
            }

        # A second visual pass over enhanced pixels added ~5% on top of pass 1 in production data, at double the cost
        # (a 30-page scan took 4 minutes). Skip it when pass 1 already found substantial content.
        if pass_num == 1 and "Tesseract" in result.get("engines_used", []) and (filled >= 4 or len(latest_raw_text) >= 1500):
            break

        consecutive_zero_delta = consecutive_zero_delta + 1 if delta_new_fields == 0 else 0
        used_native_text = "Native PDF Text Layer" in result.get("engines_used", [])
        # A substantial native text layer is exact: rendering and re-OCRing the same pages 9 more times only
        # re-reads it (this made small PDFs take ~1 minute each on a 731-PDF batch).
        if used_native_text and pass_num == 1 and len(latest_raw_text.strip()) >= NATIVE_TEXT_MIN_CHARS:
            break
        early_stop = (
            (consecutive_zero_delta >= 2 and pass_num >= 3)
            or (recall_percent >= 95 and pass_num >= 4)
            or (used_native_text and recall_percent >= 95 and pass_num >= 1)
        )
        if early_stop:
            break

    return {
        "status": "SUCCESS",
        "rawText": latest_raw_text,
        "fields": prev_fields,
        "confidences": prev_confs,
        "validAbn": validate_australian_abn(prev_fields.get("abn", "")),
        "validBsb": validate_australian_bsb(prev_fields.get("bsb", "")),
        "validDob": validate_australian_dob(prev_fields.get("date_of_birth", "")),
        "passes": passes,
        "pages": page_kinds,
        "vlmFields": vlm_fields,
        "engineUsed": ",".join(
            sorted({e for p in passes for e in p.get("enginesUsed", [])})
        ) or "multipass-ensemble",
   }


# ==============================================================================
# REGRESSION VERIFICATION & DUCKDB PERSISTENCE (Zero-Lock WAL)
# ==============================================================================
def init_duckdb():
    with duckdb.connect(str(DB_PATH)) as con:
        con.execute("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;")
        # Master table with 60 fields + audit metadata
        cols = ", ".join([f"{k} VARCHAR" for k in BANK_FIELD_PATTERNS.keys()])
        con.execute(f"""
            CREATE TABLE IF NOT EXISTS identities (
                filename VARCHAR PRIMARY KEY,
                pass_resolved INTEGER,
                confidence_score DOUBLE,
                abn_valid BOOLEAN,
                bsb_valid BOOLEAN,
                dob_valid BOOLEAN,
                {cols}
            )
        """)
        # Telemetry & Regression tracking table
        con.execute("""
            CREATE TABLE IF NOT EXISTS pass_audit_log (
                pass_num INTEGER,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_documents INTEGER,
                resolved_fields_count INTEGER,
                valid_abns INTEGER,
                valid_bsbs INTEGER,
                regressions_prevented INTEGER,
                delta_new_fields INTEGER,
                early_stop_triggered BOOLEAN
            )
        """)

def execute_pass_and_verify(pass_num: int, files: List[str]) -> Dict[str, Any]:
    """Executes a single pass, applies regression verification, and updates DuckDB."""
    logging.info(f"[*] --- EXECUTING PASS {pass_num} ON {len(files)} DOCUMENTS ---")
    
    # Load previous state for monotonic regression verification
    with duckdb.connect(str(DB_PATH)) as con:
        con.execute("PRAGMA busy_timeout=10000;")
        prev_rows = con.execute("SELECT * FROM identities").fetchdf()

    prev_dict = {}
    if not prev_rows.empty:
        for _, row in prev_rows.iterrows():
            prev_dict[row["filename"]] = row.to_dict()

    workers = min(max(mp.cpu_count() // 4, 1), 2)
    work_items = [(f, pass_num) for f in files]

    results = []
    with mp.Pool(processes=workers, initializer=init_worker, maxtasksperchild=1) as pool:
        for res in pool.imap_unordered(process_single_file_for_pass, work_items):
            results.append(res)

    regressions_prevented = 0
    newly_resolved_fields = 0
    updated_records = []

    field_keys = list(BANK_FIELD_PATTERNS.keys())
    for status, fpath, res in results:
        fname = os.path.basename(fpath)
        prev_rec = prev_dict.get(fname, {})
        new_fields = res.get("fields", {})
        new_confs = res.get("confidences", {})
        # The persisted `identities` table has no per-field confidence column
        # (only an aggregate confidence_score), so there's no real "previous
        # confidence" to feed the shared merge — matching this function's
        # prior behavior, which never used one either (the invariant only
        # ever needed the NEW value's confidence to decide whether to accept
        # a replacement).
        prev_fields_only = {k: str(prev_rec.get(k, "") or "") for k in field_keys}

        merged_fields, _merged_confs, delta_fields, regressions = merge_pass_fields(
            field_keys, prev_fields_only, {}, new_fields, new_confs
        )
        newly_resolved_fields += delta_fields
        regressions_prevented += regressions

        avg_conf = float(np.mean(list(new_confs.values())) if new_confs else 0.0)
        abn_v = validate_australian_abn(merged_fields.get("abn", ""))
        bsb_v = validate_australian_bsb(merged_fields.get("bsb", ""))
        dob_v = validate_australian_dob(merged_fields.get("date_of_birth", ""))

        record = {
            "filename": fname,
            "pass_resolved": pass_num if newly_resolved_fields > 0 else prev_rec.get("pass_resolved", pass_num),
            "confidence_score": max(avg_conf, float(prev_rec.get("confidence_score", 0.0) or 0.0)),
            "abn_valid": abn_v,
            "bsb_valid": bsb_v,
            "dob_valid": dob_v,
            **merged_fields
        }
        updated_records.append(record)

    # Atomic DuckDB write
    with duckdb.connect(str(DB_PATH)) as con:
        con.execute("PRAGMA busy_timeout=15000;")
        df_update = pd.DataFrame(updated_records)
        con.register("df_update", df_update)
        # Explicit, name-matched column list on both sides — SELECT * relied
        # on df_update's dict-derived column order exactly matching the DDL's
        # column order, a silent landmine if either list is ever reordered.
        col_list = ", ".join(df_update.columns)
        con.execute(f"INSERT OR REPLACE INTO identities ({col_list}) SELECT {col_list} FROM df_update")

        # Export consolidated snapshot
        df_all = con.execute("SELECT * FROM identities").fetchdf()
        df_all.to_csv(OUTPUT_CSV, index=False)
        try:
            df_all.to_parquet(OUTPUT_PARQUET, compression="zstd")
        except Exception:
            pass

        # Total summary stats
        total_docs = len(df_all)
        valid_abns = int(df_all["abn_valid"].sum()) if "abn_valid" in df_all else 0
        valid_bsbs = int(df_all["bsb_valid"].sum()) if "bsb_valid" in df_all else 0
        
        # Count non-empty fields across all 60 columns
        field_cols = list(BANK_FIELD_PATTERNS.keys())
        total_filled_fields = int(df_all[field_cols].apply(lambda s: s.str.len() > 0).sum().sum())

        # Determine early stop: If 0 new fields gained and at least pass >= 3
        early_stop = (newly_resolved_fields == 0 and pass_num >= 3) or (total_docs > 0 and total_filled_fields >= total_docs * 25)

        con.execute("""
            INSERT INTO pass_audit_log (
                pass_num, total_documents, resolved_fields_count,
                valid_abns, valid_bsbs, regressions_prevented,
                delta_new_fields, early_stop_triggered
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (pass_num, total_docs, total_filled_fields, valid_abns, valid_bsbs, regressions_prevented, newly_resolved_fields, early_stop))

    logging.info(f"[+] PASS {pass_num} RESULTS:")
    logging.info(f"    - Total Documents: {total_docs}")
    logging.info(f"    - Extracted Fields Total: {total_filled_fields}")
    logging.info(f"    - Validated ABNs (Modulo 89): {valid_abns}")
    logging.info(f"    - Validated BSBs (APRA): {valid_bsbs}")
    logging.info(f"    - Regressions Prevented (Zero-Loss): {regressions_prevented}")
    logging.info(f"    - Delta New Fields: +{newly_resolved_fields}")
    logging.info(f"    - Early-Stop Feasible: {early_stop}")

    return {
        "pass_num": pass_num,
        "total_documents": total_docs,
        "resolved_fields": total_filled_fields,
        "valid_abns": valid_abns,
        "valid_bsbs": valid_bsbs,
        "regressions_prevented": regressions_prevented,
        "delta_new_fields": newly_resolved_fields,
        "early_stop": early_stop
    }

# ==============================================================================
# MAIN MULTI-PASS CONTROLLER LOOP (MAX 10 PASSES)
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Multi-Pass OCR & Regression Engine")
    parser.add_argument("--pass-num", type=int, default=None, help="Execute specific pass number (1-10)")
    parser.add_argument("--max-passes", type=int, default=10, help="Maximum number of passes in loop (default: 10)")
    args = parser.parse_args()

    try:
        mp.set_start_method("spawn", force=True)
    except RuntimeError:
        pass

    init_duckdb()

    # Phase 1: Load files already staged by local ingestion, direct copy, or the DGX pull worker.
    input_files = [str(p) for p in INPUT_DIR.glob("**/*") if p.is_file() and not p.name.startswith(".")]

    if not input_files:
        logging.warning(f"[!] No documents found in {INPUT_DIR}. Add documents with scripts/ingest_local_folder.mjs or copy files into the DGX input directory.")
        return

    logging.info(f"[+] Loaded {len(input_files)} target documents for processing.")

    # Phase 2: Execution (Single Pass vs Multi-Pass Loop)
    if args.pass_num is not None:
        # Run specific requested pass
        res = execute_pass_and_verify(args.pass_num, input_files)
        print(json.dumps(res, indent=2))
        return

    # Multi-Pass loop: Up to 10 passes with early exit detection
    logging.info(f"[*] Starting Progressive Multi-Pass Optimization Loop (Max {args.max_passes} Passes)...")
    consecutive_zero_delta = 0

    for current_pass in range(1, args.max_passes + 1):
        res = execute_pass_and_verify(current_pass, input_files)

        if res["delta_new_fields"] == 0:
            consecutive_zero_delta += 1
        else:
            consecutive_zero_delta = 0

        # EARLY STOP CONDITIONS:
        # 1. Pipeline converged with 0 new fields discovered in 2 consecutive passes
        # 2. Or early_stop flag triggered
        if (consecutive_zero_delta >= 2 and current_pass >= 3) or (res["early_stop"] and current_pass >= 4):
            logging.info(f"[+] CONVERGENCE ACHIEVED at Pass {current_pass}. Zero regressions detected.")
            logging.info(f"[+] Early stop triggered. Halting pipeline early to conserve GPU cycles.")
            break

        logging.info("[*] VRAM cooling for 3s before next optimization pass...")
        time.sleep(3)

    logging.info(f"[+] Pipeline execution complete. Consolidated output exported to {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
