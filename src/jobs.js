// Job store, queue and retention. One folder per job: <jobsDir>/<id>/{in,out,tmp}.
// Jobs live in memory; a sweeper wipes expired folders every minute.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PQueue from 'p-queue';
import { config } from './config.js';
import { tools } from './tools/index.js';
import { ToolError, killUnder } from './run.js';

const jobs = new Map();
const pending = new Set();   // folders being uploaded into, not yet jobs; the sweeper leaves them alone
const zombies = new Set();   // folders that could not be removed yet (a converter was still writing)
const queue = new PQueue({ concurrency: config.concurrency });
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isJobId = id => typeof id === 'string' && ID_RE.test(id);
export const jobDir = id => path.join(config.jobsDir, id);
export const newJobId = () => crypto.randomUUID();
export const isBusy = () => queue.size + queue.pending >= config.maxQueue;

export async function initJobs() {
  // Empty the folder but keep the folder itself: in the container it carries the shared group + setgid bit.
  await fs.mkdir(config.jobsDir, { recursive: true });
  for (const name of await fs.readdir(config.jobsDir)) await fs.rm(path.join(config.jobsDir, name), { recursive: true, force: true });
  setInterval(() => sweep().catch(e => console.error('[sweep]', e?.message || e)), 60_000).unref();
}

/** Make the three folders for a job id. Safe to call twice. */
export async function makeJobDir(id) {
  const dir = jobDir(id);
  pending.add(id);
  await Promise.all(['in', 'out', 'tmp'].map(d => fs.mkdir(path.join(dir, d), { recursive: true })));
  return dir;
}
export async function dropPending(id) { pending.delete(id); await fs.rm(jobDir(id), { recursive: true, force: true }).catch(() => zombies.add(id)); }

/** Register a job whose folder already exists and whose files are already stored. */
export async function createJob({ id, toolId, options, owner, files }) {
  const tool = tools[toolId];
  if (!tool) throw new ToolError('Unknown tool.');
  if (!isJobId(id)) throw new ToolError('Bad job id.');
  await makeJobDir(id);
  const job = {
    id, toolId, owner, options: tool.parseOptions(options || {}),
    status: 'queued', progress: 0, step: 'Waiting for a free slot',
    files: files || [], result: null, error: null,
    createdAt: Date.now(), doneAt: null, expiresAt: null,
  };
  jobs.set(id, job);
  pending.delete(id);
  return job;
}

export function getJob(id, owner) {
  const j = jobs.get(id);
  if (!j || j.owner !== owner) return null;
  return j;
}

/** Keep converter errors useful for us but free of the user's file names. */
function scrub(job, text) {
  let t = String(text || '').replaceAll(jobDir(job.id), '<job>');
  for (const f of job.files) { t = t.replaceAll(f.stored, '<file>').replaceAll(f.name, '<file>'); }
  return t.slice(-600);
}

export function enqueue(job) {
  const tool = tools[job.toolId];
  const inputCheck = tool.checkInputs(job.files);
  if (inputCheck) { job.status = 'error'; job.error = inputCheck; finish(job); return; }
  queue.add(async () => {
    if (!jobs.has(job.id)) return; // deleted while queued
    job.status = 'running'; job.step = 'Checking the file'; job.progress = 5;
    const report = (progress, step) => { if (step) job.step = step; if (progress != null) job.progress = Math.max(job.progress, Math.min(99, progress)); };
    try {
      const result = await tool.run({ job, dir: jobDir(job.id), report });
      if (!jobs.has(job.id)) return; // deleted while running: folder is already gone
      const st = await fs.stat(path.join(jobDir(job.id), 'out', result.file));
      job.result = { ...result, size: st.size };
      job.status = 'done'; job.progress = 100; job.step = 'Ready';
    } catch (e) {
      if (!jobs.has(job.id)) return;
      job.status = 'error';
      job.error = e instanceof ToolError ? e.message : 'Something went wrong while processing this file.';
      console.error(`[job ${job.id} ${job.toolId}] ${e instanceof ToolError ? scrub(job, e.detail || e.message) : scrub(job, e?.stack || e)}`);
    }
    finish(job);
  }).catch(e => console.error('[queue]', e?.message || e));
}

function finish(job) {
  // Secrets are only needed while the tool runs.
  if (job.options && 'password' in job.options) job.options.password = null;
  job.doneAt = Date.now();
  job.expiresAt = job.doneAt + config.retentionMin * 60_000;
}

/** Forget the job, stop its converter, remove the folder. Never throws: a stubborn folder is retried by the sweeper. */
export async function deleteJob(id) {
  jobs.delete(id);
  killUnder(jobDir(id));
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await fs.rm(jobDir(id), { recursive: true, force: true }); zombies.delete(id); return; }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  zombies.add(id);
}

export const queueStats = () => ({ running: queue.pending, waiting: queue.size, jobs: jobs.size });

async function sweep() {
  const now = Date.now();
  for (const j of [...jobs.values()]) if (j.expiresAt && j.expiresAt <= now) await deleteJob(j.id);
  for (const id of [...zombies]) await deleteJob(id);
  // Also remove any stray folder with no record and no upload in progress (e.g. after a crash).
  let names = [];
  try { names = await fs.readdir(config.jobsDir); } catch { return; }
  for (const name of names) {
    if (jobs.has(name) || pending.has(name)) continue;
    try {
      const st = await fs.stat(jobDir(name));
      if (now - st.mtimeMs > 10 * 60_000) await fs.rm(jobDir(name), { recursive: true, force: true });
    } catch { /* vanished or busy; next sweep */ }
  }
}

export const publicView = j => ({
  id: j.id, tool: j.toolId, status: j.status, progress: j.progress, step: j.step,
  files: j.files.map(f => ({ name: f.name, size: f.size })),
  result: j.result ? { name: j.result.name, size: j.result.size, count: j.result.count || 1, note: j.result.note || null } : null,
  error: j.error, expiresAt: j.expiresAt,
});
