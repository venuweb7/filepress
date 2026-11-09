// Runs an external program with a hard wall-clock timeout, CPU and memory caps, a minimal environment,
// capped output, and (in the container) as a different Linux user than the web server.
// No shell is ever involved: arguments are passed as an array.
import { spawn } from 'node:child_process';
import { config } from './config.js';

export class ToolError extends Error {
  constructor(message, detail = '') { super(message); this.detail = detail; this.name = 'ToolError'; }
}

const OUT_CAP = 64 * 1024;
const live = new Map(); // job folder -> Set<child>, so a deleted job can stop its converter

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd:string, timeoutSec:number, memMb?:number, env?:Record<string,string>}} opt
 */
export function run(cmd, args, opt) {
  return new Promise((resolve, reject) => {
    if (args.some(a => /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(String(a)))) return reject(new ToolError('That text contains characters that cannot be used.', `${cmd}: control character in an argument`));
    const envPairs = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: opt.cwd,
      TMPDIR: opt.cwd,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      OMP_NUM_THREADS: '2',
      ...(opt.env || {}),
    };
    const memMb = opt.memMb === undefined ? config.memMb : opt.memMb;
    const limits = [`--cpu=${Math.ceil(opt.timeoutSec * 1.5)}`, '--nofile=512', '--core=0'];
    if (memMb) limits.push(`--as=${memMb * 1024 * 1024}`);
    // `timeout` enforces the wall clock from inside (it kills its whole process group, even across the
    // sudo user switch); the Node timer below is only a backstop.
    const inner = ['timeout', '-s', 'KILL', String(opt.timeoutSec), 'prlimit', ...limits, '--', cmd, ...args];
    const envArgs = Object.entries(envPairs).map(([k, v]) => `${k}=${v}`);
    const [exe, argv] = config.workerUser
      ? ['sudo', ['-n', '-u', config.workerUser, '--', 'env', '-i', ...envArgs, ...inner]]
      : ['env', ['-i', ...envArgs, ...inner]];
    const child = spawn(exe, argv, { cwd: opt.cwd, env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    if (!live.has(opt.cwd)) live.set(opt.cwd, new Set());
    live.get(opt.cwd).add(child);
    let out = '', err = '', done = false;
    const cap = (s, add) => (s.length < OUT_CAP ? s + add.toString('utf8').slice(0, OUT_CAP - s.length) : s);
    child.stdout.on('data', d => { out = cap(out, d); });
    child.stderr.on('data', d => { err = cap(err, d); });
    const forget = () => { const set = live.get(opt.cwd); if (set) { set.delete(child); if (!set.size) live.delete(opt.cwd); } };
    const timer = setTimeout(() => {
      if (done) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* other user or already gone; `timeout` has it */ }
      done = true; forget();
      reject(new ToolError('The job took too long and was stopped.', `${cmd} timed out after ${opt.timeoutSec}s`));
    }, (opt.timeoutSec + 15) * 1000);
    child.on('error', e => { if (done) return; done = true; forget(); clearTimeout(timer); reject(new ToolError('The converter could not be started.', `${cmd}: ${e.message}`)); });
    child.on('close', (code, signal) => {
      if (done) return; done = true; forget(); clearTimeout(timer);
      if (code === 0) return resolve({ out, err });
      if (code === 124 || code === 137 || signal === 'SIGKILL') return reject(new ToolError('The job took too long or needed too much memory and was stopped.', `${cmd} killed (code ${code}, ${signal})`));
      reject(new ToolError('The converter reported an error with this file.', `${cmd} exit ${code}: ${err.slice(-1500)}`));
    });
  });
}

/** Stop every converter still working inside a job folder (used when the job is deleted). */
export function killUnder(dir) {
  for (const child of live.get(dir) || []) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ } }
}
