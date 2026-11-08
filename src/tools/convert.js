// Office <-> PDF. Word/Excel/PowerPoint -> PDF uses LibreOffice headless with a locked-down, throwaway
// profile (macros off, links never updated). PDF -> Word uses pdf2docx, which keeps text flowing in paragraphs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, ToolError } from '../run.js';
import { config } from '../config.js';
import { baseOf, checkKind, extOf, inPath, outPath, timeouts, tmpPath, uniqueName, zipFiles } from './common.js';

// Pre-seeded LibreOffice settings: no macros, no link updates, no untrusted referer links.
const LO_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="SecureURL" oor:op="fuse"><value></value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Save/Document"><prop oor:name="AutoSave" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

async function officeToPdf(dir, f, report, used) {
  const profile = tmpPath(dir, 'lo-profile');
  await fs.mkdir(path.join(profile, 'user'), { recursive: true });
  await fs.writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), LO_PROFILE);
  const outDir = tmpPath(dir, 'lo-out');
  await fs.mkdir(outDir, { recursive: true });
  report(null, `Converting ${f.name}`);
  const filter = extOf(f.stored) === 'txt' ? ['--infilter=Text (encoded):UTF8'] : [];
  await run('soffice', [
    '--headless', '--norestore', '--nologo', '--nodefault', '--nofirststartwizard', '--nolockcheck', '--safe-mode',
    `-env:UserInstallation=file://${profile}`, ...filter, '--convert-to', 'pdf', '--outdir', outDir, inPath(dir, f),
  ], { cwd: dir, timeoutSec: timeouts.heavy(), memMb: 0 });
  const produced = path.join(outDir, `${baseOf(f.stored)}.pdf`);
  try { await fs.access(produced); } catch { throw new ToolError('LibreOffice could not read this file. Is it a normal Word, Excel or PowerPoint document?'); }
  const name = uniqueName(`${baseOf(f.name)}.pdf`, used);
  await fs.rename(produced, outPath(dir, name));
  return name;
}

export const wordToPdf = {
  id: 'word-pdf', name: 'Office → PDF', accepts: 'office', minFiles: 1, maxFiles: Math.min(10, config.maxFiles),
  parseOptions: () => ({}),
  checkInputs: files => checkKind(files, 'office', { min: 1, max: Math.min(10, config.maxFiles) }),
  async run({ job, dir, report }) {
    const outs = [], used = new Set();
    for (const [i, f] of job.files.entries()) { report(10 + Math.round(80 * i / job.files.length)); outs.push(await officeToPdf(dir, f, report, used)); }
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
    await run('pdf2docx', ['convert', inPath(dir, f), outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.heavy(), memMb: 0, env: { OPENBLAS_NUM_THREADS: '2' } });
    try { await fs.access(outPath(dir, out)); } catch { throw new ToolError('This PDF could not be turned into Word. Scanned PDFs need "Scan → Text" first.'); }
    return { file: out, name: out };
  },
};
