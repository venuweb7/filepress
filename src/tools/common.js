// Helpers shared by the tools.
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { run, ToolError } from '../run.js';
import { config } from '../config.js';

export const KINDS = {
  pdf: { exts: ['pdf'], label: 'PDF' },
  image: { exts: ['jpg', 'jpeg', 'png'], label: 'JPG or PNG picture' },
  office: { exts: ['docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'], label: 'Word, Excel or PowerPoint file' },
};

export const extOf = name => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [, ''])[1];
export const baseOf = name => name.replace(/\.[a-z0-9]+$/i, '') || 'file';

/** Strip anything that is not safe in a file name; keep it short. */
export function safeName(name) {
  const cleaned = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 120);
}

export const inPath = (dir, f) => path.join(dir, 'in', f.stored);
export const outPath = (dir, name) => path.join(dir, 'out', name);
export const tmpPath = (dir, name) => path.join(dir, 'tmp', name);

export async function pageCount(pdfFile, cwd) {
  const { out } = await run('pdfinfo', [pdfFile], { cwd, timeoutSec: 60 });
  const m = out.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new ToolError('This does not look like a readable PDF.');
  return parseInt(m[1], 10);
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
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) archive.file(f, { name: path.basename(f) });
    archive.finalize();
  });
}

export const timeouts = { normal: () => config.toolTimeoutSec, heavy: () => config.heavyTimeoutSec };

export async function listDir(dir) {
  return (await fs.readdir(dir)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Pick a string option from an allowed list. */
export const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
export const bool = (v, dflt = false) => (v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 0 || v === '0' ? false : dflt);
