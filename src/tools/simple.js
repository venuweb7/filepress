// Rotate and Protect: thin wrappers around qpdf.
import { run, ToolError } from '../run.js';
import { baseOf, checkKind, inPath, outPath, pick, timeouts } from './common.js';

export const rotate = {
  id: 'rotate', name: 'Rotate', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => ({ angle: pick(o.angle, ['+90', '-90', '+180'], '+90') }),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}-rotated.pdf`;
    report(30, 'Turning the pages');
    await run('qpdf', [inPath(dir, f), outPath(dir, out), `--rotate=${job.options.angle}`], { cwd: dir, timeoutSec: timeouts.normal() });
    return { file: out, name: out };
  },
};

export const protect = {
  id: 'protect', name: 'Protect', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => {
    const pw = String(o.password || '');
    if (pw.length < 4 || pw.length > 64) throw new ToolError('Choose a password between 4 and 64 characters.');
    return { password: pw };
  },
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}-protected.pdf`;
    report(30, 'Locking with your password');
    await run('qpdf', ['--encrypt', `--user-password=${job.options.password}`, `--owner-password=${job.options.password}`, '--bits=256', '--', inPath(dir, f), outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.normal() });
    return { file: out, name: out };
  },
};
