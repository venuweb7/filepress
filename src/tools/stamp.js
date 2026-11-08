// Page numbers and Sign. The pdf-lib work happens in a separate, capped Node process (stamp-worker.js).
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, ToolError } from '../run.js';
import { baseOf, checkKind, inPath, outPath, pick, timeouts, tmpPath } from './common.js';
import { config } from '../config.js';

const WORKER = path.join(config.toolsDir, 'stamp-worker.js');
const MAX_SIG_B64 = 600_000;        // ~450 KB PNG, far more than a drawn signature needs
const MAX_SIG_W = 4000, MAX_SIG_H = 2000;

/** Read width/height straight from the PNG header before anything decodes the picture. */
function pngSize(b64) {
  const head = Buffer.from(b64.slice(0, 48), 'base64');
  if (head.length < 24 || head.readUInt32BE(0) !== 0x89504e47 || head.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

async function stamp(job, dir, report, task, out) {
  const taskFile = tmpPath(dir, 'task.json');
  await fs.writeFile(taskFile, JSON.stringify({ ...task, in: inPath(dir, job.files[0]), out: outPath(dir, out), maxPages: config.maxPages }), { mode: 0o660 });
  try {
    await run(process.execPath, ['--max-old-space-size=768', WORKER, taskFile], { cwd: dir, timeoutSec: timeouts.normal(), memMb: 0 });
  } catch (e) {
    const d = e.detail || '';
    if (/ENCRYPTED/.test(d)) throw new ToolError('This PDF is password-protected. Unlock it first.');
    if (/UNREADABLE/.test(d)) throw new ToolError('This PDF could not be opened.');
    if (/TOOMANY (\d+)/.test(d)) throw new ToolError(`This tool works on PDFs of up to ${config.maxPages} pages. This one has ${d.match(/TOOMANY (\d+)/)[1]}.`);
    if (/NOGLYPH/.test(d)) throw new ToolError('Typed signatures work with English letters only. Draw it instead, or use Latin letters.');
    throw e;
  } finally { await fs.rm(taskFile, { force: true }); }
  return { file: out, name: out };
}

export const numbers = {
  id: 'numbers', name: 'Page numbers', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => ({ pos: pick(o.pos, ['bc', 'br', 'bl', 'tc', 'tr'], 'bc'), format: pick(o.format, ['n', 'n/N', 'Page n of N'], 'n') }),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    report(30, 'Stamping the pages');
    return stamp(job, dir, report, { op: 'numbers', ...job.options }, `${baseOf(job.files[0].name)}-numbered.pdf`);
  },
};

export const sign = {
  id: 'sign', name: 'Sign', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => {
    const mode = pick(o.mode, ['text', 'image'], 'text');
    const text = [...String(o.text || '')].filter(ch => ch.codePointAt(0) >= 32 && ch.codePointAt(0) !== 127).join('').trim().slice(0, 60);
    let image = '';
    if (mode === 'text' && !text) throw new ToolError('Type the name to sign with.');
    if (mode === 'image') {
      const m = String(o.image || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
      if (!m || m[1].length > MAX_SIG_B64) throw new ToolError('Draw your signature first.');
      const size = pngSize(m[1]);
      if (!size || size.w > MAX_SIG_W || size.h > MAX_SIG_H || !size.w || !size.h) throw new ToolError('That signature picture is not usable. Clear it and draw again.');
      image = m[1];
    }
    return { mode, text, image, pages: pick(o.pages, ['last', 'first', 'all'], 'last'), pos: pick(o.pos, ['br', 'bl', 'bc', 'tr', 'tl'], 'br'), size: pick(o.size, ['small', 'medium', 'large'], 'medium') };
  },
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    report(30, 'Placing the signature');
    return stamp(job, dir, report, { op: 'sign', ...job.options, fontPath: path.join(config.assetsDir, 'fonts', 'Caveat.ttf') }, `${baseOf(job.files[0].name)}-signed.pdf`);
  },
};
