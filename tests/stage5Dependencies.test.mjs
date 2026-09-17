/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve('.');

const APPROVED_PERMISSIVE_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'HPND',
]);

const PROHIBITED_PRODUCTION_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'SSPL',
  'CC-BY-NC-4.0',
]);

export function validateNodePackageJson(pkgContent) {
  const pkg = typeof pkgContent === 'string' ? JSON.parse(pkgContent) : pkgContent;
  const errors = [];

  if (!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) {
    errors.push('package.json must contain production dependencies');
  }

  // Verify all production dependencies are strictly pinned to exact semver
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    if (/[\^~><*]/.test(version) || !/^\d+\.\d+\.\d+/.test(version)) {
      errors.push(`Dependency "${name}" is not pinned to exact semver: "${version}"`);
    }
  }

  // Verify engines declaration
  if (!pkg.engines || !pkg.engines.node) {
    errors.push('package.json must declare engines.node');
  }

  if (errors.length > 0) {
    throw new Error(`Node package validation failed:\n - ${errors.join('\n - ')}`);
  }

  return true;
}

export function parsePythonRequirements(reqText) {
  const lines = reqText.split('\n');
  const packages = [];
  const errors = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx].trim();
    if (!rawLine || rawLine.startsWith('#')) {
      continue;
    }

    // Check if line contains exact version pinning ==
    const match = rawLine.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.-]+)$/);
    if (!match) {
      errors.push(`Line ${idx + 1}: Package specification "${rawLine}" must use exact pinning (==X.Y.Z)`);
    } else {
      packages.push({ name: match[1], version: match[2] });
    }
  }

  if (errors.length > 0) {
    throw new Error(`Python requirements validation failed:\n - ${errors.join('\n - ')}`);
  }

  return packages;
}

export function validateLicenseManifest(manifestData) {
  const manifest = typeof manifestData === 'string' ? JSON.parse(manifestData) : manifestData;
  const errors = [];

  if (!manifest.manifestVersion) {
    errors.push('Missing manifestVersion');
  }

  const prodNodeDeps = manifest.nodeRuntime?.dependencies || [];
  if (prodNodeDeps.length === 0) {
    errors.push('nodeRuntime.dependencies must not be empty');
  }

  for (const dep of prodNodeDeps) {
    if (!APPROVED_PERMISSIVE_LICENSES.has(dep.license)) {
      errors.push(`Node dependency "${dep.name}" has unapproved license: "${dep.license}"`);
    }
    if (dep.commercialUseAllowed !== true) {
      errors.push(`Node dependency "${dep.name}" must have commercialUseAllowed: true`);
    }
    if (dep.copyleft === true) {
      errors.push(`Node dependency "${dep.name}" has copyleft: true in production scope`);
    }
  }

  const prodPythonDeps = manifest.pythonRuntime?.productionDependencies || [];
  if (prodPythonDeps.length === 0) {
    errors.push('pythonRuntime.productionDependencies must not be empty');
  }

  for (const dep of prodPythonDeps) {
    if (!APPROVED_PERMISSIVE_LICENSES.has(dep.license)) {
      errors.push(`Python production dependency "${dep.name}" has unapproved license: "${dep.license}"`);
    }
    if (dep.commercialUseAllowed !== true) {
      errors.push(`Python production dependency "${dep.name}" must have commercialUseAllowed: true`);
    }
    if (dep.copyleft === true) {
      errors.push(`Python production dependency "${dep.name}" has copyleft: true in production scope`);
    }
  }

  // Verify that screened research dependencies are properly flagged
  const screenedDeps = manifest.pythonRuntime?.screenedResearchDependencies || [];
  for (const dep of screenedDeps) {
    if (PROHIBITED_PRODUCTION_LICENSES.has(dep.license)) {
      if (dep.commercialUseAllowed === true) {
        errors.push(`Screened dependency "${dep.name}" has copyleft license "${dep.license}" but commercialUseAllowed: true`);
      }
      if (dep.copyleft !== true) {
        errors.push(`Screened dependency "${dep.name}" has copyleft license "${dep.license}" but copyleft is not true`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`License manifest validation failed:\n - ${errors.join('\n - ')}`);
  }

  return true;
}

describe('Stage 5 — Reproducible Dependencies & License Screening', () => {
  it('Fact 1: Python dependencies are pinned with exact versions in scripts/requirements.txt', () => {
    const reqPath = path.join(REPO_ROOT, 'scripts', 'requirements.txt');
    assert.ok(fs.existsSync(reqPath), 'scripts/requirements.txt must exist');

    const content = fs.readFileSync(reqPath, 'utf8');
    const packages = parsePythonRequirements(content);

    assert.ok(packages.length >= 10, 'Must declare at least 10 core Python packages');

    const pkgMap = new Map(packages.map((p) => [p.name.toLowerCase(), p.version]));
    const required = [
      'opencv-python-headless',
      'pillow',
      'pypdfium2',
      'numpy',
      'pandas',
      'duckdb',
      'pytesseract',
      'spacy',
      'easyocr',
      'python-docx',
      'striprtf',
      'requests',
      'paddlepaddle',
    ];

    for (const r of required) {
      assert.ok(pkgMap.has(r), `Core package "${r}" must be pinned in requirements.txt`);
      assert.match(pkgMap.get(r), /^\d+\.\d+/, `Package "${r}" must have valid semver pin`);
    }

    for (const removed of ['gdown', 'pymupdf']) {
      assert.equal(pkgMap.has(removed), false, `Removed dependency "${removed}" must not be installed by default`);
    }

    // torch is deliberately absent from the pinned requirements: pinning it here
    // without an --index-url overwrites dgx_setup.sh's architecture-specific CUDA
    // install (cu124 on aarch64 / cu121 on x86_64) with a CPU-only wheel. Guard the
    // *decision*, not just its absence, so a careless re-pin here doesn't silently
    // break GPU OCR — and confirm dgx_setup.sh still actually installs it correctly.
    assert.equal(pkgMap.has('torch'), false, 'torch must not be pinned in requirements.txt (breaks the DGX CUDA install — see dgx_setup.sh Phase 5)');
    assert.match(content, /torch is intentionally NOT pinned here/, 'requirements.txt must document why torch is absent, not silently omit it');

    const setupPath = path.join(REPO_ROOT, 'scripts', 'dgx_setup.sh');
    assert.ok(fs.existsSync(setupPath), 'scripts/dgx_setup.sh must exist');
    const setupContent = fs.readFileSync(setupPath, 'utf8');
    assert.match(setupContent, /torch torchvision[\s\S]*?--index-url https:\/\/download\.pytorch\.org\/whl\/cu124/, 'dgx_setup.sh must install the CUDA 12.4 torch build for aarch64 (Grace Blackwell)');
    assert.match(setupContent, /torch torchvision --index-url https:\/\/download\.pytorch\.org\/whl\/cu121/, 'dgx_setup.sh must install the CUDA 12.1 torch build for x86_64');

    // Verify scripts/pyproject.toml also exists
    const pyprojectPath = path.join(REPO_ROOT, 'scripts', 'pyproject.toml');
    assert.ok(fs.existsSync(pyprojectPath), 'scripts/pyproject.toml must exist');
    const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf8');
    assert.ok(pyprojectContent.includes('requires-python = ">=3.10'), 'pyproject.toml must specify requires-python');
    assert.equal(/^torch==/m.test(pyprojectContent), false, 'torch must not be pinned in pyproject.toml either, for the same reason as requirements.txt');
  });

  it('Fact 2: Production Node dependencies are strictly locked to exact versions without loose ranges', () => {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json must exist');

    const content = fs.readFileSync(pkgPath, 'utf8');
    assert.doesNotThrow(() => validateNodePackageJson(content));

    const pkg = JSON.parse(content);
    // Ensure critical production packages exist and have zero loose symbols
    const criticalDeps = ['express', 'react', 'react-dom', 'dotenv', 'better-sqlite3', 'jsonwebtoken', 'multer', 'pdf-parse'];
    for (const dep of criticalDeps) {
      const version = pkg.dependencies[dep];
      assert.ok(version, `Critical dependency "${dep}" must be present`);
      assert.strictEqual(/^[\d.]+$/.test(version), true, `Dependency "${dep}" must be exact semver (was "${version}")`);
    }
  });

  it('Fact 3: Third-party dependency license audit confirms zero copyleft in production scope', () => {
    const manifestPath = path.join(REPO_ROOT, 'docs', 'stage5', 'license-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'docs/stage5/license-manifest.json must exist');

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    assert.doesNotThrow(() => validateLicenseManifest(manifest));

    // Assert zero copyleft count in production
    assert.strictEqual(
      manifest.licenseSummary.copyleftCountInProduction,
      0,
      'Production scope must have 0 copyleft dependencies'
    );
    assert.ok(
      manifest.licenseSummary.commercialPermissiveCount >= 20,
      'Must audit at least 20 commercial permissive packages'
    );
  });

  it('Fact 4: Installation & update policy specifies clean target setup without hidden caches and checks new engines', () => {
    const policyPath = path.join(REPO_ROOT, 'docs', 'stage5', 'dependency-policy.md');
    assert.ok(fs.existsSync(policyPath), 'docs/stage5/dependency-policy.md must exist');

    const content = fs.readFileSync(policyPath, 'utf8');
    assert.ok(content.includes('Clean Target Installation Protocol'), 'Must document clean target installation protocol');
    assert.ok(content.includes('--no-cache-dir'), 'Python install instructions must use --no-cache-dir');
    assert.ok(content.includes('npm ci'), 'Node install instructions must use npm ci');
    assert.ok(
      content.includes('New Engine Choice Verification Protocol'),
      'Must document protocol for repeating checks on new engine choices'
    );
  });
});

describe('Stage 5 — Negative Mutation Tests (Proof that Guards Bite)', () => {
  it('unpinned loose version (caret) in package.json dependencies throws validation error', () => {
    const badPkg = {
      dependencies: {
        express: '^5.2.1',
      },
      engines: { node: '>=20.0.0' },
    };

    assert.throws(
      () => validateNodePackageJson(badPkg),
      /Dependency "express" is not pinned to exact semver/
    );
  });

  it('unpinned loose version (tilde) in package.json dependencies throws validation error', () => {
    const badPkg = {
      dependencies: {
        react: '~19.3.0',
      },
      engines: { node: '>=20.0.0' },
    };

    assert.throws(
      () => validateNodePackageJson(badPkg),
      /Dependency "react" is not pinned to exact semver/
    );
  });

  it('unpinned package in Python requirements throws validation error', () => {
    const badReq = 'numpy\npandas==2.2.3\n';
    assert.throws(
      () => parsePythonRequirements(badReq),
      /Package specification "numpy" must use exact pinning/
    );
  });

  it('greater-than-or-equal package version in Python requirements throws validation error', () => {
    const badReq = 'torch>=2.4.0\npandas==2.2.3\n';
    assert.throws(
      () => parsePythonRequirements(badReq),
      /Package specification "torch>=2.4.0" must use exact pinning/
    );
  });

  it('introducing copyleft (AGPL-3.0) into production scope throws license violation', () => {
    const badManifest = {
      manifestVersion: '1.0.0',
      nodeRuntime: {
        dependencies: [
          {
            name: 'bad-package',
            version: '1.0.0',
            license: 'AGPL-3.0',
            commercialUseAllowed: true,
            copyleft: true,
          },
        ],
      },
      pythonRuntime: {
        productionDependencies: [
          {
            name: 'numpy',
            version: '2.1.1',
            license: 'BSD-3-Clause',
            commercialUseAllowed: true,
            copyleft: false,
          },
        ],
      },
    };

    assert.throws(
      () => validateLicenseManifest(badManifest),
      /Node dependency "bad-package" has unapproved license: "AGPL-3.0"/
    );
  });

  it('unapproved unknown license throws license manifest error', () => {
    const badManifest = {
      manifestVersion: '1.0.0',
      nodeRuntime: {
        dependencies: [
          {
            name: 'unknown-lib',
            version: '1.0.0',
            license: 'Custom-Commercial-Proprietary-v2',
            commercialUseAllowed: false,
            copyleft: false,
          },
        ],
      },
      pythonRuntime: {
        productionDependencies: [
          {
            name: 'numpy',
            version: '2.1.1',
            license: 'BSD-3-Clause',
            commercialUseAllowed: true,
            copyleft: false,
          },
        ],
      },
    };

    assert.throws(
      () => validateLicenseManifest(badManifest),
      /Node dependency "unknown-lib" has unapproved license/
    );
  });
});
