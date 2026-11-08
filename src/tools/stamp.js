// Page numbers and Sign: pdf-lib draws directly onto the pages. No external program involved.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ToolError } from '../run.js';
import { baseOf, checkKind, inPath, outPath, pick } from './common.js';
import { config } from '../config.js';

const MARGIN = 26;

async function load(dir, f) {
  try { return await PDFDocument.load(await fs.readFile(inPath(dir, f)), { ignoreEncryption: false }); }
  catch (e) { throw new ToolError(/encrypted/i.test(String(e)) ? 'This PDF is password-protected. Unlock it first.' : 'This PDF could not be opened.'); }
}

/** x,y for a box of w×h at a named corner of a page. */
function place(pos, page, w, h) {
  const { width, height } = page.getSize();
  const x = pos.endsWith('l') ? MARGIN : pos.endsWith('c') ? (width - w) / 2 : width - w - MARGIN;
  const y = pos.startsWith('t') ? height - h - MARGIN : MARGIN;
  return { x, y };
}

export const numbers = {
  id: 'numbers', name: 'Page numbers', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => ({ pos: pick(o.pos, ['bc', 'br', 'bl', 'tc', 'tr'], 'bc'), format: pick(o.format, ['n', 'n/N', 'Page n of N'], 'n') }),
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}-numbered.pdf`;
    const doc = await load(dir, f);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages(), N = pages.length;
    report(30, `Stamping ${N} pages`);
    pages.forEach((page, i) => {
      const n = i + 1;
      const text = job.options.format === 'n' ? String(n) : job.options.format === 'n/N' ? `${n} / ${N}` : `Page ${n} of ${N}`;
      const size = 10, w = font.widthOfTextAtSize(text, size), h = size;
      const { x, y } = place(job.options.pos, page, w, h);
      page.drawText(text, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
    });
    await fs.writeFile(outPath(dir, out), await doc.save());
    return { file: out, name: out };
  },
};

export const sign = {
  id: 'sign', name: 'Sign', accepts: 'pdf', minFiles: 1, maxFiles: 1,
  parseOptions: o => {
    const mode = pick(o.mode, ['text', 'image'], 'text');
    const text = String(o.text || '').trim().slice(0, 60);
    const image = String(o.image || '');
    if (mode === 'text' && !text) throw new ToolError('Type the name to sign with.');
    if (mode === 'image' && !/^data:image\/png;base64,[A-Za-z0-9+/=]{100,1400000}$/.test(image)) throw new ToolError('Draw your signature first.');
    return { mode, text, image, pages: pick(o.pages, ['last', 'first', 'all'], 'last'), pos: pick(o.pos, ['br', 'bl', 'bc', 'tr', 'tl'], 'br'), size: pick(String(o.size), ['small', 'medium', 'large'], 'medium') };
  },
  checkInputs: files => checkKind(files, 'pdf'),
  async run({ job, dir, report }) {
    const f = job.files[0], out = `${baseOf(f.name)}-signed.pdf`;
    const doc = await load(dir, f);
    const all = doc.getPages();
    const targets = job.options.pages === 'all' ? all : [job.options.pages === 'first' ? all[0] : all[all.length - 1]];
    const width = { small: 110, medium: 160, large: 220 }[job.options.size];
    report(30, 'Placing the signature');
    if (job.options.mode === 'image') {
      const png = await doc.embedPng(Buffer.from(job.options.image.split(',')[1], 'base64'));
      const scale = width / png.width, w = width, h = png.height * scale;
      for (const page of targets) { const { x, y } = place(job.options.pos, page, w, h); page.drawImage(png, { x, y, width: w, height: h }); }
    } else {
      doc.registerFontkit(fontkit);
      const font = await doc.embedFont(await fs.readFile(path.join(config.assetsDir, 'fonts', 'Caveat.ttf')), { subset: true });
      const size = { small: 24, medium: 34, large: 46 }[job.options.size];
      const w = font.widthOfTextAtSize(job.options.text, size), h = font.heightAtSize(size);
      for (const page of targets) { const { x, y } = place(job.options.pos, page, w, h); page.drawText(job.options.text, { x, y: y + h * 0.25, size, font, color: rgb(0.08, 0.1, 0.35) }); }
    }
    await fs.writeFile(outPath(dir, out), await doc.save());
    return { file: out, name: out };
  },
};
