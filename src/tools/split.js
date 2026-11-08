// Split: pick pages into one PDF, or cut into one file per page / per N pages (zipped).
import fs from 'node:fs/promises';
import { run, ToolError } from '../run.js';
import { assertPages, baseOf, checkKind, inPath, listDir, outPath, pageCount, pick, timeouts, tmpPath, zipFiles } from './common.js';

const RANGE_RE = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

export default {
  id: 'split', name: 'Split', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => {
    const mode = pick(o.mode, ['ranges', 'each', 'every'], 'ranges');
    const ranges = String(o.ranges || '').trim();
    if (mode === 'ranges' && (!ranges || ranges.length > 200 || !RANGE_RE.test(ranges))) throw new ToolError('Type the pages you want, like 1-3, 7.');
    const every = o.every === undefined || o.every === '' ? 2 : parseInt(o.every, 10);
    if (mode === 'every' && !(every >= 1 && every <= 500)) throw new ToolError('Pages per file must be a number from 1 to 500.');
    return { mode, ranges: ranges.replace(/\s+/g, ''), every };
  },
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], base = baseOf(f.name), src = inPath(dir, f);
    const n = await pageCount(src, dir);
    const { mode } = job.options;
    if (mode === 'ranges') {
      const tooHigh = job.options.ranges.split(/[-,]/).map(Number).some(p => p < 1 || p > n);
      if (tooHigh) throw new ToolError(`This PDF has ${n} pages. Check the page numbers you typed.`);
      const out = `${base}-pages.pdf`;
      report(30, 'Picking the pages');
      await run('qpdf', [src, '--pages', '.', job.options.ranges, '--', outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.normal() });
      return { file: out, name: out };
    }
    assertPages(n, 'Splitting into files');
    const per = mode === 'each' ? 1 : job.options.every;
    report(25, `Cutting every ${per === 1 ? 'page' : per + ' pages'}`);
    await run('qpdf', [`--split-pages=${per}`, src, tmpPath(dir, `${base}-part-%d.pdf`)], { cwd: dir, timeoutSec: timeouts.normal() });
    const parts = (await listDir(tmpPath(dir, ''))).filter(x => x.endsWith('.pdf')).map(x => tmpPath(dir, x));
    if (parts.length === 1) { // nothing to cut: hand back a single PDF, not a ZIP with one file in it
      const out = `${base}-part-1.pdf`; await fs.rename(parts[0], outPath(dir, out));
      return { file: out, name: out, note: 'This PDF already fits in one part, so there was nothing to cut.' };
    }
    report(80, `Packing ${parts.length} files`);
    const out = `${base}-split.zip`;
    await zipFiles(parts, outPath(dir, out));
    return { file: out, name: out, count: parts.length };
  },
};
