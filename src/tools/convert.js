// Office <-> PDF. Word/Excel/PowerPoint -> PDF uses LibreOffice headless. PDF -> Word uses pdf2docx,
// which keeps text flowing in paragraphs instead of boxes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, ToolError } from '../run.js';
import { baseOf, checkKind, inPath, listDir, outPath, timeouts, tmpPath, zipFiles } from './common.js';

async function officeToPdf(dir, f, report) {
  const profile = tmpPath(dir, 'lo-profile');
  await fs.mkdir(profile, { recursive: true });
  report(null, `Converting ${f.name}`);
  await run('soffice', [
    '--headless', '--norestore', '--nologo', '--nodefault', '--nofirststartwizard', '--nolockcheck',
    `-env:UserInstallation=file://${profile}`, '--convert-to', 'pdf', '--outdir', path.join(dir, 'out'), inPath(dir, f),
  ], { cwd: dir, timeoutSec: timeouts.heavy() });
  const produced = path.join(dir, 'out', `${baseOf(f.stored)}.pdf`);
  const wanted = outPath(dir, `${baseOf(f.name)}.pdf`);
  try { await fs.access(produced); } catch { throw new ToolError('LibreOffice could not read this file. Is it a normal Word, Excel or PowerPoint document?'); }
  if (produced !== wanted) await fs.rename(produced, wanted);
  return path.basename(wanted);
}

export const wordToPdf = {
  id: 'word-pdf', name: 'Word → PDF', accepts: 'office', minFiles: 1, maxFiles: 10,
  parseOptions: () => ({}),
  checkInputs: files => checkKind(files, 'office', { min: 1, max: 10 }),
  async run({ job, dir, report }) {
    const outs = [];
    for (const [i, f] of job.files.entries()) { report(10 + Math.round(80 * i / job.files.length)); outs.push(await officeToPdf(dir, f, report)); }
    if (outs.length === 1) return { file: outs[0], name: outs[0] };
    const zip = `${baseOf(job.files[0].name)}-and-${outs.length - 1}-more.zip`;
    await zipFiles(outs.map(o => outPath(dir, o)), outPath(dir, zip));
    return { file: zip, name: zip, count: outs.length };
  },
};

export const pdfToWord = {
  id: 'pdf-word', name: 'PDF → Word', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: () => ({}),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}.docx`;
    report(15, 'Reading the layout');
    await run('pdf2docx', ['convert', inPath(dir, f), outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.heavy() });
    try { await fs.access(outPath(dir, out)); } catch { throw new ToolError('This PDF could not be turned into Word. Scanned PDFs need "Scan → Text" first.'); }
    return { file: out, name: out };
  },
};
