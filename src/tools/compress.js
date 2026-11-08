// Compress: Ghostscript rewrites the PDF with downsampled images and subset fonts.
import fs from 'node:fs/promises';
import { run } from '../run.js';
import { baseOf, checkKind, inPath, outPath, pick, timeouts } from './common.js';

const LEVELS = {
  smallest: { preset: '/screen', dpi: 90, mono: 200 },
  balanced: { preset: '/ebook', dpi: 150, mono: 300 },
  best: { preset: '/printer', dpi: 220, mono: 600 },
};

export default {
  id: 'compress', name: 'Compress', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => ({ level: pick(o.level, Object.keys(LEVELS), 'balanced') }),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], lv = LEVELS[job.options.level];
    const out = `${baseOf(f.name)}-compressed.pdf`;
    report(15, 'Rewriting images and fonts');
    await run('gs', [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6',
      `-dPDFSETTINGS=${lv.preset}`, '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true',
      '-dDownsampleColorImages=true', `-dColorImageResolution=${lv.dpi}`, '-dColorImageDownsampleThreshold=1.0',
      '-dDownsampleGrayImages=true', `-dGrayImageResolution=${lv.dpi}`, '-dGrayImageDownsampleThreshold=1.0',
      '-dDownsampleMonoImages=true', `-dMonoImageResolution=${lv.mono}`, '-dMonoImageDownsampleThreshold=1.0',
      '-dAutoRotatePages=/None', `-sOutputFile=${outPath(dir, out)}`, inPath(dir, f),
    ], { cwd: dir, timeoutSec: timeouts.heavy() });
    report(90, 'Checking the result');
    const [a, b] = await Promise.all([fs.stat(inPath(dir, f)), fs.stat(outPath(dir, out))]);
    if (b.size >= a.size) {
      // Never hand back something bigger than what came in.
      await fs.copyFile(inPath(dir, f), outPath(dir, out));
      return { file: out, name: out, note: 'This PDF was already compact, so we kept the original as it was.' };
    }
    return { file: out, name: out };
  },
};
