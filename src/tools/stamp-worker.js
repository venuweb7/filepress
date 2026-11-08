// Runs in its own Node process (with a heap cap and timeout, as the worker user) so a hostile PDF or
// picture can never stall or crash the web server. Usage: node stamp-worker.js <task.json>
import fs from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const MARGIN = 26;
const task = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));

/**
 * Where to draw a box of w×h so that it appears at the named corner of the page AS THE READER SEES IT,
 * honouring /Rotate and the CropBox. Returns the pdf-lib origin and the rotation to draw with.
 */
function locate(page, pos, w, h) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const dw = rot % 180 ? box.height : box.width, dh = rot % 180 ? box.width : box.height; // displayed size
  const vx = pos.endsWith('l') ? MARGIN : pos.endsWith('c') ? (dw - w) / 2 : dw - w - MARGIN;  // display coords
  const vy = pos.startsWith('t') ? dh - h - MARGIN : MARGIN;
  if (rot === 90) return { x: box.x + box.width - vy, y: box.y + vx, rotate: degrees(90) };
  if (rot === 180) return { x: box.x + box.width - vx, y: box.y + box.height - vy, rotate: degrees(180) };
  if (rot === 270) return { x: box.x + vy, y: box.y + box.height - vx, rotate: degrees(270) };
  return { x: box.x + vx, y: box.y + vy, rotate: degrees(0) };
}

let doc;
try { doc = await PDFDocument.load(await fs.readFile(task.in), { ignoreEncryption: false, updateMetadata: false }); }
catch (e) { console.error(/encrypted/i.test(String(e)) ? 'ENCRYPTED' : 'UNREADABLE'); process.exit(3); }

const pages = doc.getPages();
if (pages.length > task.maxPages) { console.error(`TOOMANY ${pages.length}`); process.exit(4); }

if (task.op === 'numbers') {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const N = pages.length;
  pages.forEach((page, i) => {
    const n = i + 1;
    const text = task.format === 'n' ? String(n) : task.format === 'n/N' ? `${n} / ${N}` : `Page ${n} of ${N}`;
    const size = 10, w = font.widthOfTextAtSize(text, size);
    const { x, y, rotate } = locate(page, task.pos, w, size);
    page.drawText(text, { x, y, size, font, color: rgb(0.2, 0.2, 0.2), rotate });
  });
} else if (task.op === 'sign') {
  const targets = task.pages === 'all' ? pages : [task.pages === 'first' ? pages[0] : pages[pages.length - 1]];
  const width = { small: 110, medium: 160, large: 220 }[task.size];
  if (task.mode === 'image') {
    const png = await doc.embedPng(Buffer.from(task.image, 'base64'));
    const w = width, h = png.height * (width / png.width);
    for (const page of targets) { const { x, y, rotate } = locate(page, task.pos, w, h); page.drawImage(png, { x, y, width: w, height: h, rotate }); }
  } else {
    const fontBytes = await fs.readFile(task.fontPath);
    const fk = fontkit.create(fontBytes);
    for (const ch of task.text) { if (ch !== ' ' && !fk.hasGlyphForCodePoint(ch.codePointAt(0))) { console.error('NOGLYPH'); process.exit(5); } }
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: true });
    const size = { small: 24, medium: 34, large: 46 }[task.size];
    const w = font.widthOfTextAtSize(task.text, size), h = font.heightAtSize(size);
    for (const page of targets) {
      const { x, y, rotate } = locate(page, task.pos, w, h);
      // lift the baseline a little so descenders stay inside the box, in the direction the text is drawn
      const lift = h * 0.25, a = rotate.angle * Math.PI / 180;
      page.drawText(task.text, { x: x - Math.sin(a) * lift, y: y + Math.cos(a) * lift, size, font, color: rgb(0.08, 0.1, 0.35), rotate });
    }
  }
}
await fs.writeFile(task.out, await doc.save());
