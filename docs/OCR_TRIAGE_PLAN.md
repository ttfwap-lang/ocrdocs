# OCR triage plan — ranking every file by how likely it is to yield OCR-able text

Status: **plan only, not executed.** Nothing in this document has been run against a corpus.

Goal: produce a complete, ranked inventory of every file under a corpus root, ordered from
*most likely* to *least likely* to yield OCR-able text — where "OCR-able" explicitly includes
files that only become OCR-able **after** being extracted, decoded, converted, repaired or
carved, and where the filename and extension are treated as hints, never as facts.

Charter anchors: Stage 2 (supported formats and unsupported-input handling), Stage 8
(governed evaluation corpus: permissions, provenance, coverage, duplicate leakage),
Stage 16 (signature validation and bounded parsing), Stage 17 (native text layer versus
genuine OCR need).

## 0. Authorization gate — read before anything is executed

- `Recovered_C/` is an off-limits path under `RULES.md` ("do not access sensitive
  `Recovered_C` contents") and `.junie/guidelines.md` §2. This plan may be **written**
  freely; it may only be **run** against that corpus after the owner explicitly authorizes
  that specific run and names the corpus root.
- The triage is **local and offline**: no file content, thumbnail, extracted text or filename
  leaves the machine, and no content is sent to any external model (`RULES.md`: no real
  documents to external models without an approved data-sharing configuration).
- Outputs record *metadata and measurements only* — never document content, never a quoted
  line of text, never a personal name pulled from a file. Where a filename itself is personal
  data, the inventory stores the path hash plus a folder-relative index, and the plain path
  only in a separate owner-only sidecar file that is gitignored.
- The corpus and all outputs stay outside `.junie/`; evidence goes to `automation/runs/`.

Known corpus roots (existence checked by path only, no content read):
`<repo>/Recovered_C` — 138 files. A second root referenced by `scripts/deploy.sh`
(`/d/Recovered_C/_Raw_Data_and_Databases`) does **not** exist on this host and must be
re-confirmed by the owner before it is included.

## 1. The two scores, and why one is not enough

A Windows tile PNG is trivially OCR-able and worth nothing. A password-protected archive
containing forty scanned statements is worth a great deal and currently yields nothing. So
every candidate carries two independent scores, and the ranking is their product.

| Score | Range | Question it answers |
|---|---|---|
| `ocrability` | 0.0–1.0 | How likely is it that pixels containing legible glyphs can be produced from this file at all? |
| `doc_value` | 0.0–1.0 | If those pixels exist, how likely are they to be a *document* (statement, form, ID, letter, invoice) rather than UI chrome, an icon, a texture or a meme? |
| `transform_cost` | 0–4 | How many deterministic steps stand between the file as found and those pixels (§3)? |

```
rank_score = ocrability * doc_value * cost_penalty[transform_cost]
cost_penalty = [1.00, 0.92, 0.80, 0.60, 0.35]   # T0..T4, tunable, recorded in the run manifest
```

Ranking is over **leaf candidates**, not over top-level files: one `.zip` can expand into
forty candidates, each ranked on its own, each carrying its parent's provenance.

## 2. Tier table — likely to least likely

Tiers are the human-readable buckets the scores fall into. "Signal" is what the classifier
actually looks at; extension is never the deciding signal.

### Tier 0 — Certain: already page-like pixels (T0)

| Class | Signal | Notes |
|---|---|---|
| Scanned raster images | JPEG/JFIF/Exif, PNG, TIFF (incl. multi-page), BMP, WEBP, JP2, HEIC/HEIF | Highest yield when DPI ≥ 150, aspect ratio near a paper size, low colour count |
| Image-only PDF | `%PDF`, page objects with ≥1 full-page image and ~0 text characters | The canonical scan-in-a-wrapper |
| Fax / CCITT G3-G4 TIFF | compression tag 3/4 | Almost always a document |
| Screenshots | PNG/JPEG, screen-shaped dimensions, sRGB, low noise | OCR-able; `doc_value` depends on content, so mid-ranked |

### Tier 1 — Very likely, one deterministic conversion (T1)

| Class | Signal | Conversion |
|---|---|---|
| Mixed/vector PDF | `%PDF` with both text layer and images | Render pages; route per Stage 17 (native text vs OCR) |
| Camera RAW (CR2/NEF/ARW/DNG) | TIFF-like magic + maker notes | Decode to raster; often photos *of* documents |
| PSD / XCF / AI / EPS / PS | `8BPS`, `gimp xcf`, `%!PS` | Flatten and rasterize |
| EMF / WMF / SVG | `\x01\x00\x00\x00` EMF header, `<svg` | Rasterize at a fixed DPI |
| Legacy Office (DOC/XLS/PPT) | OLE2 `D0 CF 11 E0` | Extract embedded images; body text needs no OCR |
| OOXML (DOCX/XLSX/PPTX) | ZIP whose `[Content_Types].xml` exists | `word/media/**` etc. are the OCR candidates |
| RTF with objects | `{\rtf` + `\pict` | Decode hex/binary picture groups |

### Tier 2 — Likely after container extraction (T2)

| Class | Signal | Extraction |
|---|---|---|
| Archives: ZIP/7z/RAR/TAR/GZ/BZ2/CAB/MSI/ISO/VHD(X) | container magic | Recurse with depth/size bounds (§4) |
| Email stores: PST/OST/MBOX/EML/MSG | `!BDN`, `From ` , OLE2 | Attachments are the candidates; body text is not OCR work |
| SQLite blob stores (browser prefs/caches, messaging DBs) | `SQLite format 3` | Enumerate BLOB columns, sniff each blob's magic |
| Thumbnail/asset caches (`thumbcache_*.db`, `Thumbs.db`, LevelDB, IndexedDB, browser cache entries) | vendor headers | Thumbnails are low-resolution: `ocrability` capped ~0.4, but they *prove* a lost original existed |
| OneNote / EPUB / CHM / MHTML | `\xE4\x00\x2A\x8C`, ZIP+`mimetype`, `ITSF`, MIME multipart | Embedded images and base64 parts |
| Base64/quoted-printable payloads inside text files | regex for `data:image/...;base64,` or long base64 runs with image magic after decode | The one hook that lifts a text file out of Tier 5 |

### Tier 3 — Possible but degraded; recovery work required (T3)

- Truncated or header-damaged images: valid magic, short/invalid data — partial decode often
  still yields the top *n* rows, which for a scan is frequently the letterhead and the
  account number.
- Renamed / extension-stripped / extension-spoofed files (e.g. a backup suffix over a real
  image, a `.dat` that is a JPEG). Detected purely by signature scan; extension disagreement
  is itself recorded as a finding.
- Partial downloads and editor artifacts: `.part`, `.crdownload`, `.tmp`, `.bak`, `~$*`.
- Polyglot / appended-data files: a valid container with a second file appended after EOF.
- Recovered files with a zeroed first cluster: no header, but entropy and block structure
  consistent with JPEG/PNG payload.

### Tier 4 — Carving territory; no usable header at all (T4)

- Extension-less fragments from unallocated space: scan for embedded signatures at any
  offset (`FF D8 FF`, `\x89PNG`, `%PDF`, `II*\0`/`MM\0*`), then attempt bounded reconstruction.
- Files whose only evidence is an embedded thumbnail (Exif/JFIF thumbnail inside a broken
  parent).
- Video and animation: MP4/MOV/AVI/MKV/GIF. Frame sampling can OCR screen recordings and
  subtitles; `doc_value` is low unless the corpus is known to contain screen captures.

### Tier 5 — Unlikely: machine-readable already, or not a document (T0 but low value)

- XML, JSON, CSV, HTML, INI, `.config`, logs, source code, localisation databases,
  `CompDB`/`FOD` manifests. These need **parsing, not OCR** — the correct action is text
  extraction, and they only re-enter the OCR pipeline via the base64 hook in Tier 2.
- UI assets: icon/tile PNGs, sprite sheets, texture atlases, `.ico`. Highly OCR-able,
  near-zero `doc_value`; the ranking must push them down or the top of the list fills with
  Windows tiles.

### Tier 6 — Effectively impossible without something the corpus does not contain

- Encrypted or password-protected archives, PDFs and Office files; DRM-wrapped documents.
  Recorded as **blocked, not impossible**: the unblocking action is a credential, and
  `RULES.md` forbids replacing a missing credential with an assumption.
- Compiled binaries and libraries (EXE/DLL/SYS/`.mo`/`.pyc`), fonts and composite fonts,
  language and prediction models, certificates, keystores, keyboard layouts.
- Zero-byte files, sparse placeholders, reparse points/junctions (never followed), and
  high-entropy fragments with no recoverable structure.

## 3. Transform-cost ladder

| T | Meaning | Example |
|---|---|---|
| T0 | Feed the bytes to OCR as-is | JPEG scan |
| T1 | One deterministic conversion | render PDF page, decode HEIC |
| T2 | Open a container, then T0/T1 on a child | ZIP → DOCX → `word/media/image1.png` |
| T3 | Repair, partial decode or de-obfuscation first | truncated JPEG, renamed file |
| T4 | Carve from raw bytes with no valid header | signature scan in unallocated fragment |

Cost is recorded per candidate, so the owner can ask for "everything at T0–T1" and get a
runnable batch immediately, rather than waiting for the long tail.

## 4. Pipeline

Read-only throughout. Nothing is moved, renamed, repaired in place or deleted; all derived
artifacts are written to a separate work directory.

| Phase | Does | Guards |
|---|---|---|
| P0 authorization | Confirm owner approval, corpus roots, output location | Refuse to start without them |
| P1 enumerate | Walk the root; record relative path, size, mtime/ctime, attributes, extension, SHA-256 | Long paths (`\\?\`), hidden/system files, alternate data streams; junctions and symlinks recorded, **never followed** |
| P2 type | Classify by leading/trailing bytes and structure (libmagic-equivalent), plus Shannon entropy and byte histogram | Extension recorded separately; every mismatch flagged |
| P3 expand | Recurse into containers and blob stores, emitting child candidates with parent provenance | Max depth 4, max expansion ratio 100×, max child count per container, per-file timeout, total-bytes budget — zip-bomb and billion-laughs guards |
| P4 measure | Per candidate: page count, pixel dimensions, DPI, bit depth, colour count, image-area fraction, embedded-image count, text-layer character count, thumbnail flag, truncation flag | Bounded parsers only (Stage 16); a parser crash marks the candidate `unparsed`, never drops it |
| P5 score | Apply §1 to produce `ocrability`, `doc_value`, `transform_cost`, `rank_score`, tier | Weights live in one versioned config; the config hash is in the run manifest |
| P6 dedupe | Group exact duplicates by SHA-256 and near-duplicates by perceptual hash on decodable images | Recovered corpora are duplicate-heavy; the ranked list shows one representative plus a duplicate count, and duplicate-leakage data feeds Stage 8 |
| P7 calibrate | Stratified random sample (fixed seed), owner labels each as document / not-document / unreadable; measure per-tier precision | Without this the tiers are *asserted*, not measured — and an asserted tier is not evidence |
| P8 report | Emit the artifacts in §5 with tool versions and exit codes | No content in any artifact |

## 5. Outputs

```
automation/runs/ocr-triage/<timestamp>/
  manifest.json      # roots, tool versions, weight-config hash, seed, budgets, start/end, exit code
  inventory.jsonl    # one record per candidate (leaf), append-only
  ranked.csv         # rank_score desc: rank, tier, type, transform_cost, size, pages, dup_count, path_hash
  tiers.md           # counts and total bytes per tier, plus the top blockers
  calibration.json   # sample, labels, per-tier precision, sample size and CI
  errors.jsonl       # unparsed/timeout/denied, with reason — never silently dropped
  paths.private.csv  # path_hash -> real path (owner-only, gitignored, never quoted in reports)
```

Candidate record:

```json
{
  "candidate_id": "sha256:...#2",
  "parent_id": "sha256:...",
  "path_hash": "sha256:...",
  "container_chain": ["zip", "docx"],
  "detected_type": "image/png",
  "extension": ".dat",
  "extension_mismatch": true,
  "size_bytes": 184320,
  "pages": 1,
  "width": 2480, "height": 3508, "dpi": 300,
  "text_layer_chars": 0,
  "image_area_fraction": 0.98,
  "truncated": false,
  "encrypted": false,
  "transform_cost": 2,
  "ocrability": 0.95,
  "doc_value": 0.80,
  "rank_score": 0.61,
  "tier": 0,
  "notes": ["a4-aspect", "grayscale"]
}
```

## 6. Edge cases the classifier must handle explicitly

Each of these gets a test fixture before the pipeline is trusted:

1. Extension lies (JPEG named `.dat`; EXE named `.jpg`).
2. Polyglot file valid as two types; appended data after EOF.
3. Truncated image, truncated PDF trailer, PDF with a broken xref that still renders.
4. PDF with a misleading text layer (garbage OCR baked in by a previous tool) — Stage 17's
   case; must be routed to OCR, not accepted as native text.
5. Password-protected ZIP / PDF / DOCX → `blocked`, with the unblocking action named.
6. Zip bomb, deeply nested archive, archive containing itself.
7. Zero-byte, 1-byte, and >2 GB files; sparse files; NTFS ADS carrying the real payload.
8. Paths >260 characters, case-only collisions, Unicode normalisation collisions, reserved
   Windows names.
9. Junctions/symlinks pointing back into the corpus (cycle) or outside it (escape).
10. Files locked by another process; permission denied — recorded in `errors.jsonl`, never
    counted as "not OCR-able".
11. Duplicate content under many names (recovery tools rename aggressively).
12. Multi-page TIFF and PDF portfolios: page count, not file count, is the unit of work.
13. CMYK, 1-bit, rotated and negative-polarity scans — decodable but easily mis-measured.
14. Corrupt EXIF/DPI metadata claiming absurd resolutions.

## 7. What this plan deliberately does **not** do

- It does not run OCR. It ranks candidates so OCR effort is spent in the right order.
- It does not judge OCR accuracy — a Tier 0 placement predicts *legible pixels*, never a
  correct extraction (`RULES.md`: never equate heuristic confidence, checksums or
  completeness with accuracy, identity or recall).
- It does not move, repair or clean the corpus; recovery actions are proposed, not applied.
- It does not open `Recovered_C/` at all until §0's authorization exists.

## 8. Acceptance evidence for the run (when it is authorized)

- Enumeration total matches an independent count of the root (`Get-ChildItem -Recurse -File`),
  with any difference explained by `errors.jsonl`.
- Every enumerated file appears in exactly one of `inventory.jsonl` (as itself or as a parent
  of children) or `errors.jsonl`. Zero silent drops.
- The fixture suite in §6 passes, with each edge case asserted, and the run is reproducible:
  same corpus + same weight config + same seed ⇒ identical `ranked.csv` hash.
- `calibration.json` reports per-tier precision from owner labels with its sample size; a tier
  with no labelled sample is reported as **unverified**, not as accurate.
- Commands, exit codes and wall-clock in `manifest.json`; a summary row in `STATE.md` and the
  Stage 8 row of `docs/ACCEPTANCE_REGISTER.md`.

## 9. Suggested execution order

1. Build P1+P2 (enumerate + type) and run it on a **synthetic fixture corpus** only — this
   needs no authorization and proves the classifier.
2. Add P3 expansion with its budgets, plus the §6 fixtures.
3. Add P4+P5 scoring; publish `tiers.md` for the fixture corpus.
4. Request owner authorization for the real corpus root; then P1–P6 on it.
5. P7 calibration with owner labels; re-tune weights once, record the change.
6. Hand the T0–T1 head of `ranked.csv` to the OCR pipeline as the first batch.
