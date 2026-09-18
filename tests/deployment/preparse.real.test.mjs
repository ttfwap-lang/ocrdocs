/**
 * Real-shell test of scripts/pre-parse.sh: nested folders, exact duplicates, tiny files, junk names/executables,
 * and nested archives (zip, tar.gz, zip-in-zip). Skips where bash, `file` or `7z` are unavailable (e.g. Windows CI).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(project, 'scripts', 'pre-parse.sh');
const has = (c) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const runnable = process.platform !== 'win32' && has('bash') && has('file') && (has('7z') || has('7zz')) && has('python3');

// Minimal valid PNG (random pixels so each seed is unique content, > 2 KB, stored uncompressed).
function png(seed) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(60, 0); ihdr.writeUInt32BE(60, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < 60; y++) rows.push(Buffer.from([0]), Buffer.alloc(180, (seed * 37 + y) & 0xff));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

test('pre-parse.sh: flatten, dedupe, purge junk, extract nested archives', { skip: !runnable && 'needs bash+file+7z+python3 on POSIX' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preparse-'));
  const dir = path.join(root, 'in');
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  const w = (rel, data) => fs.writeFileSync(path.join(dir, rel), data);
  w('a.png', png(1)); w('sub/dup_of_a.png', png(1)); w('sub/deep/b.png', png(2));
  w('tiny.txt', 'x'.repeat(100)); w('Thumbs.db', Buffer.alloc(5000, 7));
  // archives built with python (zipfile/tarfile), so the test needs no zip/tar CLI
  const cPng = png(3);
  fs.writeFileSync(path.join(root, 'c.png'), cPng);
  spawnSync('python3', ['-c', `
import zipfile,tarfile,io,sys
d,c=sys.argv[1],sys.argv[2]
cp=open(c,'rb').read()
z=zipfile.ZipFile(d+'/bundle.zip','w'); z.writestr('inner/c.png',cp); z.close()
t=tarfile.open(d+'/arch.tar.gz','w:gz'); i=tarfile.TarInfo('d/e.png'); e=cp; i.size=len(e); t.addfile(i,io.BytesIO(e)); t.close()
inner=io.BytesIO(); zi=zipfile.ZipFile(inner,'w'); zi.writestr('f.png',open(c,'rb').read()); zi.close()
z2=zipfile.ZipFile(d+'/outer.zip','w'); z2.writestr('inner.zip',inner.getvalue()); z2.close()
`, dir, path.join(root, 'c.png')], { encoding: 'utf8' });

  const r = spawnSync('bash', [script, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const left = fs.readdirSync(dir);
  assert.ok(!left.some((n) => /\.(zip|tar|gz)$/.test(n)), `archives left over: ${left}`);
  assert.ok(!left.includes('Thumbs.db') && !left.includes('tiny.txt'), 'junk/tiny files purged');
  // unique images: a (+ its duplicate), b, and c (identical copy in a zip, a tar.gz and a zip-in-zip) => 3
  assert.equal(left.filter((n) => n.startsWith('png_')).length, 3, `unique PNGs after dedupe: ${left}`);
  fs.rmSync(root, { recursive: true, force: true });
});
