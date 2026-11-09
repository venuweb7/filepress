// Helpers shared by the tools.
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { run, ToolError } from '../run.js';
import { config } from '../config.js';

export const KINDS = {
  pdf: { exts: ['pdf'], label: 'PDF' },
  image: { exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif'], label: 'picture (JPG, PNG, GIF, WEBP, HEIC…)' },
  office: { exts: ['docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'], label: 'Word, Excel or PowerPoint file' },
};

export const extOf = name => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [, ''])[1];
export const baseOf = name => name.replace(/\.[a-z0-9]+$/i, '') || 'file';

/** Strip anything that is not safe in a file name or a converter's output pattern; keep it short. */
const BAD_CHARS = new Set([0x5c, 0x2f, 0x3a, 0x2a, 0x3f, 0x22, 0x3c, 0x3e, 0x7c, 0x25, 0x5b, 0x5d, 0x7b, 0x7d]); // \ / : * ? " < > | % [ ] { } (the last four are ImageMagick wildcards)
const BAD_RANGES = [[0x00, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]]; // controls, zero-width, bidi
const isBadChar = cp => BAD_CHARS.has(cp) || BAD_RANGES.some(([a, b]) => cp >= a && cp <= b);
export function safeName(name) {
  let s = '';
  for (const ch of String(name || 'file')) s += isBadChar(ch.codePointAt(0)) ? '_' : ch;
  const cleaned = s.replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 120);
}

export const inPath = (dir, f) => path.join(dir, 'in', f.stored);
export const outPath = (dir, name) => path.join(dir, 'out', name);
export const tmpPath = (dir, name) => path.join(dir, 'tmp', name);

/** Page count and the largest page area (in PDF points²) of a PDF, via pdfinfo. */
export async function pdfProbe(pdfFile, cwd) {
  const { out } = await run('pdfinfo', ['-f', '1', '-l', String(config.maxPages + 1), pdfFile], { cwd, timeoutSec: 60, memMb: 1024 });
  const m = out.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new ToolError('This does not look like a readable PDF.');
  let maxArea = 0;
  for (const [, w, h] of out.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+) pts/gm)) maxArea = Math.max(maxArea, parseFloat(w) * parseFloat(h));
  return { pages: parseInt(m[1], 10), maxArea };
}
export const pageCount = async (pdfFile, cwd) => (await pdfProbe(pdfFile, cwd)).pages;

/** Refuse page-by-page work on huge documents; the limit is configurable. */
export function assertPages(pages, what = 'This tool') {
  if (pages > config.maxPages) throw new ToolError(`${what} works on PDFs of up to ${config.maxPages} pages. This one has ${pages}.`);
}

/** Generic input check used by most tools: right kind, right count. */
export function checkKind(files, kind, { min = 1, max = 1 } = {}) {
  if (files.length < min) return min === 1 ? 'Add a file first.' : `This tool needs at least ${min} files.`;
  if (files.length > max) return max === 1 ? 'This tool works on one file at a time.' : `This tool takes up to ${max} files.`;
  const bad = files.find(f => f.kind !== kind);
  if (bad) return `"${bad.name}" is not a ${KINDS[kind].label}. This tool needs a ${KINDS[kind].label}.`;
  return null;
}

/** Zip a list of files (absolute paths) into out/<zipName>. */
export function zipFiles(files, zipAbs) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipAbs);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    output.on('error', e => { archive.abort(); reject(e); });
    archive.on('error', e => { output.destroy(); reject(e); });
    archive.pipe(output);
    for (const f of files) archive.file(f, { name: path.basename(f) });
    archive.finalize();
  });
}

/** Give each output a distinct name even when two inputs share a base name. */
export function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const ext = extOf(name), base = baseOf(name);
  for (let i = 2; ; i++) { const n = `${base}-${i}.${ext}`; if (!used.has(n)) { used.add(n); return n; } }
}

/** Width, height, transparency and frame count of a picture (first frame only is ever decoded). Refuses huge ones. */
export const MAX_PIXELS = 60e6;     // a 60 MP photo is ~340 MB in memory
export const MAX_FRAMES = 500;      // animated GIF / multi-page TIFF
export async function pictureProbe(file, dir) {
  const { out } = await run('identify', ['-ping', '-format', '%w %h %A %n %[orientation]\n', file], { cwd: dir, timeoutSec: 60, memMb: 1024 });
  const m = out.trim().split('\n')[0]?.match(/^(\d+) (\d+) (\S+) (\d+) ?(\S*)$/);
  if (!m) throw new ToolError('This does not look like a picture we can read.');
  // Phone photos are often stored sideways with a "rotate me" flag; the tools apply it (-auto-orient), so report the size as displayed.
  const sideways = ['LeftTop', 'RightTop', 'RightBottom', 'LeftBottom'].includes(m[5]);
  const w = sideways ? +m[2] : +m[1], h = sideways ? +m[1] : +m[2], frames = +m[4];
  if (w * h > MAX_PIXELS) throw new ToolError(`This picture is very large (${Math.round(w * h / 1e6)} MP). Pictures of up to ${MAX_PIXELS / 1e6} MP are supported.`);
  if (frames > MAX_FRAMES) throw new ToolError(`This picture has ${frames} frames; up to ${MAX_FRAMES} are supported.`);
  return { w, h, alpha: /true|blend/i.test(m[3]), frames };
}

export const timeouts = { normal: () => config.toolTimeoutSec, heavy: () => config.heavyTimeoutSec };

export async function listDir(dir) {
  return (await fs.readdir(dir)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Pick a string option from an allowed list. Missing = default; anything else is refused, never silently swapped. */
export function pick(v, allowed, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const s = String(v);
  if (allowed.includes(s)) return s;
  throw new ToolError(`"${s.slice(0, 40)}" is not one of the choices for this setting.`);
}
export const bool = (v, dflt = false) => (v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 0 || v === '0' ? false : dflt);
