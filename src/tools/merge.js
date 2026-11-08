// Merge: qpdf stitches the PDFs together in the order they were added; optional blank divider page.
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { run } from '../run.js';
import { config } from '../config.js';
import { baseOf, bool, checkKind, inPath, outPath, timeouts, tmpPath } from './common.js';

export default {
  id: 'merge', name: 'Merge', accepts: 'pdf', minFiles: 2, maxFiles: config.maxFiles,
  parseOptions: o => ({ divider: bool(o.divider, false) }),
  checkInputs: files => checkKind(files, 'pdf', { min: 2, max: config.maxFiles }),
  async run({ job, dir, report }) {
    const out = `${baseOf(job.files[0].name)}-merged.pdf`;
    const pages = [];
    let blank = null;
    if (job.options.divider) {
      const doc = await PDFDocument.create(); doc.addPage([595.28, 841.89]);
      blank = tmpPath(dir, 'blank.pdf'); await fs.writeFile(blank, await doc.save());
    }
    job.files.forEach((f, i) => { if (i && blank) pages.push(blank); pages.push(inPath(dir, f)); });
    report(20, `Joining ${job.files.length} files`);
    await run('qpdf', ['--empty', '--pages', ...pages, '--', outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.normal() });
    return { file: out, name: out };
  },
};
