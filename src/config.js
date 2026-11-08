// All runtime settings in one place. Everything can be overridden with environment variables.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };

export const config = {
  appName: process.env.APP_NAME || 'Pressa',
  port: int(process.env.PORT, 8080),
  // Where job folders live. Ephemeral is fine: everything is wiped on a timer anyway.
  jobsDir: process.env.JOBS_DIR || path.join(os.tmpdir(), 'pressa-jobs'),
  maxFileMb: int(process.env.MAX_FILE_MB, 200),
  maxFiles: int(process.env.MAX_FILES, 20),
  retentionMin: int(process.env.RETENTION_MIN, 60),
  concurrency: int(process.env.CONCURRENCY, 2),
  // Optional shared passcode. Empty = open to anyone who has the URL.
  accessCode: process.env.ACCESS_CODE || '',
  // Secret used to sign the session cookie. Random per boot if not set (sessions reset on restart).
  sessionSecret: process.env.SESSION_SECRET || '',
  toolTimeoutSec: int(process.env.TOOL_TIMEOUT_SEC, 240),
  heavyTimeoutSec: int(process.env.HEAVY_TIMEOUT_SEC, 480),
  publicDir: path.join(here, '..', 'public'),
  assetsDir: path.join(here, '..', 'assets'),
  trustProxy: process.env.TRUST_PROXY !== '0',
};
