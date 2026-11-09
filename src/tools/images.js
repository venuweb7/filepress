// PDF -> JPG (Poppler renders each page) and JPG/PNG -> PDF (img2pdf embeds without re-encoding).
import fs from 'node:fs/promises';
import { run, ToolError } from '../run.js';
import { config } from '../config.js';
import { assertPages, baseOf, checkKind, inPath, listDir, outPath, pdfProbe, pick, pictureProbe, timeouts, tmpPath, zipFiles } from './common.js';

const MAX_PIXELS = 40e6; // per rendered page

export const pdfToJpg = {
  id: 'pdf-jpg', name: 'PDF → JPG', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => ({ dpi: pick(o.dpi, ['100', '150', '300'], '150') }),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], base = baseOf(f.name), dpi = parseInt(job.options.dpi, 10);
    const { pages, maxArea } = await pdfProbe(inPath(dir, f), dir);
    assertPages(pages, 'PDF → JPG');
    if (maxArea * (dpi / 72) ** 2 > MAX_PIXELS) throw new ToolError('A page is too large to draw at this sharpness. Try "Small".');
    report(20, 'Drawing the pages');
    await run('pdftoppm', ['-jpeg', '-r', String(dpi), '-jpegopt', 'quality=88', inPath(dir, f), tmpPath(dir, `${base}-page`)], { cwd: dir, timeoutSec: timeouts.heavy() });
    const files = (await listDir(tmpPath(dir, ''))).filter(x => x.endsWith('.jpg'));
    if (files.length === 1) { const out = `${base}.jpg`; await fs.rename(tmpPath(dir, files[0]), outPath(dir, out)); return { file: out, name: out }; }
    report(85, `Packing ${files.length} pictures`);
    const out = `${base}-pages.zip`;
    await zipFiles(files.map(p => tmpPath(dir, p)), outPath(dir, out));
    return { file: out, name: out, count: files.length };
  },
};

export const jpgToPdf = {
  id: 'jpg-pdf', name: 'JPG → PDF', accepts: 'image', minFiles: 1, maxFiles: config.maxFiles,
  parseOptions: o => ({ pagesize: pick(o.pagesize, ['auto', 'A4', 'Letter'], 'auto') }),
  checkInputs: files => checkKind(files, 'image', { min: 1, max: config.maxFiles }),
  async run({ job, dir, report }) {
    const base = job.files.length === 1 ? baseOf(job.files[0].name) : `${baseOf(job.files[0].name)}-and-${job.files.length - 1}-more`;
    const out = `${base}.pdf`;
    const inputs = [];
    for (const [i, f] of job.files.entries()) {
      report(10 + Math.round(60 * i / job.files.length), `Preparing picture ${i + 1} of ${job.files.length}`);
      let src = inPath(dir, f);
      await pictureProbe(src, dir);   // size and frame limits
      // Anything but JPG/PNG is re-saved as a PNG first (first frame only, camera rotation applied), so img2pdf never
      // sees animated GIFs, 16-bit TIFFs or formats it does not know.
      if (!/\.(jpe?g|png)$/i.test(f.stored)) { const png = tmpPath(dir, `${i}-conv.png`); await run('convert', [`${src}[0]`, '-auto-orient', png], { cwd: dir, timeoutSec: timeouts.normal() }); src = png; }
      // img2pdf refuses pictures with transparency; flatten those onto white first.
      if (/\.png$/i.test(src)) {
        const { out: alpha } = await run('identify', ['-format', '%A', src], { cwd: dir, timeoutSec: 60, memMb: 1024 });
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
