// All runtime settings in one place. Everything can be overridden with environment variables.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

export const config = {
  appName: process.env.APP_NAME || 'Pressa',
  port: int(process.env.PORT, 8080),
  // Where job folders live. Ephemeral is fine: everything is wiped on a timer anyway.
  jobsDir: process.env.JOBS_DIR || path.join(os.tmpdir(), 'pressa-jobs'),
  maxFileMb: int(process.env.MAX_FILE_MB, 200),
  maxFiles: int(process.env.MAX_FILES, 20),
  maxRequestMb: int(process.env.MAX_REQUEST_MB, 400),   // whole upload, all files together
  maxQueue: int(process.env.MAX_QUEUE, 40),             // jobs waiting + running before we answer "busy"
  maxPages: int(process.env.MAX_PAGES, 500),            // for page-by-page tools (PDF → JPG, split, numbers, sign)
  retentionMin: int(process.env.RETENTION_MIN, 60),
  concurrency: int(process.env.CONCURRENCY, 2) || 1,
  // Optional shared passcode. Empty = open to anyone who has the URL.
  accessCode: process.env.ACCESS_CODE || '',
  // Secret used to sign the session cookie. Random per boot if not set (sessions reset on restart).
  sessionSecret: process.env.SESSION_SECRET || '',
  toolTimeoutSec: int(process.env.TOOL_TIMEOUT_SEC, 240),
  heavyTimeoutSec: int(process.env.HEAVY_TIMEOUT_SEC, 480),
  // Memory (address space) cap for converters, MB. 0 = none. Individual tools may override.
  memMb: int(process.env.TOOL_MEM_MB, 2048),
  // When set, converters run as this other Linux user through sudo (see Dockerfile). Empty = same user.
  workerUser: process.env.WORKER_USER || '',
  publicDir: path.join(here, '..', 'public'),
  assetsDir: path.join(here, '..', 'assets'),
  toolsDir: here.endsWith('src') ? path.join(here, 'tools') : path.join(here, '..', 'src', 'tools'),
  trustProxy: process.env.TRUST_PROXY !== '0',
};

/** Refuse to start with settings that would quietly weaken security. */
export function validateConfig() {
  const problems = [];
  if (config.accessCode && config.accessCode.length < 8) problems.push('ACCESS_CODE must be at least 8 characters.');
  if (config.sessionSecret && config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters (or leave it empty for a random one per boot).');
  return problems;
}
