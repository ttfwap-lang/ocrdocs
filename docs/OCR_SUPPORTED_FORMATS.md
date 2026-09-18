# OCR Supported Formats

Canonical reference for the file types the OCR Docs pipeline accepts, how each one
is decoded, and how the upload filter (`server/middleware/upload.ts`) stays in sync
with the engine dispatch in `scripts/ocr_spark_engine.py`.

## Upload filter (server side)

| Extension | MIME accepted | Engine path |
|-----------|---------------|-------------|
| `.pdf`    | `application/pdf` | pdfium native-text layer **or** raster render + OCR |
| `.png`    | `image/png`  | Pillow → RGB → OCR |
| `.jpg` / `.jpeg` | `image/jpeg` | Pillow → RGB → OCR |
| `.tiff` / `.tif` | `image/tiff` | Pillow → RGB → OCR |
| `.bmp`    | `image/bmp`  | Pillow → RGB → OCR |
| `.webp`   | `image/webp` | Pillow → RGB → OCR |
| `.docx`   | application/vnd.openxmlformats-officedocument.wordprocessingml.document | `python-docx` native text |
| `.rtf`    | `application/rtf` (also `application/x-rtf`, `text/rtf`) | `striprtf` (optional) |
| `.xml`    | `application/xml` / `text/xml` | raw text cap (≤ 50 000 chars) |
| `.txt`    | `text/plain` | raw text cap (≤ 50 000 chars) |
| `.json`   | `application/json` | raw text cap (≤ 50 000 chars) |

* **50 MiB maximum** per document (enforced in `upload.ts` via `SUPPORTED_EXTENSIONS`).
* A file is accepted if **either** its declared MIME type **or** its extension is on the
  allow-list (`fileFilter` is a dual MIME-or-extension match), so mis-labelled
  `.docx`/`.xml`/`.txt` still route correctly.
* Office binaries (`.doc`, `.xls`, `.xlsx`, `.ppt`, `.pptx`) are **explicitly rejected**
  with the message `Unsupported Office binary (legacy .doc/.xls/.ppt). Convert to PDF or DOCX.` —
  the Python engine has no legacy-binary parser and accepting them would only produce
  `NOOCR` noise. Convert them to PDF/DOCX before upload.
* `.doc`/`.xls`/`.ppt`/`.csv`/`.zip`/`.eml`/`.msg`/`.heic`/`.svg` and any other extension
  produce `NOOCR` (engine dispatch fall-through) and are blocked by the upload filter
  with `UNSUPPORTED_FORMAT`.

## Engine dispatch (`process_single_file_for_pass`, L751–815)

* `.pdf` → `pdfium` native text layer via `page.get_textpage().get_text_bounded()`
  (cached per-process, keyed by path/mtime/size), **plus** a per-page raster render at
  `dpi=200` for passes < 6 and `dpi=300` for passes ≥ 6. Native text and OCR text are both
  fed to the multi-pass engine so a scanned page inside a digital PDF is still recovered.
  Per-page `try/except` ensures one bad page cannot poison the whole document.
* Image extensions (`.jpg/.jpeg/.png/.bmp/.tiff/.tif/.webp`) → `PIL.Image.open(...).convert("RGB")`.
* `.docx` → lazy `import docx`; `.rtf` → lazy `striprtf` (optional; degrades to `PARSE_ERROR`).
* `.xml/.txt/.json/.final` → raw text, capped at `[:50000]`.
* Anything else → `NOOCR` (empty text).

## Native-text vs OCR path

* **Native-text formats** (`.pdf` digital layer, `.docx`, `.txt`, `.xml`, `.json`)
  bypass OCR entirely: the text is exact, so matches receive a high fixed confidence
  (`0.95`) and are never confused with OCR guesses.
* **Raster formats** (`.pdf` scanned pages, `.png/.jpg/.tif/.bmp/.tiff/.webp`) go
  through real OCR; each recognized line carries its real per-engine confidence via
  `line_confidences`.

## Local engine availability vs gx10

| Component | Available locally | On gx10 |
|-----------|-------------------|---------|
| Tesseract | **Yes** (`v5.5.3`, leptonica 1.87.0) | Yes |
| pdfium (`pypdfium2`) | Yes | Yes |
| OpenCV / Pillow / numpy | Yes | Yes |
| EasyOCR | No | Yes |
| PaddleOCR | No | Yes |
| Surya | No | Yes (opt-in) |
| TrOCR (handwriting) | No | Yes (opt-in) |
| spaCy (PERSON/ORG NLP) | **No** → `given_names`/`family_name`/`employer_details` fall back to regex line-scan | Yes |
| `python-docx` | Yes (installed locally) | Yes |
| `striprtf` | No → `.rtf` degrades to `PARSE_ERROR` | Yes |
| `torch` (research/handwriting) | Present (2.4.1 → disabled; ≥2.5 required) | Yes (CUDA via `nvidia-smi`) |

> Research engines (EasyOCR/PaddleOCR/Surya) and the handwriting engine (TrOCR) are
> gated behind `OCRDOCS_ENABLE_RESEARCH_ENGINES` and `OCRDOCS_ENABLE_HANDWRITING_ENGINE`
> and are **disabled by default** — they are a gx10 GPU-tier feature.
