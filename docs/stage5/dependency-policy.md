# Dependency and Runtime Installation Policy

**Stage 5 Deliverable — Authoritative Policy**  
**Charter Gate Fulfillment:** *Pin compatible runtimes, packages, native tools and models, screen licenses and document installation/update policy. Gate: clean target installation works without hidden caches/settings; new engine choices repeat these checks.*

---

## 1. Compatible Runtime Matrix

The OCRDocs commercial application requires exact runtime environments. Deployments outside these ranges are unsupported:

| Subsystem | Permitted Runtime Range | Authoritative Target | Architecture | Notes |
|---|---|---|---|---|
| **Node.js** | `>=20.0.0` (LTS active) | `24.19.0` (or `22.x LTS`) | `x64` | Native ESM and standard Fetch / Web Crypto APIs |
| **npm** | `>=10.0.0` | `11.17.0` | `x64` | Enforces exact lockfile resolution |
| **Python** | `>=3.10.0, <3.13.0` | `3.11.9` | `x64` | CPython 64-bit with pre-built wheel compatibility |
| **Tesseract OCR** | `>=5.3.0, <6.0.0` | `5.4.1` | `x64` | Native binary with English and orientation traineddata |
| **Operating Systems** | Ubuntu 22.04 LTS / Debian 12 / Windows Server 2022 / Windows 11 | Ubuntu 22.04 / Win11 | `x64` | Tested against POSIX and Windows pathing |

---

## 2. Clean Target Installation Protocol

To guarantee that the target installation operates deterministically **without hidden caches, undeclared global packages, or developer machine ambient state**, operators and CI systems must execute the following clean install sequence:

### A. Node.js Gateway & Frontend Build
```bash
# 1. Clean previous build artifacts and caches
rm -rf node_modules dist .vite

# 2. Perform clean deterministic installation from package.json exact pins
npm ci

# 3. Verify type contracts and compile production bundle
npm run lint
npm run build
```

### B. Python OCR Worker Isolated Environment
```bash
# 1. Ensure clean directory without ambient virtual environment
rm -rf .venv

# 2. Provision isolated virtual environment
python3 -m venv .venv

# 3. Activate virtual environment
# POSIX:
source .venv/bin/activate
# Windows PowerShell:
# .\.venv\Scripts\Activate.ps1

# 4. Install pinned requirements ignoring local pip cache
pip install --no-cache-dir --upgrade pip setuptools wheel
pip install --no-cache-dir -r scripts/requirements.txt
```

### C. Native Tool Verification
The native Tesseract binary must be discoverable on system `PATH` or configured via `TESSERACT_PATH`:
```bash
tesseract --version
```

---

## 3. Third-Party License Screening Policy

The commercial license screening rules govern all dependencies directly integrated into production:

### Approved Commercial Licenses (Production Scope)
- **MIT**
- **Apache-2.0**
- **BSD-2-Clause / BSD-3-Clause**
- **ISC**
- **HPND (Historical Permission Notice and Disclaimer - Pillow)**

### Strictly Prohibited from Default Production Scope
- **AGPL-3.0 / GPL-3.0 / GPL-2.0**: Copyleft licenses that impose reciprocal source disclosure on commercial banking portals.
- **SSPL**: Non-OSI reciprocal licensing.
- **Non-Commercial Restrictions** (e.g., CC-BY-NC): Unusable in enterprise banking deployment.

### Screened / Conditional Engine Policy
- **PyMuPDF (`fitz`)**: Dual-licensed AGPL-3.0 or Commercial Artifex. In standard production distribution, `pypdfium2` (Apache-2.0) is the approved permissive engine. PyMuPDF is screened and disabled unless a commercial Artifex license key is configured.
- **Poppler (`pdfinfo`, `pdftoppm`)**: GPL-2.0. Must never be linked in-process. Allowed only as decoupled external process execution if configured, with `pypdfium2` serving as default in-process PDF rasterizer.
- **Surya OCR**: GPL-3.0. Screened strictly as an experimental research plugin; blocked from production binary builds.

---

## 4. New Engine Choice Verification Protocol

Per charter gate (*"new engine choices repeat these checks"*), whenever an additional OCR engine, layout parser, or language model is evaluated or introduced to the pipeline, the following 4-step checklist must be executed before promotion:

1. **License Screening Check**:
   - Inspect package source and upstream model weights license.
   - Verify compatibility against the Approved Commercial Licenses list.
   - If copyleft or dual-licensed, obtain formal commercial license or reject.

2. **Exact Version Pinning**:
   - Add exact version pin (`==X.Y.Z`) to `scripts/requirements.txt` or `package.json`.
   - Record entry in `docs/stage5/license-manifest.json` with ecosystem, license, and commercial authorization status.

3. **Clean Cache Independence**:
   - Install the candidate in an ephemeral sandbox with `--no-cache-dir`.
   - Verify that model weights do not silently auto-download from external cloud endpoints without configured offline cache or proxy paths.

4. **Resource & Failure Boundary Verification**:
   - Measure cold-start latency (must be < 10.0 seconds).
   - Measure VRAM / RAM peak footprint under 50-page PDF ingestion.
   - Validate graceful fallback when GPU acceleration is absent (CPU fallback).

---

## 5. Security & Dependency Update Policy

1. **Automated Audit Cadence**:
   - Every build runs `npm audit --production` and fails on High or Critical severity CVEs.
   - Python dependencies are audited via `pip-audit` or Dependabot security advisories.

2. **Patching Process**:
   - Updates must be committed with explicit semver pin revisions in `package.json` and `scripts/requirements.txt`.
   - `docs/stage5/license-manifest.json` must be regenerated and validated by `tests/stage5Dependencies.test.mjs`.
