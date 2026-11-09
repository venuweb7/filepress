// End-to-end tests: start the real server, push real files through every tool over HTTP,
// download the results and verify them with the PDF command-line tools.
// Run: npm test   (needs the same engines as the Dockerfile: gs, qpdf, poppler, soffice, ocrmypdf, img2pdf, pdf2docx, imagemagick)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(here, 'tmp');
const FIX = path.join(TMP, 'fixtures');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'test-code-1234';
let server, cookie = '';

const run = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const pdfinfo = f => run('pdfinfo', [f]);
const pages = f => parseInt(pdfinfo(f).match(/^Pages:\s+(\d+)/m)[1], 10);
const text = f => run('pdftotext', ['-layout', f, '-']);

async function makeFixtures() {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(FIX, { recursive: true });
  // A 3-page text PDF with a big embedded picture so compression has something to bite on.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  run('convert', ['-size', '1400x1000', 'plasma:fractal', '-quality', '98', path.join(FIX, 'noise.jpg')]);
  const img = await doc.embedJpg(await fs.readFile(path.join(FIX, 'noise.jpg')));
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Filepress fixture page ${i} of 3. The quick brown fox jumps over the lazy dog.`, { x: 40, y: 790, size: 14, font });
    p.drawImage(img, { x: 40, y: 300, width: 515, height: 368 });
  }
  await fs.writeFile(path.join(FIX, 'text.pdf'), await doc.save());
  // A picture-only "scanned" PDF: render page 1 to JPG and wrap it back into a PDF with no text layer.
  run('pdftoppm', ['-r', '150', '-f', '1', '-l', '1', '-jpeg', path.join(FIX, 'text.pdf'), path.join(FIX, 'scan')]);
  const scanJpg = (await fs.readdir(FIX)).find(f => f.startsWith('scan') && f.endsWith('.jpg'));
  await fs.rename(path.join(FIX, scanJpg), path.join(FIX, 'scan.jpg'));
  run('img2pdf', [path.join(FIX, 'scan.jpg'), '-o', path.join(FIX, 'scan.pdf')]);
  // A PNG with transparency (img2pdf needs it flattened first).
  run('convert', ['-size', '300x200', 'xc:none', '-fill', 'red', '-draw', 'circle 150,100 150,30', path.join(FIX, 'alpha.png')]);
  // A Word file: let LibreOffice turn a .txt into .docx.
  await fs.writeFile(path.join(FIX, 'memo.txt'), 'Filepress memo\n\nThis Word document was generated for the test suite.\n');
  run('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${path.join(TMP, 'lo')}`, '--convert-to', 'docx:MS Word 2007 XML', '--outdir', FIX, path.join(FIX, 'memo.txt')]);
  // Pictures in the other formats the picture tools take.
  run('convert', [path.join(FIX, 'noise.jpg'), '-resize', '50%', path.join(FIX, 'photo.webp')]);
  run('convert', [path.join(FIX, 'noise.jpg'), '-resize', '25%', path.join(FIX, 'anim.gif')]);
  // A junk file that claims to be a PDF.
  await fs.writeFile(path.join(FIX, 'fake.pdf'), 'this is not a pdf at all');
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(here, '..', 'src', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), JOBS_DIR: path.join(TMP, 'jobs'), RETENTION_MIN: '60', CONCURRENCY: '2', TRUST_PROXY: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', d => { out += d; if (/listening/.test(out)) resolve(p); });
    p.stderr.on('data', d => process.stderr.write(d));
    p.on('exit', c => reject(new Error(`server exited ${c}`)));
    setTimeout(() => reject(new Error('server did not start')), 10000).unref();
  });
}

async function api(method, url, body, extraHeaders = {}) {
  const r = await fetch(BASE + url, { method, body, headers: { cookie, ...extraHeaders }, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return r;
}
async function submit(tool, files, options = {}, extra = {}) {
  const fd = new FormData();
  fd.append('tool', tool); fd.append('options', JSON.stringify(options));
  for (const f of files) fd.append('files', new Blob([await fs.readFile(path.join(FIX, f))]), f);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return api('POST', '/api/jobs', fd);
}
async function waitDone(id, ms = 240_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const j = await (await api('GET', `/api/jobs/${id}`)).json();
    if (j.status === 'done' || j.status === 'error') return j;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('timed out waiting for job ' + id);
}
async function download(id, name) {
  const r = await api('GET', `/api/jobs/${id}/download`);
  assert.equal(r.status, 200, 'download status');
  const out = path.join(TMP, 'out', name);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, Buffer.from(await r.arrayBuffer()));
  return out;
}
async function runTool(tool, files, options, extra) {
  const r = await submit(tool, files, options, extra);
  assert.equal(r.status, 202, `submit ${tool}: ${await r.clone().text()}`);
  const { id } = await r.json();
  const j = await waitDone(id);
  assert.equal(j.status, 'done', `${tool} failed: ${j.error}`);
  const out = await download(id, j.result.name);
  return { job: j, out, id };
}

before(async () => { await makeFixtures(); server = await startServer({ ACCESS_CODE: CODE }); });
after(() => { server?.kill('SIGTERM'); });

test('locked by default, unlock with the code, wrong code refused', async () => {
  const s = await (await api('GET', '/api/session')).json();
  assert.equal(s.locked, true);
  assert.ok(Array.isArray(s.tools) && s.tools.length === 22);
  const bad = await api('POST', '/api/unlock', JSON.stringify({ code: 'nope' }), { 'content-type': 'application/json' });
  assert.equal(bad.status, 401);
  const locked = await submit('compress', ['text.pdf']);
  assert.equal(locked.status, 401);
  const ok = await api('POST', '/api/unlock', JSON.stringify({ code: CODE }), { 'content-type': 'application/json' });
  assert.equal(ok.status, 204);
  const s2 = await (await api('GET', '/api/session')).json();
  assert.equal(s2.locked, false);
});

test('security headers and static app', async () => {
  const r = await api('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await r.text(), /Drop a file/);
});

test('rejects a fake PDF, unknown tools and bad options', async () => {
  const fake = await submit('compress', ['fake.pdf']);
  assert.equal(fake.status, 400); assert.match((await fake.json()).error, /does not look like a real PDF/);
  const unk = await submit('nope', ['text.pdf']);
  assert.equal(unk.status, 400);
  const badOpt = await submit('split', ['text.pdf'], { mode: 'ranges', ranges: 'abc' });
  assert.equal(badOpt.status, 400); assert.match((await badOpt.json()).error, /pages you want/);
  const noFile = await submit('compress', []);
  assert.equal(noFile.status, 400);
  // an unknown choice is refused, never silently swapped for the default
  const badAngle = await submit('rotate', ['text.pdf'], { angle: '--version' });
  assert.equal(badAngle.status, 400); assert.match((await badAngle.json()).error, /not one of the choices/);
  const badLevel = await submit('compress', ['text.pdf'], { level: 'tiny' });
  assert.equal(badLevel.status, 400);
});

test('compress makes the PDF smaller and keeps the pages', async () => {
  const { job, out } = await runTool('compress', ['text.pdf'], { level: 'balanced' });
  const before = (await fs.stat(path.join(FIX, 'text.pdf'))).size;
  assert.ok(job.result.size < before, `expected smaller: ${job.result.size} < ${before}`);
  assert.equal(pages(out), 3);
  assert.match(text(out), /quick brown fox/);
});

test('merge joins files, divider adds blank pages', async () => {
  const a = await runTool('merge', ['text.pdf', 'scan.pdf'], { divider: false });
  assert.equal(pages(a.out), 4);
  const b = await runTool('merge', ['text.pdf', 'scan.pdf'], { divider: true });
  assert.equal(pages(b.out), 5);
  const one = await submit('merge', ['text.pdf']);
  const j = await waitDone((await one.json()).id);
  assert.equal(j.status, 'error'); assert.match(j.error, /at least 2/);
});

test('split: ranges, every page (zip), out-of-range error', async () => {
  const r = await runTool('split', ['text.pdf'], { mode: 'ranges', ranges: '1,3' });
  assert.equal(pages(r.out), 2);
  const e = await runTool('split', ['text.pdf'], { mode: 'each' });
  assert.equal(e.job.result.count, 3); assert.match(e.job.result.name, /\.zip$/);
  assert.equal((await fs.readFile(e.out)).subarray(0, 2).toString(), 'PK');
  const bad = await submit('split', ['text.pdf'], { mode: 'ranges', ranges: '9' });
  const j = await waitDone((await bad.json()).id);
  assert.equal(j.status, 'error'); assert.match(j.error, /3 pages/);
});

test('rotate, protect, page numbers, sign', async () => {
  const rot = await runTool('rotate', ['text.pdf'], { angle: '+90' });
  assert.match(pdfinfo(rot.out), /Page rot:\s+90/);
  const prot = await runTool('protect', ['text.pdf'], { password: 'secret99' });
  assert.throws(() => run('pdfinfo', [prot.out]), /password/i);           // locked without the password
  assert.throws(() => run('qpdf', ['--check', prot.out]), /password/i);
  assert.match(run('qpdf', ['--password=secret99', '--show-encryption', prot.out]), /R = 6|AES-256/i);
  assert.equal(parseInt(run('pdfinfo', ['-upw', 'secret99', prot.out]).match(/^Pages:\s+(\d+)/m)[1], 10), 3);
  const num = await runTool('numbers', ['text.pdf'], { pos: 'bc', format: 'Page n of N' });
  assert.match(text(num.out), /Page 2 of 3/);
  const sig = await runTool('sign', ['text.pdf'], { mode: 'text', text: 'N. Example', pages: 'last', pos: 'br' });
  assert.equal(pages(sig.out), 3);
  assert.match(text(sig.out), /N\. Example/);
  const png = run('convert', ['-size', '200x80', 'xc:none', '-fill', 'navy', '-draw', 'line 10,60 190,20', 'png:-'], undefined);
  const dataUrl = 'data:image/png;base64,' + execFileSync('convert', ['-size', '200x80', 'xc:none', '-fill', 'navy', '-draw', 'line 10,60 190,20', 'png:-']).toString('base64');
  const sig2 = await runTool('sign', ['text.pdf'], { mode: 'image', image: dataUrl, pages: 'all', pos: 'tl' });
  assert.equal(pages(sig2.out), 3);
  void png;
});

test('numbers land on rotated pages; single-part split is not zipped; bad N and non-Latin signature are refused', async () => {
  const rot = await runTool('rotate', ['text.pdf'], { angle: '+90' });
  const chained = await submit('numbers', [], { pos: 'bc', format: 'n/N' }, { from: rot.id });
  const j = await waitDone((await chained.json()).id);
  assert.equal(j.status, 'done');
  const out = await download(j.id, j.result.name);
  assert.match(pdfinfo(out), /Page rot:\s+90/);
  assert.match(text(out), /2\s*\/\s*3/);   // pdftotext -layout may drop the spaces
  const one = await runTool('split', ['scan.pdf'], { mode: 'each' });          // one page -> one PDF, no zip
  assert.match(one.job.result.name, /\.pdf$/); assert.equal(pages(one.out), 1);
  const badN = await submit('split', ['text.pdf'], { mode: 'every', every: '0' });
  assert.equal(badN.status, 400);
  const tel = await submit('sign', ['text.pdf'], { mode: 'text', text: 'నంద' });
  const tj = await waitDone((await tel.json()).id);
  assert.equal(tj.status, 'error'); assert.match(tj.error, /English letters/);
});

test('pictures: PDF -> JPG (zip) and JPG/PNG -> PDF', async () => {
  const j = await runTool('pdf-jpg', ['text.pdf'], { dpi: '100' });
  assert.equal(j.job.result.count, 3); assert.match(j.job.result.name, /\.zip$/);
  const p = await runTool('jpg-pdf', ['scan.jpg', 'alpha.png'], { pagesize: 'A4' });
  assert.equal(pages(p.out), 2);
});

test('Scan -> Text adds a searchable layer', { timeout: 300_000 }, async () => {
  assert.doesNotMatch(text(path.join(FIX, 'scan.pdf')), /quick brown fox/);
  const o = await runTool('ocr', ['scan.pdf'], { langs: ['eng'], deskew: false });
  assert.match(text(o.out), /quick brown fox/i);
});

test('Office -> PDF and PDF -> Word', { timeout: 300_000 }, async () => {
  const w = await runTool('word-pdf', ['memo.docx'], {});
  assert.equal(pages(w.out), 1); assert.match(text(w.out), /Filepress memo/);
  const d = await runTool('pdf-word', ['text.pdf'], {});
  assert.match(d.job.result.name, /\.docx$/);
  assert.equal((await fs.readFile(d.out)).subarray(0, 2).toString(), 'PK');
});

test('picture tools: compress, resize, crop, convert, rotate, upscale, watermark, meme, blur faces', { timeout: 300_000 }, async () => {
  const dims = f => run('identify', ['-format', '%w %h %m', f + '[0]']);
  const c = await runTool('img-compress', ['noise.jpg'], { level: 'smallest' });
  assert.ok((await fs.stat(c.out)).size < (await fs.stat(path.join(FIX, 'noise.jpg'))).size, 'compressed JPG is smaller');
  assert.match(c.job.result.name, /-compressed\.jpg$/);
  const batch = await runTool('img-compress', ['noise.jpg', 'alpha.png'], { level: 'balanced' });
  assert.equal(batch.job.result.count, 2); assert.match(batch.job.result.name, /\.zip$/);
  const r = await runTool('img-resize', ['noise.jpg'], { mode: 'pixels', width: 300, height: 300 });
  assert.equal(dims(r.out), '300 214 JPEG');
  const r2 = await runTool('img-resize', ['noise.jpg'], { mode: 'percent', percent: 50 });
  assert.equal(dims(r2.out), '700 500 JPEG');
  const cr = await runTool('img-crop', ['noise.jpg'], { mode: 'ratio', ratio: 'square', from: 'left' });
  assert.equal(dims(cr.out), '1000 1000 JPEG');
  const tj = await runTool('to-jpg', ['photo.webp'], { quality: '90' });
  assert.equal(dims(tj.out), '700 500 JPEG'); assert.equal(tj.job.result.name, 'photo.jpg');
  const tj2 = await runTool('to-jpg', ['alpha.png'], {});
  assert.equal(dims(tj2.out), '300 200 JPEG');
  const fj = await runTool('from-jpg', ['noise.jpg'], { format: 'webp' });
  assert.equal(dims(fj.out), '1400 1000 WEBP');
  const ro = await runTool('img-rotate', ['noise.jpg'], { turn: '90' });
  assert.equal(dims(ro.out), '1000 1400 JPEG');
  const up = await runTool('upscale', ['anim.gif'], { factor: '2' });
  assert.equal(dims(up.out), '700 500 GIF');
  const wm = await runTool('watermark', ['noise.jpg'], { text: '© test 100% @home', pos: 'br', opacity: 'strong', size: 'large' });
  assert.match(wm.job.result.name, /-watermarked\.jpg$/); assert.ok((await fs.stat(wm.out)).size > 1000);
  const mm = await runTool('meme', ['noise.jpg'], { top: 'when the test', bottom: 'passes first time' });
  assert.equal(dims(mm.out), '1400 1000 JPEG');
  const bl = await runTool('blur', ['noise.jpg'], { strength: 'normal' });
  assert.match(bl.job.result.note, /No faces/); assert.equal(dims(bl.out), '1400 1000 JPEG');
  // refusals: bad numbers, empty text, a picture tool given a PDF, a 4x upscale that would be too big
  const badW = await submit('img-resize', ['noise.jpg'], { mode: 'pixels', width: 'abc', height: 10 });
  assert.equal(badW.status, 400); assert.match((await badW.json()).error, /Width must be/);
  const noText = await submit('watermark', ['noise.jpg'], { text: '   ' });
  assert.equal(noText.status, 400);
  const wrongKind = await submit('img-compress', ['text.pdf'], {});
  assert.equal(wrongKind.status, 202); assert.equal((await waitDone((await wrongKind.json()).id)).status, 'error');
  const huge = await submit('upscale', ['noise.jpg'], { factor: '4' });   // 1400x1000 x16 = 22 MP, allowed; check it runs
  assert.equal(huge.status, 202); assert.equal((await waitDone((await huge.json()).id)).status, 'done');
});

test('a PDF tool given a Word file turns it into a PDF first', { timeout: 300_000 }, async () => {
  const j = await runTool('compress', ['memo.docx'], { level: 'balanced' });
  assert.match(j.job.result.name, /memo-compressed\.pdf$/);
  assert.equal(pages(j.out), 1); assert.match(text(j.out), /Filepress memo/);
  // but Office -> PDF itself, and a picture tool, do not get this treatment
  const pic = await submit('img-compress', ['memo.docx'], {});
  assert.equal((await waitDone((await pic.json()).id)).status, 'error');
});

test('chaining feeds a result into the next tool; delete wipes it; other sessions cannot see it', async () => {
  const first = await runTool('rotate', ['text.pdf'], { angle: '+90' });
  const chained = await submit('compress', [], { level: 'smallest' }, { from: first.id });
  assert.equal(chained.status, 202);
  const j = await waitDone((await chained.json()).id);
  assert.equal(j.status, 'done'); assert.match(j.result.name, /-rotated-compressed\.pdf$/);
  // a different browser (no cookie) must not see the job
  const stranger = await fetch(`${BASE}/api/jobs/${j.id}`);
  assert.equal(stranger.status, 401);
  const del = await api('DELETE', `/api/jobs/${j.id}`);
  assert.equal(del.status, 204);
  const gone = await api('GET', `/api/jobs/${j.id}`);
  assert.equal(gone.status, 404);
  await assert.rejects(fs.access(path.join(TMP, 'jobs', j.id)));
});
