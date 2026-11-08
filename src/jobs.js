// Job store, queue and retention. One folder per job: <jobsDir>/<id>/{in,out,tmp}.
// Jobs live in memory; a sweeper wipes expired folders every minute.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PQueue from 'p-queue';
import { config } from './config.js';
import { tools } from './tools/index.js';
import { ToolError } from './run.js';

const jobs = new Map();
const queue = new PQueue({ concurrency: config.concurrency });
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isJobId = id => typeof id === 'string' && ID_RE.test(id);
export const jobDir = id => path.join(config.jobsDir, id);
export const newJobId = () => crypto.randomUUID();

export async function initJobs() {
  await fs.rm(config.jobsDir, { recursive: true, force: true });
  await fs.mkdir(config.jobsDir, { recursive: true });
  setInterval(sweep, 60_000).unref();
}

/** Make the three folders for a job id. Safe to call twice. */
export async function makeJobDir(id) {
  const dir = jobDir(id);
  await Promise.all(['in', 'out', 'tmp'].map(d => fs.mkdir(path.join(dir, d), { recursive: true })));
  return dir;
}

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
  return job;
}

export function getJob(id, owner) {
  const j = jobs.get(id);
  if (!j || j.owner !== owner) return null;
  return j;
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
      const st = await fs.stat(path.join(jobDir(job.id), 'out', result.file));
      job.result = { ...result, size: st.size };
      job.status = 'done'; job.progress = 100; job.step = 'Ready';
    } catch (e) {
      job.status = 'error';
      job.error = e instanceof ToolError ? e.message : 'Something went wrong while processing this file.';
      console.error(`[job ${job.id} ${job.toolId}]`, e instanceof ToolError ? e.detail || e.message : e);
    }
    finish(job);
  });
}

function finish(job) {
  job.doneAt = Date.now();
  job.expiresAt = job.doneAt + config.retentionMin * 60_000;
}

export async function deleteJob(id) {
  jobs.delete(id);
  await fs.rm(jobDir(id), { recursive: true, force: true });
}

export const queueStats = () => ({ pending: queue.pending, waiting: queue.size, jobs: jobs.size });

async function sweep() {
  const now = Date.now();
  for (const j of jobs.values()) if (j.expiresAt && j.expiresAt <= now) await deleteJob(j.id);
  // Also remove any stray folder with no record (e.g. an upload that never became a job).
  try {
    for (const name of await fs.readdir(config.jobsDir)) {
      if (jobs.has(name)) continue;
      const st = await fs.stat(jobDir(name)).catch(() => null);
      if (st && now - st.mtimeMs > 10 * 60_000) await fs.rm(jobDir(name), { recursive: true, force: true });
    }
  } catch { /* dir may not exist yet */ }
}

export const publicView = j => ({
  id: j.id, tool: j.toolId, status: j.status, progress: j.progress, step: j.step,
  files: j.files.map(f => ({ name: f.name, size: f.size })),
  result: j.result ? { name: j.result.name, size: j.result.size, count: j.result.count || 1, note: j.result.note || null } : null,
  error: j.error, expiresAt: j.expiresAt,
});
