// Runs an external program with a hard wall-clock timeout, a CPU-time cap, a minimal environment
// and capped output. No shell is ever involved: arguments are passed as an array.
import { spawn } from 'node:child_process';

export class ToolError extends Error {
  constructor(message, detail = '') { super(message); this.detail = detail; this.name = 'ToolError'; }
}

const OUT_CAP = 64 * 1024;

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd:string, timeoutSec:number, env?:Record<string,string>}} opt
 */
export function run(cmd, args, opt) {
  return new Promise((resolve, reject) => {
    const env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: opt.cwd,
      TMPDIR: opt.cwd,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      ...(opt.env || {}),
    };
    // prlimit (util-linux) caps CPU seconds so a runaway converter cannot pin a core forever.
    const cpuCap = String(Math.ceil(opt.timeoutSec * 1.5));
    const child = spawn('prlimit', [`--cpu=${cpuCap}`, '--nofile=512', '--', cmd, ...args], {
      cwd: opt.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let out = '', err = '', done = false;
    const cap = (s, add) => (s.length < OUT_CAP ? s + add.toString('utf8').slice(0, OUT_CAP - s.length) : s);
    child.stdout.on('data', d => { out = cap(out, d); });
    child.stderr.on('data', d => { err = cap(err, d); });
    const timer = setTimeout(() => {
      if (done) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      done = true;
      reject(new ToolError('The job took too long and was stopped.', `${cmd} timed out after ${opt.timeoutSec}s`));
    }, opt.timeoutSec * 1000);
    child.on('error', e => { if (done) return; done = true; clearTimeout(timer); reject(new ToolError('The converter could not be started.', `${cmd}: ${e.message}`)); });
    child.on('close', code => {
      if (done) return; done = true; clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new ToolError('The converter reported an error with this file.', `${cmd} exit ${code}: ${err.slice(-2000)}`));
    });
  });
}
