/**
 * Tests for the batch-import (`ocr.local`) server flow.
 *
 * Mirrors the jobLease bootstrap: esbuild-bundle server.ts -> server.mjs,
 * set env BEFORE loadServer, exercise via http.createServer(app).
 *
 * Covers: staged->parsed->enqueue (folder mode), fail-closed auth, and the
 * upload.ts:uploadFilter single source of truth (rejects .doc office-binary).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, "..");
const tempDir = path.join(project, "node_modules", ".cache", "import-tests");

// 1x1 valid PNG (accepted by uploadFilter)
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

async function loadServer(queuedDir, parsedDir, srcDir) {
  const fakeScript = path.join(tempDir, "fake-prep.cjs");
  // fake pre-parse: writes a marker inside TARGET_DIR ($1) and exits 0
  fs.writeFileSync(
    fakeScript,
    `const fs=require('fs');const d=process.argv[2];fs.mkdirSync(d,{recursive:true});fs.writeFileSync(d+'/.touched','preparse-ok');process.exit(0);`,
  );

  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = path.join(tempDir, "app.db");
  process.env.STORAGE_ROOT = path.join(tempDir, "storage");
  process.env.OCRDOCS_IMPORT_ENABLED = "true";
  process.env.OCRDOCS_IMPORT_TOKEN = "import-test-token";
  process.env.OCRDOCS_QUEUED_DIR = queuedDir;
  process.env.OCRDOCS_PARSED_DIR = parsedDir;
  process.env.OCRDOCS_PREPARSE_SCRIPT = fakeScript;
  process.env.OCRDOCS_PREPARSE_SHELL = "node"; // deterministic across OS

  const outfile = path.join(tempDir, "server.mjs");
  await esbuild.build({
    entryPoints: [path.join(project, "server.ts")],
    bundle: true,
    write: true,
    outfile,
    format: "esm",
    platform: "node",
    packages: "external",
  });
  return import(pathToFileURL(outfile).href);
}

test("ocr.local batch import: stage -> pre-parse -> parsed -> jobs", async (t) => {
  const queuedDir = path.join(tempDir, "queued");
  const parsedDir = path.join(tempDir, "parsed");
  const srcDir = path.join(tempDir, "src");
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  // accepted + rejected mix (mirrors recovered_c style: image, docx, office-binary .doc)
  fs.writeFileSync(path.join(srcDir, "receipt.png"), PNG_BYTES);
  fs.writeFileSync(path.join(srcDir, "notes.docx"), Buffer.from("<w/>"));
  fs.writeFileSync(path.join(srcDir, "evil.doc"), Buffer.from("x"));

  let server;
  let serverModule;
  let baseUrl;
  const auth = { Authorization: "Bearer import-test-token" };

  t.before(async () => {
    serverModule = await loadServer(queuedDir, parsedDir, srcDir);
    server = http.createServer(serverModule.app);
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    server?.close();
    serverModule?.closeDb?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test("stages accepted files from a folder, skips .doc (uploadFilter)", async () => {
    const res = await fetch(`${baseUrl}/api/imports`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ source: "folder", path: srcDir }),
    });
    const bodyText = await res.text();
    assert.equal(res.status, 202, `expected 202, got ${res.status}: ${bodyText}`);
    const manifest = JSON.parse(bodyText);
    assert.ok(manifest.stagedDir.startsWith(queuedDir));
    assert.equal(manifest.status, "staged");
    // 2 accepted (png + docx), 1 rejected (.doc)
    assert.equal(manifest.files.length, 2);
  });

  await t.test("rejects with 503 when disabled", async () => {
    const prev = process.env.OCRDOCS_IMPORT_ENABLED;
    process.env.OCRDOCS_IMPORT_ENABLED = "false";
    try {
      const res = await fetch(`${baseUrl}/api/imports`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ source: "folder", path: srcDir }),
      });
      assert.equal(res.status, 503);
    } finally {
      process.env.OCRDOCS_IMPORT_ENABLED = prev;
    }
  });

  await t.test("rejects bad bearer token with 401", async () => {
    const res = await fetch(`${baseUrl}/api/imports`, {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
      body: JSON.stringify({ source: "folder", path: srcDir }),
    });
    assert.equal(res.status, 401);
  });

  await t.test("rejects office-binary .doc upload via uploadFilter (400)", async () => {
    const boundary = "----importTestBoundary";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="evil.doc"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\nx\r\n` +
      `--${boundary}--\r\n`;
    const res = await fetch(`${baseUrl}/api/imports`, {
      method: "POST",
      headers: { ...auth, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /unsupported/iu);
  });

  await t.test("run pre-parse -> parsed -> enqueue jobs + marker relocated", async () => {
    // stage fresh (prior tests only staged/ran auth)
    const staged = await fetch(`${baseUrl}/api/imports`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ source: "folder", path: srcDir }),
    }).then((r) => r.json());
    assert.equal(staged.status, "staged");

    const run = await fetch(`${baseUrl}/api/imports/${staged.importId}/run`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(run.status, 200);
    const result = await run.json();
    assert.equal(result.status, "parsed");
    assert.ok(result.jobIds.length >= 1, "at least one OCR job enqueued");
    assert.ok(result.parsedDir.startsWith(parsedDir));
    // pre-parse marker (.touched) is relocated with the dir into parsed/<ts>/
    const entries = fs.readdirSync(result.parsedDir);
    assert.ok(entries.includes(".touched"), `parsed dir missing .touched marker: ${entries.join(", ")}`);

    // registry reflects parsed + jobIds
    const rec = await fetch(`${baseUrl}/api/imports/${staged.importId}`, { headers: auth }).then((r) => r.json());
    assert.equal(rec.status, "parsed");
    assert.deepEqual(rec.jobIds, result.jobIds);
  });

  await t.test("GET /api/imports lists recent imports", async () => {
    const res = await fetch(`${baseUrl}/api/imports`, { headers: auth });
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list.imports));
    assert.ok(list.imports.length >= 1);
  });
});

test("queue drain: stageQueuedRoot moves loose files (archives too), skips fresh/hidden/staged; ids validated", async () => {
  const dir = path.join(tempDir, "drain");
  fs.rmSync(dir, { recursive: true, force: true });
  const queued = path.join(dir, "queued");
  fs.mkdirSync(path.join(queued, "sub"), { recursive: true });
  fs.mkdirSync(path.join(queued, "abc123-xyz789"), { recursive: true });
  fs.writeFileSync(path.join(queued, "a.pdf"), "x");
  fs.writeFileSync(path.join(queued, "b.zip"), "x");
  fs.writeFileSync(path.join(queued, "sub", "c.png"), "x");
  const old = new Date(Date.now() - 60_000);
  for (const p of ["a.pdf", "b.zip", "sub"]) fs.utimesSync(path.join(queued, p), old, old);
  fs.writeFileSync(path.join(queued, "fresh.pdf"), "x");

  const out = path.join(dir, "svc.mjs");
  await esbuild.build({
    entryPoints: [path.join(project, "server/services/importService.ts")],
    bundle: true, outfile: out, format: "esm", platform: "node", packages: "external",
  });
  const { createImportService } = await import(pathToFileURL(out).href);
  const svc = createImportService({
    documentRepo: {}, jobRepo: {}, queuedDir: queued, parsedDir: path.join(dir, "parsed"),
    preparseScript: "x", preparseShell: "node", maxFiles: 10, maxTotalMb: 10,
  });
  const id = svc.stageQueuedRoot();
  assert.ok(id);
  const staged = fs.readdirSync(path.join(queued, id)).sort();
  assert.deepEqual(staged.map((n) => n.replace(/^\d+_/, "")), ["a.pdf", "b.zip", "sub"]);
  assert.ok(fs.existsSync(path.join(queued, "fresh.pdf")));
  assert.ok(fs.existsSync(path.join(queued, "abc123-xyz789")));
  assert.equal(svc.stageQueuedRoot(), null);
  assert.throws(() => svc.getRecord("../../etc/passwd"), /invalid import id/);
});
