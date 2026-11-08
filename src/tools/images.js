// PDF -> JPG (Poppler renders each page) and JPG/PNG -> PDF (img2pdf embeds without re-encoding).
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../run.js';
import { baseOf, checkKind, inPath, listDir, outPath, pick, timeouts, tmpPath, zipFiles } from './common.js';

export const pdfToJpg = {
  id: 'pdf-jpg', name: 'PDF → JPG', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => ({ dpi: pick(String(o.dpi), ['100', '150', '300'], '150') }),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], base = baseOf(f.name);
    report(20, 'Drawing the pages');
    await run('pdftoppm', ['-jpeg', '-r', job.options.dpi, '-jpegopt', 'quality=88', inPath(dir, f), tmpPath(dir, `${base}-page`)], { cwd: dir, timeoutSec: timeouts.heavy() });
    const pages = (await listDir(tmpPath(dir, ''))).filter(x => x.endsWith('.jpg'));
    if (pages.length === 1) { const out = `${base}.jpg`; await fs.rename(tmpPath(dir, pages[0]), outPath(dir, out)); return { file: out, name: out }; }
    report(85, `Packing ${pages.length} pictures`);
    const out = `${base}-pages.zip`;
    await zipFiles(pages.map(p => tmpPath(dir, p)), outPath(dir, out));
    return { file: out, name: out, count: pages.length };
  },
};

export const jpgToPdf = {
  id: 'jpg-pdf', name: 'JPG → PDF', accepts: 'image', minFiles: 1, maxFiles: 50,
  parseOptions: o => ({ pagesize: pick(o.pagesize, ['auto', 'A4', 'Letter'], 'auto') }),
  checkInputs: files => checkKind(files, 'image', { min: 1, max: 50 }),
  async run({ job, dir, report }) {
    const base = job.files.length === 1 ? baseOf(job.files[0].name) : `${baseOf(job.files[0].name)}-and-${job.files.length - 1}-more`;
    const out = `${base}.pdf`;
    const inputs = [];
    for (const [i, f] of job.files.entries()) {
      report(10 + Math.round(60 * i / job.files.length), `Preparing picture ${i + 1} of ${job.files.length}`);
      let src = inPath(dir, f);
      // img2pdf refuses pictures with transparency; flatten those onto white first.
      if (f.kind === 'image' && /\.png$/i.test(f.stored)) {
        const { out: alpha } = await run('identify', ['-format', '%A', src], { cwd: dir, timeoutSec: 60 });
        if (/true|blend/i.test(alpha)) { const flat = tmpPath(dir, `${i}-flat.png`); await run('convert', [src, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', flat], { cwd: dir, timeoutSec: 120 }); src = flat; }
      }
      inputs.push(src);
    }
    report(80, 'Building the PDF');
    const size = job.options.pagesize === 'auto' ? [] : ['--pagesize', job.options.pagesize, '--fit', 'into'];
    await run('img2pdf', ['--auto-orient', ...size, '-o', outPath(dir, out), ...inputs], { cwd: dir, timeoutSec: timeouts.normal() });
    return { file: out, name: out };
  },
};
