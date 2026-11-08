// Rotate and Protect: thin wrappers around qpdf.
import fs from 'node:fs/promises';
import { run, ToolError } from '../run.js';
import { baseOf, checkKind, inPath, outPath, pick, timeouts, tmpPath } from './common.js';

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
    if (/[\r\n]/.test(pw)) throw new ToolError('The password cannot contain line breaks.');
    return { password: pw };
  },
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}-protected.pdf`;
    report(30, 'Locking with your password');
    // The password goes through a private argument file, never on the command line (which other
    // processes could read), and is removed right after qpdf has run.
    const argFile = tmpPath(dir, 'encrypt.args');
    const args = ['--encrypt', `--user-password=${job.options.password}`, `--owner-password=${job.options.password}`, '--bits=256', '--', inPath(dir, f), outPath(dir, out)];
    await fs.writeFile(argFile, args.join('\n') + '\n', { mode: 0o660 });
    try { await run('qpdf', [`@${argFile}`], { cwd: dir, timeoutSec: timeouts.normal() }); }
    finally { await fs.rm(argFile, { force: true }); }
    return { file: out, name: out };
  },
};
