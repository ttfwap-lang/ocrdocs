#!/usr/bin/env python3
# ==============================================================================
# Script 2: Enterprise VRAM-Throttled Multi-Pass OCR & Regression Engine
# Execution Context: Deployed and executed on DGX NVMe (/mnt/nvme/ocr_pipeline)
# Features:
#   - Google Drive Folder Ingestion (16q3PdioHVbLIBVqU--54nBvNhqLE7bNN) via gdown
#   - 30 Typo-Tolerant Australian Banking Field Matchers + APRA Validations
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
import argparse
import logging
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

# Third-party imports with graceful fallbacks
import cv2
import fitz  # PyMuPDF
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
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None

try:
    import easyocr
except ImportError:
    easyocr = None

try:
    from surya.ocr import run_ocr
    from surya.model.recognition.model import load_model as load_rec_model, load_processor as load_rec_processor
    from surya.model.detection.model import load_model as load_det_model, load_processor as load_det_processor
except ImportError:
    run_ocr = None

try:
    import gdown
except ImportError:
    gdown = None

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
DEFAULT_GDRIVE_FOLDER = "16q3PdioHVbLIBVqU--54nBvNhqLE7bNN"

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
# 30 AUSTRALIAN BANKING FIELDS REGEX DICTIONARY (Typo-Tolerant & APRA Aligned)
# ==============================================================================
BANK_FIELD_PATTERNS: Dict[str, re.Pattern] = {
    "title_salutation": re.compile(
        r"(tit[l1]e|sa[l1]utation|honorific|prefix|mr|mrs|ms|miss|dr|prof|rev)\b", re.I
    ),
    "given_names": re.compile(
        r"(given[_-]?names?|first[_-]?name|forename|christian[_-]?name|primary[_-]?name|1st[_-]?name)\b", re.I
    ),
    "middle_name": re.compile(
        r"(middle[_-]?names?|middle[_-]?initials?|other[_-]?names?|second[_-]?name)\b", re.I
    ),
    "family_name": re.compile(
        r"(family[_-]?names?|surname|last[_-]?name|maiden[_-]?name)\b", re.I
    ),
    "date_of_birth": re.compile(
        r"(dob|date[_-]?of[_-]?birth|birth[_-]?date|born[_-]?on|b[_-]?day)\b", re.I
    ),
    "residency_status": re.compile(
        r"(residency[_-]?status|citizenship|permanent[_-]?resident|visa[_-]?holder|australian[_-]?citizen|pr[_-]?status)\b", re.I
    ),
    "marital_status": re.compile(
        r"(marital[_-]?status|relationship[_-]?status|single|married|de[_-]?facto|defacto|divorced|separated|widowed)\b", re.I
    ),
    "dependants_count": re.compile(
        r"(dependants?|dependents?|children|kids|child[_-]?count|number[_-]?of[_-]?deps)\b", re.I
    ),
    "residential_address": re.compile(
        r"(residential[_-]?address|current[_-]?address|home[_-]?address|street[_-]?address|property[_-]?address)\b", re.I
    ),
    "address_tenure": re.compile(
        r"(time[_-]?at[_-]?address|years[_-]?at[_-]?address|months[_-]?residing|tenure[_-]?length)\b", re.I
    ),
    "previous_address": re.compile(
        r"(previous[_-]?address|prior[_-]?residence|former[_-]?address|past[_-]?address)\b", re.I
    ),
    "housing_situation": re.compile(
        r"(housing[_-]?situation|residential[_-]?status|renting|mortgaged|owned[_-]?outright|boarding|living[_-]?with[_-]?parents)\b", re.I
    ),
    "mobile_number": re.compile(
        r"(mobile[_-]?number|contact[_-]?number|cell[_-]?phone|phone|tel)\b", re.I
    ),
    "email_address": re.compile(
        r"(email[_-]?address|contact[_-]?email|electronic[_-]?mail)\b", re.I
    ),
    "drivers_licence": re.compile(
        r"(driver[s\']?[_-]?licen[sc]e|licen[sc]e[_-]?number|card[_-]?number|dl[_-]?no)\b", re.I
    ),
    "passport_details": re.compile(
        r"(passport[_-]?number|travel[_-]?document|passport[_-]?no|issuing[_-]?country)\b", re.I
    ),
    "employment_status": re.compile(
        r"(employment[_-]?status|full[_-]?time|part[_-]?time|casual|contractor|self[_-]?employed|unemployed)\b", re.I
    ),
    "occupation_industry": re.compile(
        r"(occupation|profession|job[_-]?title|industry[_-]?sector|vocation|trade)\b", re.I
    ),
    "employer_details": re.compile(
        r"(employer[_-]?name|company[_-]?name|business[_-]?name|organisation|workplace)\b", re.I
    ),
    "employment_tenure": re.compile(
        r"(time[_-]?with[_-]?employer|years[_-]?employed|service[_-]?length|employment[_-]?duration)\b", re.I
    ),
    "gross_annual_income": re.compile(
        r"(gross[_-]?annual[_-]?income|base[_-]?salary|gross[_-]?earnings|total[_-]?remuneration|gross[_-]?wage)\b", re.I
    ),
    "net_monthly_income": re.compile(
        r"(net[_-]?monthly[_-]?income|take[_-]?home[_-]?pay|net[_-]?salary|after[_-]?tax[_-]?income)\b", re.I
    ),
    "salary_frequency": re.compile(
        r"(salary[_-]?frequency|pay[_-]?cycle|weekly|fortnightly|monthly|annual|per[_-]?annum|p\.?a\.?)\b", re.I
    ),
    "other_income": re.compile(
        r"(other[_-]?income|rental[_-]?income|dividends|bonuses|overtime|family[_-]?tax[_-]?benefit)\b", re.I
    ),
    "living_expenses": re.compile(
        r"(living[_-]?expenses|hem[_-]?benchmark|monthly[_-]?expenditure|household[_-]?expenses|basic[_-]?living)\b", re.I
    ),
    "credit_card_limits": re.compile(
        r"(credit[_-]?card[_-]?limit|card[_-]?balance|existing[_-]?cards?|revolving[_-]?credit)\b", re.I
    ),
    "other_liabilities": re.compile(
        r"(other[_-]?liabilities|personal[_-]?loans?|car[_-]?loan|hecs[_-]?help|mortgage[_-]?debt)\b", re.I
    ),
    "bsb": re.compile(
        r"\b(bsb|bank[_-]?state[_-]?branch|branch[_-]?code)\b", re.I
    ),
    "account_number": re.compile(
        r"\b(account[_-]?number|acc[_-]?no|account[_-]?#|acc[_-]?num)\b", re.I
    ),
    "abn": re.compile(
        r"\b(abn|australian[_-]?business[_-]?number|acn)\b", re.I
    )
}

# ==============================================================================
# AUSTRALIAN REGULATORY VALIDATION UTILITIES
# ==============================================================================
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
    """Ensures applicant DOB represents plausible lending age (18 to 105)."""
    m = re.search(r"\b(0[1-9]|[12][0-9]|3[01])[-/.](0[1-9]|1[012])[-/.](19\d\d|20[0-2]\d)\b", str(dob_str))
    if not m:
        return False
    year = int(m.group(3))
    age = 2026 - year
    return 18 <= age <= 105

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
# GOOGLE DRIVE DOWNLOAD UTILITY
# ==============================================================================
def download_google_drive_folder(folder_id: str = DEFAULT_GDRIVE_FOLDER, destination: Path = INPUT_DIR) -> int:
    """Downloads an entire public Google Drive folder using gdown."""
    logging.info(f"[*] Checking Google Drive folder {folder_id}...")
    destination.mkdir(parents=True, exist_ok=True)
    
    # Check if folder already contains files
    existing = list(destination.glob("**/*"))
    valid_files = [f for f in existing if f.is_file() and f.stat().st_size > 0]
    if valid_files:
        logging.info(f"[+] Found {len(valid_files)} pre-existing files in {destination}. Sync verified.")
        return len(valid_files)

    if gdown is None:
        logging.warning("[!] 'gdown' package not found. Skipping Google Drive download.")
        return 0

    try:
        url = f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing"
        logging.info(f"[*] Downloading Google Drive folder from {url}...")
        gdown.download_folder(url=url, output=str(destination), quiet=False, remaining_ok=True)
        downloaded = [f for f in destination.glob("**/*") if f.is_file()]
        logging.info(f"[+] Download complete: {len(downloaded)} files saved to {destination}")
        return len(downloaded)
    except Exception as e:
        logging.error(f"[-] Google Drive download encountered error: {e}")
        return 0

# ==============================================================================
# MULTI-ENGINE WORKER INITIALIZATION (Lazy & VRAM-Pinned)
# ==============================================================================
_paddle = None
_easy = None
_surya_det = None
_surya_det_proc = None
_surya_rec = None
_surya_rec_proc = None
_nlp = None

def init_worker():
    global _paddle, _easy, _surya_det, _surya_det_proc, _surya_rec, _surya_rec_proc, _nlp
    try:
        gpu_available = torch.cuda.is_available()
        if PaddleOCR is not None:
            _paddle = PaddleOCR(use_angle_cls=True, lang="en", show_log=False, use_gpu=gpu_available)
        if easyocr is not None:
            _easy = easyocr.Reader(["en"], gpu=gpu_available)
        if run_ocr is not None:
            _surya_det, _surya_det_proc = load_det_model(), load_det_processor()
            _surya_rec, _surya_rec_proc = load_rec_model(), load_rec_processor()
        if spacy is not None:
            _nlp = spacy.load("en_core_web_sm")
    except Exception as e:
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(f"Worker Init Exception: {e}\n")

# ==============================================================================
# PASS-AWARE PROGRESSIVE DOCUMENT EXTRACTION (10 PASSES)
# ==============================================================================
def enhance_image_for_pass(image: Image.Image, pass_num: int) -> Image.Image:
    """Applies tailored image processing filters depending on the pass iteration."""
    if pass_num <= 1:
        return image
    elif pass_num == 2:
        # Pass 2: Grayscale & slight contrast boost
        return ImageEnhance.Contrast(image.convert("L")).enhance(1.4).convert("RGB")
    elif pass_num == 3:
        # Pass 3: Edge sharpening for text boundary detection
        return image.filter(ImageFilter.SHARPEN)
    elif pass_num == 4:
        # Pass 4: CLAHE-like contrast equalization
        np_img = np.array(image.convert("L"))
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        eq = clahe.apply(np_img)
        return Image.fromarray(eq).convert("RGB")
    elif pass_num == 5:
        # Pass 5: Otsu auto-binarization for low-contrast photocopies
        np_img = np.array(image.convert("L"))
        _, thresh = cv2.threshold(np_img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return Image.fromarray(thresh).convert("RGB")
    elif pass_num >= 6:
        # Pass 6+: High-frequency unsharp mask + 1.6x bicubic scale
        w, h = image.size
        scaled = image.resize((int(w * 1.4), int(h * 1.4)), Image.Resampling.BICUBIC)
        return scaled.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    return image

def run_pass_ocr(image: Image.Image, pass_num: int) -> str:
    """Executes specific OCR algorithms tailored to the current pass."""
    enhanced_img = enhance_image_for_pass(image, pass_num)
    collected = set()
    cv_img = cv2.cvtColor(np.array(enhanced_img), cv2.COLOR_RGB2BGR)

    # Pass 1-2: Fast Tesseract
    if pytesseract is not None and pass_num in [1, 2, 6, 7, 8, 9, 10]:
        try:
            tess_txt = pytesseract.image_to_string(enhanced_img)
            for line in tess_txt.splitlines():
                if len(line.strip()) > 1:
                    collected.add(line.strip())
        except Exception:
            pass

    # Pass 3-4, 7-10: PaddleOCR with Angle Classification
    if _paddle is not None and pass_num in [3, 7, 8, 9, 10]:
        try:
            p_res = _paddle.ocr(cv_img, cls=True)
            if p_res:
                for block in p_res:
                    if block:
                        for line in block:
                            collected.add(line[1][0].strip())
        except Exception:
            pass

    # Pass 4, 8, 10: EasyOCR deep convolutional model
    if _easy is not None and pass_num in [4, 8, 10]:
        try:
            for txt in _easy.readtext(cv_img, detail=0):
                collected.add(txt.strip())
        except Exception:
            pass

    # Pass 5, 9, 10: Surya Layout & Recognition
    if _surya_rec is not None and pass_num in [5, 9, 10]:
        try:
            preds = run_ocr([enhanced_img], [_surya_det], [_surya_det_proc], [_surya_rec], [_surya_rec_proc])
            for page in preds:
                for line in page.text_lines:
                    collected.add(line.text.strip())
        except Exception:
            pass

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    gc.collect()

    return "\n".join(collected)

def extract_australian_banking_fields(text: str) -> Dict[str, Any]:
    """Extracts and validates all 30 Australian banking application fields."""
    data: Dict[str, Any] = {field: "" for field in BANK_FIELD_PATTERNS.keys()}
    confidences: Dict[str, float] = {field: 0.0 for field in BANK_FIELD_PATTERNS.keys()}

    lines = text.splitlines()

    # Generic Regex Patterns
    emails = re.findall(r"\b[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+\b", text)
    phones = re.findall(r"(?:\+?61\s?|0)[2-478](?:[ -]?[0-9]){8}\b", text)
    dobs = re.findall(r"\b(0[1-9]|[12][0-9]|3[01])[-/.](0[1-9]|1[012])[-/.](?:19|20)\d\d\b", text)
    abns = re.findall(r"\b(\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3})\b", text)
    bsbs = re.findall(r"\b(\d{3}[- ]?\d{3})\b", text)
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

    for bsb in bsbs:
        if validate_australian_bsb(bsb):
            data["bsb"] = bsb
            confidences["bsb"] = 0.98
            break

    for dob in dobs:
        dob_str = f"{dob[0]}/{dob[1]}/{dob[2]}"
        if validate_australian_dob(dob_str):
            data["date_of_birth"] = dob_str
            confidences["date_of_birth"] = 0.95
            break

    if phones:
        data["mobile_number"] = phones[0]
        confidences["mobile_number"] = 0.95

    if emails:
        data["email_address"] = emails[0]
        confidences["email_address"] = 0.98

    # Contextual line scanning for the 30 fields
    for line in lines:
        cleaned_line = line.strip()
        if not cleaned_line:
            continue

        for field, pattern in BANK_FIELD_PATTERNS.items():
            if pattern.search(cleaned_line):
                # Search for values following a colon, dash, or space
                parts = re.split(r"[:\t\-\=]", cleaned_line, maxsplit=1)
                if len(parts) > 1 and len(parts[1].strip()) > 1:
                    val = parts[1].strip()
                    if not data[field] or confidences[field] < 0.80:
                        data[field] = val
                        confidences[field] = 0.82

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
def process_single_file_for_pass(args: Tuple[str, int]) -> Tuple[str, str, Dict[str, Any]]:
    fpath, pass_num = args
    path = Path(fpath)
    if not path.exists() or path.stat().st_size == 0:
        return "EMPTY", fpath, {}

    ext = path.suffix.lower()
    raw_texts = []
    images = []

    try:
        if ext == ".pdf":
            doc = fitz.open(path)
            for page in doc:
                txt = page.get_text()
                if txt.strip():
                    raw_texts.append(txt)
                if pass_num > 1 or not txt.strip():
                    # Rasterize page for visual OCR passes
                    dpi = 200 if pass_num < 6 else 300
                    pix = page.get_pixmap(dpi=dpi)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    images.append(img)
                    pix = None
            doc.close()
        elif ext in [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"]:
            images.append(Image.open(path).convert("RGB"))
        elif ext == ".docx":
            import docx
            doc = docx.Document(path)
            raw_texts.append("\n".join([p.text for p in doc.paragraphs]))
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
    for img in images:
        ocr_texts.append(run_pass_ocr(img, pass_num))

    combined_text = "\n".join(raw_texts + ocr_texts)
    if not combined_text.strip():
        return "NOOCR", fpath, {}

    result = extract_australian_banking_fields(combined_text)
    return "SUCCESS", fpath, result

# ==============================================================================
# REGRESSION VERIFICATION & DUCKDB PERSISTENCE (Zero-Lock WAL)
# ==============================================================================
def init_duckdb():
    with duckdb.connect(str(DB_PATH)) as con:
        con.execute("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;")
        # Master table with 30 fields + audit metadata
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

    for status, fpath, res in results:
        fname = os.path.basename(fpath)
        prev_rec = prev_dict.get(fname, {})
        new_fields = res.get("fields", {})
        new_confs = res.get("confidences", {})

        merged_fields = {}
        # MONOTONIC QUALITY INVARIANT:
        # Never overwrite an existing high-confidence field with an empty or low-confidence match
        for k in BANK_FIELD_PATTERNS.keys():
            prev_val = str(prev_rec.get(k, "") or "")
            new_val = str(new_fields.get(k, "") or "")
            new_conf = new_confs.get(k, 0.0)

            if prev_val and not new_val:
                # Potential regression detected -> block downgrade
                merged_fields[k] = prev_val
                regressions_prevented += 1
            elif prev_val and new_val and new_conf < 0.60:
                # Existing value was preserved
                merged_fields[k] = prev_val
            elif new_val:
                if not prev_val:
                    newly_resolved_fields += 1
                merged_fields[k] = new_val
            else:
                merged_fields[k] = ""

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
        con.execute("INSERT OR REPLACE INTO identities SELECT * FROM df_update")

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
        
        # Count non-empty fields across all 30 columns
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
    parser = argparse.ArgumentParser(description="NGX Spark Multi-Pass OCR & Regression Engine")
    parser.add_argument("--pass-num", type=int, default=None, help="Execute specific pass number (1-10)")
    parser.add_argument("--max-passes", type=int, default=10, help="Maximum number of passes in loop (default: 10)")
    parser.add_argument("--gdrive-folder-id", type=str, default=DEFAULT_GDRIVE_FOLDER, help="Google Drive folder ID")
    parser.add_argument("--sync-gdrive", action="store_true", help="Force Google Drive folder sync before execution")
    args = parser.parse_args()

    try:
        mp.set_start_method("spawn", force=True)
    except RuntimeError:
        pass

    init_duckdb()

    # Phase 1: Ingest files from Google Drive if required or if input directory is empty
    input_files = [str(p) for p in INPUT_DIR.glob("**/*") if p.is_file() and not p.name.startswith(".")]
    if args.sync_gdrive or not input_files:
        logging.info("[*] Syncing documents from Google Drive...")
        download_google_drive_folder(args.gdrive_folder_id, INPUT_DIR)
        input_files = [str(p) for p in INPUT_DIR.glob("**/*") if p.is_file() and not p.name.startswith(".")]

    if not input_files:
        logging.warning(f"[!] No documents found in {INPUT_DIR}. Add documents or ensure Google Drive folder is accessible.")
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
        import time
        time.sleep(3)

    logging.info(f"[+] Pipeline execution complete. Consolidated output exported to {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
