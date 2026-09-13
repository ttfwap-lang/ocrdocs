#!/usr/bin/env python3
"""
Quick Australian Banking OCR Runner for DGX
Direct execution script for /mnt/nvme/ocr_pipeline
"""
import os, sys, re, glob, json
from pathlib import Path
import fitz  # PyMuPDF
import duckdb

NVME_DIR = Path("/mnt/nvme/ocr_pipeline")
INPUT_DIR = NVME_DIR / "input"
OUTPUT_DIR = NVME_DIR / "output"
DB_PATH = NVME_DIR / "db" / "identity_index.duckdb"
CSV_PATH = OUTPUT_DIR / "ocr_consolidated_identities.csv"

for d in [INPUT_DIR, OUTPUT_DIR, DB_PATH.parent]:
    d.mkdir(parents=True, exist_ok=True)

# Australian validation logic
def validate_abn(abn_str):
    clean = re.sub(r"[^\d]", "", str(abn_str))
    if len(clean) != 11: return False
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    digits = [int(c) for c in clean]
    digits[0] -= 1
    return sum(d * w for d, w in zip(digits, weights)) % 89 == 0

def validate_bsb(bsb_str):
    clean = re.sub(r"[^\d]", "", str(bsb_str))
    return len(clean) == 6 and (1 <= int(clean[:2]) <= 99)

def extract_fields(text):
    data = {}
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    
    # Core regex extractors
    abns = re.findall(r"\b(\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3})\b", text)
    data["abn"] = next((a for a in abns if validate_abn(a)), "")
    
    bsbs = re.findall(r"\b(\d{3}[- ]?\d{3})\b", text)
    data["bsb"] = next((b for b in bsbs if validate_bsb(b)), "")
    
    dobs = re.findall(r"\b(0[1-9]|[12][0-9]|3[01])[-/.](0[1-9]|1[012])[-/.](?:19|20)\d\d\b", text)
    data["date_of_birth"] = f"{dobs[0][0]}/{dobs[0][1]}/{dobs[0][2]}" if dobs else ""
    
    emails = re.findall(r"\b[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+\b", text)
    data["email_address"] = emails[0] if emails else ""
    
    phones = re.findall(r"(?:\+?61\s?|0)[2-478](?:[ -]?[0-9]){8}\b", text)
    data["mobile_number"] = phones[0] if phones else ""
    
    currencies = re.findall(r"\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|\b[0-9]{4,7}\b)", text)
    if currencies:
        nums = sorted([float(c.replace(',', '')) for c in currencies], reverse=True)
        data["gross_annual_income"] = f"${nums[0]:,.2f}" if nums[0] > 30000 else ""
        data["net_monthly_income"] = f"${nums[1]:,.2f}" if len(nums) > 1 else ""

    for l in lines:
        if re.search(r"first[_-]?name|given[_-]?name", l, re.I):
            parts = re.split(r"[:\t\-\=]", l, maxsplit=1)
            if len(parts) > 1: data["given_names"] = parts[1].strip()
        elif re.search(r"last[_-]?name|surname|family[_-]?name", l, re.I):
            parts = re.split(r"[:\t\-\=]", l, maxsplit=1)
            if len(parts) > 1: data["family_name"] = parts[1].strip()
        elif re.search(r"employer|company|organisation", l, re.I):
            parts = re.split(r"[:\t\-\=]", l, maxsplit=1)
            if len(parts) > 1: data["employer_details"] = parts[1].strip()
            
    return data

def main():
    files = [f for f in INPUT_DIR.glob("**/*") if f.is_file() and not f.name.startswith(".")]
    print(f"[*] Found {len(files)} target documents in {INPUT_DIR}")
    if not files:
        print("[!] No documents in input directory. Sync with gdown first:")
        print("    python3 -m gdown --folder 'https://drive.google.com/drive/folders/16q3PdioHVbLIBVqU--54nBvNhqLE7bNN' -O /mnt/nvme/ocr_pipeline/input")
        return

    records = []
    for idx, path in enumerate(files, 1):
        print(f"[{idx}/{len(files)}] Processing: {path.name}")
        txt = ""
        try:
            if path.suffix.lower() == ".pdf":
                doc = fitz.open(path)
                for page in doc: txt += page.get_text() + "\n"
                doc.close()
            else:
                with open(path, "r", errors="ignore") as f: txt = f.read(50000)
        except Exception as e:
            print(f"    Error reading: {e}")
            continue

        fields = extract_fields(txt)
        fields["filename"] = path.name
        fields["abn_valid"] = validate_abn(fields.get("abn", ""))
        fields["bsb_valid"] = validate_bsb(fields.get("bsb", ""))
        records.append(fields)

    # Save to DuckDB and CSV
    with duckdb.connect(str(DB_PATH)) as con:
        con.execute("CREATE TABLE IF NOT EXISTS identities AS SELECT * FROM records")
        con.execute("INSERT OR REPLACE INTO identities SELECT * FROM records")
        con.execute(f"COPY identities TO '{CSV_PATH}' (HEADER, DELIMITER ',')")
        
    print(f"\n[+] Successfully extracted and verified {len(records)} documents!")
    print(f"[+] Consolidated CSV: {CSV_PATH}")
    print(f"[+] DuckDB Database: {DB_PATH}")

if __name__ == "__main__":
    main()
