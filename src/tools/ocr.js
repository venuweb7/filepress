// Scan -> Text: OCRmyPDF adds an invisible text layer on top of the scanned image.
import { run, ToolError } from '../run.js';
import { baseOf, bool, checkKind, inPath, outPath, timeouts } from './common.js';

const LANGS = { eng: 'English', tel: 'Telugu' };

export default {
  id: 'ocr', name: 'Scan → Text', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => {
    const req = Array.isArray(o.langs) ? o.langs : String(o.langs || 'eng,tel').split(',');
    const langs = req.map(s => String(s).trim()).filter(l => LANGS[l]);
    return { langs: langs.length ? langs : ['eng', 'tel'], deskew: bool(o.deskew, true) };
  },
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}-searchable.pdf`;
    report(15, 'Reading the pages');
    const args = ['-l', job.options.langs.join('+'), '--skip-text', '--optimize', '1', '--jobs', '2', '--output-type', 'pdf'];
    if (job.options.deskew) args.push('--deskew');
    try {
      await run('ocrmypdf', [...args, inPath(dir, f), outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.heavy() });
    } catch (e) {
      if (e instanceof ToolError && /exit 6:/.test(e.detail || '')) throw new ToolError('Every page already has real text, so there is nothing to read here.');
      throw e;
    }
    return { file: out, name: out };
  },
};
