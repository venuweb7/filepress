// HTTP server: static app + a small JSON API for jobs. See docs/DESIGN.md for the flow.
import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, validateConfig } from './config.js';
import { tools, toolSummary } from './tools/index.js';
import { initJobs, createJob, getJob, enqueue, deleteJob, isJobId, jobDir, newJobId, makeJobDir, dropPending, publicView, queueStats, isBusy } from './jobs.js';
import { KINDS, extOf, safeName } from './tools/common.js';
import { ToolError } from './run.js';

const problems = validateConfig();
if (problems.length) { for (const p of problems) console.error('Config error:', p); process.exit(1); }
// Converters run as another user: everything we create must be writable by the shared group.
if (config.workerUser) process.umask(0o007);

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

class ClientError extends Error { constructor(status, message) { super(message); this.status = status; } }
const gone = `This job does not exist any more. Results are wiped after ${config.retentionMin} minutes.`;

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

/* ---------- sessions: a signed, httpOnly cookie identifies the browser and remembers the unlock ---------- */
const secret = config.sessionSecret || crypto.randomBytes(32).toString('hex');
// The access code takes part in the signature, so changing the code logs everyone out.
const codeTag = crypto.createHash('sha256').update('code:' + config.accessCode).digest('base64url').slice(0, 16);
const sign = s => crypto.createHmac('sha256', secret).update(s + '|' + codeTag).digest('base64url');
const COOKIE = 'ps';
const safeEqual = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
function readCookie(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [sid, flag, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!sid || !flag || !mac || !/^[a-f0-9]{32}$/.test(sid) || !/^[01]$/.test(flag)) return null;
  if (!safeEqual(mac, sign(sid + flag))) return null;
  return { sid, unlocked: flag === '1' };
}
function writeCookie(req, res, sid, unlocked) {
  const flag = unlocked ? '1' : '0';
  const attrs = [`${COOKIE}=${sid}.${flag}.${sign(sid + flag)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${30 * 86400}`];
  if (req.secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; ')); // one cookie per response; a later write replaces an earlier one
}
app.use((req, res, next) => {
  let s = readCookie(req);
  if (!s) { s = { sid: crypto.randomBytes(16).toString('hex'), unlocked: false }; writeCookie(req, res, s.sid, false); }
  req.sid = s.sid;
  req.unlocked = !config.accessCode || s.unlocked;
  next();
});
const requireUnlocked = (req, res, next) => (req.unlocked ? next() : res.status(401).json({ error: 'locked' }));

/* ---------- static app ---------- */
app.use(express.static(config.publicDir, {
  index: 'index.html', etag: true,
  setHeaders: (res, file) => res.set('Cache-Control', /\.(html)$/.test(file) ? 'no-cache' : /\/fonts\//.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
}));

// pdf.js for first-page previews. They are rendered in the browser; nothing is uploaded for that.
app.use('/vendor/pdfjs', express.static(path.join(config.publicDir, '..', 'node_modules', 'pdfjs-dist'), { immutable: true, maxAge: '30d', index: false }));

/* ---------- small JSON endpoints ---------- */
const limits = { maxFileMb: config.maxFileMb, maxFiles: config.maxFiles, maxRequestMb: config.maxRequestMb, retentionMin: config.retentionMin };
app.get('/healthz', (req, res) => res.json({ ok: true, ...queueStats() }));
app.get('/api/session', (req, res) => res.json({ locked: !req.unlocked, appName: config.appName, limits, tools: toolSummary }));

const rl = (limit, message, keyGenerator) => rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message }, ...(keyGenerator ? { keyGenerator } : {}) });
const unlockPerIp = rl(10, 'Too many tries. Wait a few minutes.');
const unlockGlobal = rl(100, 'Too many wrong codes from everywhere. Unlocking is paused for a while.', () => 'all');
app.post('/api/unlock', unlockPerIp, unlockGlobal, express.json({ limit: '2kb' }), (req, res) => {
  if (!config.accessCode) return res.status(204).end();
  const given = String(req.body?.code || '');
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(config.accessCode).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'That code is not right.' });
  // Fresh session id on unlock (no fixation), flagged as unlocked.
  writeCookie(req, res, crypto.randomBytes(16).toString('hex'), true);
  res.status(204).end();
});

/* ---------- uploads ---------- */
const kindOfExt = ext => Object.keys(KINDS).find(k => KINDS[k].exts.includes(ext)) || null;
const isZip = b => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOle = b => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
const isHeif = b => b.subarray(4, 8).toString('latin1') === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(b.subarray(8, 12).toString('latin1'));
const MAGIC = {
  pdf: b => b.subarray(0, 5).toString('latin1') === '%PDF-',
  jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  gif: b => b.subarray(0, 4).toString('latin1') === 'GIF8',
  webp: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  bmp: b => b[0] === 0x42 && b[1] === 0x4d,
  tif: b => ['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1')), tiff: b => ['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1')),
  heic: b => isHeif(b), heif: b => isHeif(b),
  docx: isZip, xlsx: isZip, pptx: isZip, odt: isZip, ods: isZip, odp: isZip,
  doc: isOle, xls: isOle, ppt: isOle,
  rtf: b => b.subarray(0, 5).toString('latin1') === '{\\rtf',
  txt: b => !b.subarray(0, 8).includes(0),   // plain text has no NUL bytes
};
async function sniff(file) {
  const fh = await fs.open(file, 'r');
  try { const b = Buffer.alloc(16); const { bytesRead } = await fh.read(b, 0, 16, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(jobDir(req.pendingId), 'in')),
    filename: (req, file, cb) => { req.fileIndex = (req.fileIndex || 0) + 1; cb(null, `${String(req.fileIndex).padStart(3, '0')}-${safeName(file.originalname)}`); },
  }),
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: config.maxFiles, fields: 10, fieldSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (kindOfExt(extOf(file.originalname)) ? cb(null, true) : cb(new ClientError(400, `"${safeName(file.originalname)}" is not a file type this app handles.`))),
});
const multerMessage = e => e.code === 'LIMIT_FILE_SIZE' ? `Each file can be at most ${config.maxFileMb} MB.` : e.code === 'LIMIT_FILE_COUNT' ? `Up to ${config.maxFiles} files at once.` : e.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected upload field.' : 'The upload could not be read.';

const jobsLimiter = rl(60, 'Too many jobs in a short time. Please wait a little.');

app.post('/api/jobs', requireUnlocked, jobsLimiter, async (req, res, next) => {
  const declared = parseInt(req.headers['content-length'] || '0', 10);
  if (declared > config.maxRequestMb * 1024 * 1024) return res.status(413).json({ error: `One upload can be at most ${config.maxRequestMb} MB in total.` });
  if (isBusy()) return res.status(503).json({ error: 'The server is busy right now. Try again in a minute.' });
  req.pendingId = newJobId();
  try { await makeJobDir(req.pendingId); } catch (e) { return next(e); }
  upload.array('files', config.maxFiles)(req, res, async err => {
    const fail = async (status, message) => { await dropPending(req.pendingId); res.status(status).json({ error: message }); };
    if (err) return fail(err instanceof ClientError ? err.status : 400, err instanceof ClientError ? err.message : err instanceof multer.MulterError ? multerMessage(err) : 'The upload could not be read.');
    try {
      const toolId = String(req.body.tool || '');
      if (!tools[toolId]) return fail(400, 'Unknown tool.');
      let options = {};
      if (req.body.options) { try { options = JSON.parse(req.body.options); } catch { return fail(400, 'Bad options.'); } }
      if (!options || typeof options !== 'object' || Array.isArray(options)) return fail(400, 'Bad options.');
      const files = [];
      for (const f of req.files || []) {
        const ext = extOf(f.originalname), kind = kindOfExt(ext);
        const head = await sniff(f.path);
        if (!MAGIC[ext] || !MAGIC[ext](head)) return fail(400, `"${safeName(f.originalname)}" does not look like a real ${ext.toUpperCase()} file.`);
        files.push({ name: safeName(f.originalname), stored: f.filename, size: f.size, kind });
      }
      // Chaining: reuse the result of an earlier job as the only input of this one.
      if (req.body.from) {
        if (files.length) return fail(400, 'Send either files or a previous job, not both.');
        const prev = isJobId(req.body.from) ? getJob(req.body.from, req.sid) : null;
        if (!prev || prev.status !== 'done') return fail(404, 'That earlier result is no longer available.');
        const ext = extOf(prev.result.name), kind = kindOfExt(ext);
        if (!kind) return fail(400, 'That result cannot be fed into another tool.');
        const stored = `001-${safeName(prev.result.name)}`;
        try { await fs.copyFile(path.join(jobDir(prev.id), 'out', prev.result.file), path.join(jobDir(req.pendingId), 'in', stored)); }
        catch { return fail(404, 'That earlier result is no longer available.'); }
        files.push({ name: safeName(prev.result.name), stored, size: prev.result.size, kind });
      }
      if (!files.length) return fail(400, 'Add a file first.');
      const job = await createJob({ id: req.pendingId, toolId, options, owner: req.sid, files });
      enqueue(job);
      res.status(202).json(publicView(job));
    } catch (e) {
      if (e instanceof ToolError) return fail(400, e.message);
      await dropPending(req.pendingId);
      next(e);
    }
  });
});

const findJob = (req, res) => {
  const job = isJobId(req.params.id) ? getJob(req.params.id, req.sid) : null;
  if (!job) res.status(404).json({ error: gone });
  return job;
};
app.get('/api/jobs/:id', requireUnlocked, (req, res) => { const j = findJob(req, res); if (j) res.json(publicView(j)); });
app.get('/api/jobs/:id/download', requireUnlocked, async (req, res, next) => {
  const j = findJob(req, res); if (!j) return;
  if (j.status !== 'done') return res.status(409).json({ error: 'Not ready yet.' });
  const file = path.join(jobDir(j.id), 'out', j.result.file);
  try { await fs.access(file); } catch { return res.status(404).json({ error: gone }); }
  res.set('Cache-Control', 'no-store');
  res.download(file, j.result.name, err => { if (err && !res.headersSent) next(err); });
});
app.delete('/api/jobs/:id', requireUnlocked, async (req, res) => {
  const j = findJob(req, res); if (!j) return;
  await deleteJob(j.id);
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof ClientError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server.' });
});

await initJobs();
const server = app.listen(config.port, () => {
  console.log(`${config.appName} listening on :${config.port} · jobs in ${config.jobsDir} · retention ${config.retentionMin} min · passcode ${config.accessCode ? 'ON' : 'off'} · converters as ${config.workerUser || 'same user'}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
