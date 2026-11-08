// HTTP server: static app + a small JSON API for jobs. See docs/DESIGN.md for the flow.
import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { tools, toolSummary } from './tools/index.js';
import { initJobs, createJob, getJob, enqueue, deleteJob, isJobId, jobDir, newJobId, makeJobDir, publicView, queueStats } from './jobs.js';
import { KINDS, extOf, safeName } from './tools/common.js';
import { ToolError } from './run.js';

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

class ClientError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

/* ---------- sessions: a signed, httpOnly cookie identifies the browser and remembers the unlock ---------- */
const secret = config.sessionSecret || crypto.randomBytes(32).toString('hex');
const sign = s => crypto.createHmac('sha256', secret).update(s).digest('base64url');
const COOKIE = 'ps';
function readCookie(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [sid, flag, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!sid || !flag || !mac || !/^[a-f0-9]{32}$/.test(sid) || !/^[01]$/.test(flag)) return null;
  const expect = sign(sid + flag);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  return { sid, unlocked: flag === '1' };
}
function writeCookie(req, res, sid, unlocked) {
  const flag = unlocked ? '1' : '0';
  const attrs = [`${COOKIE}=${sid}.${flag}.${sign(sid + flag)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${30 * 86400}`];
  if (req.secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
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

/* ---------- small JSON endpoints ---------- */
const limits = { maxFileMb: config.maxFileMb, maxFiles: config.maxFiles, retentionMin: config.retentionMin };
app.get('/healthz', (req, res) => res.json({ ok: true, ...queueStats() }));
app.get('/api/session', (req, res) => res.json({ locked: !req.unlocked, appName: config.appName, limits, tools: toolSummary }));

const unlockLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many tries. Wait a few minutes.' } });
app.post('/api/unlock', unlockLimiter, express.json({ limit: '2kb' }), (req, res) => {
  if (!config.accessCode) return res.status(204).end();
  const given = String(req.body?.code || '');
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(config.accessCode).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'That code is not right.' });
  writeCookie(req, res, req.sid, true);
  res.status(204).end();
});

/* ---------- uploads ---------- */
const kindOfExt = ext => Object.keys(KINDS).find(k => KINDS[k].exts.includes(ext)) || null;
const MAGIC = {
  pdf: b => b.subarray(0, 5).toString('latin1') === '%PDF-',
  jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  docx: b => b[0] === 0x50 && b[1] === 0x4b, xlsx: b => b[0] === 0x50 && b[1] === 0x4b, pptx: b => b[0] === 0x50 && b[1] === 0x4b,
  odt: b => b[0] === 0x50 && b[1] === 0x4b, ods: b => b[0] === 0x50 && b[1] === 0x4b, odp: b => b[0] === 0x50 && b[1] === 0x4b,
  doc: b => b[0] === 0xd0 && b[1] === 0xcf, xls: b => b[0] === 0xd0 && b[1] === 0xcf, ppt: b => b[0] === 0xd0 && b[1] === 0xcf,
  rtf: b => b.subarray(0, 5).toString('latin1') === '{\\rtf', txt: () => true,
};
async function sniff(file) {
  const fh = await fs.open(file, 'r');
  try { const b = Buffer.alloc(8); const { bytesRead } = await fh.read(b, 0, 8, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
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

const jobsLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many jobs in a short time. Please wait a little.' } });

app.post('/api/jobs', requireUnlocked, jobsLimiter, async (req, res, next) => {
  req.pendingId = newJobId();
  try { await makeJobDir(req.pendingId); } catch (e) { return next(e); }
  upload.array('files', config.maxFiles)(req, res, async err => {
    const dir = jobDir(req.pendingId);
    const fail = async (status, message) => { await fs.rm(dir, { recursive: true, force: true }); res.status(status).json({ error: message }); };
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
        await fs.copyFile(path.join(jobDir(prev.id), 'out', prev.result.file), path.join(dir, 'in', stored));
        files.push({ name: safeName(prev.result.name), stored, size: prev.result.size, kind });
      }
      if (!files.length) return fail(400, 'Add a file first.');
      const job = await createJob({ id: req.pendingId, toolId, options, owner: req.sid, files });
      enqueue(job);
      res.status(202).json(publicView(job));
    } catch (e) {
      if (e instanceof ToolError) return fail(400, e.message);
      await fs.rm(dir, { recursive: true, force: true });
      next(e);
    }
  });
});

const findJob = (req, res) => {
  const job = isJobId(req.params.id) ? getJob(req.params.id, req.sid) : null;
  if (!job) res.status(404).json({ error: 'This job does not exist any more. Results are wiped after an hour.' });
  return job;
};
app.get('/api/jobs/:id', requireUnlocked, (req, res) => { const j = findJob(req, res); if (j) res.json(publicView(j)); });
app.get('/api/jobs/:id/download', requireUnlocked, (req, res, next) => {
  const j = findJob(req, res); if (!j) return;
  if (j.status !== 'done') return res.status(409).json({ error: 'Not ready yet.' });
  res.set('Cache-Control', 'no-store');
  res.download(path.join(jobDir(j.id), 'out', j.result.file), j.result.name, err => { if (err && !res.headersSent) next(err); });
});
app.delete('/api/jobs/:id', requireUnlocked, async (req, res, next) => {
  const j = findJob(req, res); if (!j) return;
  try { await deleteJob(j.id); res.status(204).end(); } catch (e) { next(e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof ClientError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

await initJobs();
const server = app.listen(config.port, () => {
  console.log(`${config.appName} listening on :${config.port} · jobs in ${config.jobsDir} · retention ${config.retentionMin} min · passcode ${config.accessCode ? 'ON' : 'off'}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
