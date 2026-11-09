// Picture tools, all on ImageMagick (`convert`), one input picture at a time or a batch zipped together.
// Text that users type (watermark, meme captions) is escaped before it reaches ImageMagick: "%" would be
// read as an image-property escape, "\\" as a control sequence and a leading "@" as "read this file".
import fs from 'node:fs/promises';
import { run, ToolError } from '../run.js';
import { config } from '../config.js';
import { MAX_PIXELS, baseOf, checkKind, extOf, inPath, outPath, pick, pictureProbe, timeouts, tmpPath, uniqueName, zipFiles } from './common.js';

const BATCH = Math.min(20, config.maxFiles);
const FONT = 'DejaVu-Sans-Bold';   // installed in the image (fonts-dejavu-core)

const int = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
};
const CONTROL = /[\x00-\x1f\x7f]+/g;   // line breaks, tabs, NUL and friends: never part of a caption
const str = (v, max, label) => {
  const s = String(v ?? '').replace(CONTROL, ' ').trim();
  if (!s) throw new ToolError(`${label} cannot be empty.`);
  if (s.length > max) throw new ToolError(`${label} can be at most ${max} characters.`);
  return s;
};

const probe = pictureProbe;

/** The common shape: run `convert <in>[0] ...args <out>` for every input, then hand back one file or a zip. */
function pictureTool({ id, name, suffix, parseOptions, multi = true, build, outExt, check }) {
  return {
    id, name, accepts: 'image', minFiles: 1, maxFiles: multi ? BATCH : 1,
    parseOptions,
    checkInputs: files => checkKind(files, 'image', { min: 1, max: multi ? BATCH : 1 }),
    async run({ job, dir, report }) {
      const outs = [], used = new Set(), n = job.files.length;
      let note = null;
      for (const [i, f] of job.files.entries()) {
        report(10 + Math.round(80 * i / n), n > 1 ? `Picture ${i + 1} of ${n}` : 'Working on the picture');
        const info = await probe(inPath(dir, f), dir);
        const ext = outExt ? outExt(job.options, f) : keepExt(f);
        const outName = uniqueName(`${baseOf(f.name)}${suffix(job.options)}.${ext}`, used);
        const args = await build({ o: job.options, f, info, dir });
        // "[0]" = first frame only (animated GIFs become a still); -auto-orient applies the camera's rotation flag,
        // then -strip drops EXIF and friends (camera, GPS position) from every output.
        await run('convert', [`${inPath(dir, f)}[0]`, '-auto-orient', '-strip', ...args, outPath(dir, outName)], { cwd: dir, timeoutSec: timeouts.normal() });
        let finalName = outName;
        if (check) { const r = await check({ f, outName, dir, used }); if (r?.note) note = r.note; if (r?.name) finalName = r.name; }
        if (info.frames > 1 && ext === 'gif') note = note || 'Animated GIFs come back as a still picture of the first frame.';
        outs.push(finalName);
      }
      if (outs.length === 1) return { file: outs[0], name: outs[0], ...(note ? { note } : {}) };
      report(92, `Packing ${outs.length} pictures`);
      const zip = `${baseOf(job.files[0].name)}-and-${outs.length - 1}-more.zip`;
      await zipFiles(outs.map(o => outPath(dir, o)), outPath(dir, zip));
      return { file: zip, name: zip, count: outs.length };
    },
  };
}

const JPG_OUT = ['-background', 'white', '-alpha', 'remove', '-alpha', 'off'];   // flatten transparency onto white
/** Output format for tools that keep the input's: ImageMagick can read HEIC but not write it, so that (and anything odd) becomes JPG. */
const keepExt = f => { const e = extOf(f.name); return e === 'jpeg' ? 'jpg' : ['jpg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(e) ? e : 'jpg'; };
const isJpg = f => /^jpe?g$/.test(extOf(f.name));
const isPng = f => extOf(f.name) === 'png';

/* ---------- Compress picture ---------- */
const QUALITY = { smallest: 62, balanced: 76, best: 88 };
export const imgCompress = pictureTool({
  id: 'img-compress', name: 'Compress picture', suffix: () => '-compressed',
  parseOptions: o => ({ level: pick(o.level, Object.keys(QUALITY), 'balanced') }),
  // Output keeps the input format (JPG stays JPG, PNG stays PNG); other formats are re-saved as JPG.
  outExt: (o, f) => (isPng(f) ? 'png' : 'jpg'),
  build: ({ o, f }) => isPng(f)
    ? ['-strip', '-define', 'png:compression-level=9', '-define', 'png:compression-filter=5', ...(o.level === 'smallest' ? ['-colors', '256'] : o.level === 'balanced' ? ['-colors', '1024'] : [])]
    : ['-strip', ...(isJpg(f) ? [] : JPG_OUT), '-sampling-factor', '4:2:0', '-interlace', 'JPEG', '-quality', String(QUALITY[o.level])],
  // Never hand back something bigger than what came in: return the original file (in its own format) instead.
  async check({ f, outName, dir, used }) {
    const [a, b] = await Promise.all([fs.stat(inPath(dir, f)), fs.stat(outPath(dir, outName))]);
    if (b.size < a.size) return null;
    await fs.rm(outPath(dir, outName), { force: true }); used.delete(outName);
    const name = uniqueName(`${baseOf(f.name)}-compressed.${extOf(f.name)}`, used);
    await fs.copyFile(inPath(dir, f), outPath(dir, name));
    return { name, note: 'This picture was already compact, so we kept the original as it was.' };
  },
});

/* ---------- Resize ---------- */
export const imgResize = pictureTool({
  id: 'img-resize', name: 'Resize', suffix: o => (o.mode === 'percent' ? `-${o.percent}pct` : `-${o.width}x${o.height}`),
  parseOptions: o => {
    const mode = pick(o.mode, ['percent', 'pixels'], 'percent');
    if (mode === 'percent') return { mode, percent: int(o.percent, 1, 400, 'Percent') };
    return { mode, width: int(o.width, 1, 10000, 'Width'), height: int(o.height, 1, 10000, 'Height'), fit: pick(o.fit, ['inside', 'exact'], 'inside') };
  },
  build: ({ o, info }) => {
    const outPx = o.mode === 'percent' ? info.w * info.h * (o.percent / 100) ** 2 : o.width * o.height;
    if (outPx > MAX_PIXELS) throw new ToolError(`That size would be over ${MAX_PIXELS / 1e6} MP. Pick a smaller size.`);
    return o.mode === 'percent' ? ['-resize', `${o.percent}%`] : ['-resize', `${o.width}x${o.height}${o.fit === 'exact' ? '!' : ''}`];
  },
});

/* ---------- Crop (to a shape, from a chosen side; or trim away a plain border) ---------- */
const RATIOS = { square: [1, 1], '4:3': [4, 3], '3:2': [3, 2], '16:9': [16, 9], '3:4': [3, 4], '9:16': [9, 16] };
const GRAV = { center: 'Center', top: 'North', bottom: 'South', left: 'West', right: 'East' };
export const imgCrop = pictureTool({
  id: 'img-crop', name: 'Crop', suffix: () => '-cropped',
  parseOptions: o => ({ mode: pick(o.mode, ['ratio', 'trim'], 'ratio'), ratio: pick(o.ratio, Object.keys(RATIOS), 'square'), from: pick(o.from, Object.keys(GRAV), 'center') }),
  build: ({ o, info }) => {
    if (o.mode === 'trim') return ['-fuzz', '8%', '-trim', '+repage'];
    const [rw, rh] = RATIOS[o.ratio];
    // The biggest rectangle of that shape that fits inside the picture, taken from the chosen side.
    let w = info.w, h = Math.round(info.w * rh / rw);
    if (h > info.h) { h = info.h; w = Math.round(info.h * rw / rh); }
    return ['-gravity', GRAV[o.from], '-crop', `${w}x${h}+0+0`, '+repage'];
  },
});

/* ---------- Convert to JPG / from JPG ---------- */
export const toJpg = pictureTool({
  id: 'to-jpg', name: 'Convert to JPG', suffix: () => '', outExt: () => 'jpg',
  parseOptions: o => ({ quality: pick(o.quality, ['80', '90', '96'], '90') }),
  build: ({ o }) => ['-strip', ...JPG_OUT, '-sampling-factor', '4:2:0', '-quality', o.quality],
});
export const fromJpg = pictureTool({
  id: 'from-jpg', name: 'Convert from JPG', suffix: () => '', outExt: o => o.format,
  parseOptions: o => ({ format: pick(o.format, ['png', 'webp', 'gif', 'bmp', 'tiff'], 'png') }),
  build: ({ o }) => (o.format === 'webp' ? ['-quality', '90'] : o.format === 'gif' ? ['-colors', '256'] : []),
});

/* ---------- Rotate / flip ---------- */
export const imgRotate = pictureTool({
  id: 'img-rotate', name: 'Rotate picture', suffix: () => '-rotated',
  parseOptions: o => ({ turn: pick(o.turn, ['90', '-90', '180', 'flip', 'flop'], '90') }),
  build: ({ o }) => (o.turn === 'flip' ? ['-flip'] : o.turn === 'flop' ? ['-flop'] : ['-rotate', o.turn]),
});

/* ---------- Upscale (plain resampling with a light sharpen; not an AI model) ---------- */
export const upscale = pictureTool({
  id: 'upscale', name: 'Upscale', suffix: o => `-${o.factor}x`,
  parseOptions: o => ({ factor: pick(o.factor, ['2', '3', '4'], '2') }),
  build: ({ o, info }) => {
    const f = +o.factor;
    if (info.w * info.h * f * f > MAX_PIXELS) throw new ToolError(`At ${f}× this picture would be over ${MAX_PIXELS / 1e6} MP. Pick a smaller factor.`);
    return ['-filter', 'Lanczos', '-resize', `${f * 100}%`, '-unsharp', '0x0.75+0.75+0.008'];
  },
});

/* ---------- Watermark (text) ---------- */
const WM_POS = { center: 'Center', tl: 'NorthWest', tr: 'NorthEast', bl: 'SouthWest', br: 'SouthEast' };
const OPACITY = { light: 0.25, medium: 0.45, strong: 0.7 };
const imText = t => String(t).replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/^@/, '(at)');
/** Largest point size at which `text` (one line) still fits in `width` pixels, never above `pt`. */
const fitPt = (pt, text, width) => Math.max(10, Math.min(pt, Math.floor(width / (0.62 * Math.max(1, text.length)))));
/** Break a caption into at most two lines of roughly equal length (at a space). */
function twoLines(text) {
  if (text.length <= 22) return text;
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : text.slice(0, best) + '\n' + text.slice(best + 1);
}
export const watermark = pictureTool({
  id: 'watermark', name: 'Watermark', suffix: () => '-watermarked',
  parseOptions: o => ({ text: str(o.text, 60, 'The watermark text'), pos: pick(o.pos, Object.keys(WM_POS), 'center'), opacity: pick(o.opacity, Object.keys(OPACITY), 'medium'), size: pick(o.size, ['small', 'medium', 'large'], 'medium'), tile: o.tile === true || o.tile === 'true' }),
  async build({ o, info, dir }) {
    const base = Math.min(info.w, info.h);
    const a = OPACITY[o.opacity];
    const pt = fitPt(Math.max(12, Math.round(base * { small: 0.04, medium: 0.07, large: 0.11 }[o.size])), o.text, info.w * 0.9);
    const text = imText(o.text);
    const common = ['-font', FONT, '-pointsize', String(pt), '-fill', `rgba(255,255,255,${a})`, '-stroke', `rgba(0,0,0,${a * 0.6})`, '-strokewidth', String(Math.max(1, Math.round(pt / 28)))];
    if (!o.tile) {
      const margin = o.pos === 'center' ? 0 : Math.round(pt * 0.6);
      return [...common, '-gravity', WM_POS[o.pos], '-annotate', `+${margin}+${margin}`, text];
    }
    // Tiled: draw the text tilted 30° into a tile big enough for it, then lay the tile across the whole picture.
    const textW = 0.62 * pt * o.text.length, tw = Math.ceil(textW * 0.87 + pt * 0.5 + pt * 2.5), th = Math.ceil(textW * 0.5 + pt * 0.87 + pt * 2);
    const tile = tmpPath(dir, 'tile.png');
    await run('convert', ['-size', `${tw}x${th}`, 'xc:none', ...common, '-gravity', 'Center', '-annotate', '330x330+0+0', text, tile], { cwd: dir, timeoutSec: 60 });
    return ['(', '+clone', '-fill', '', '-tile', tile, '-draw', `rectangle 0,0 ${info.w},${info.h}`, ')', '-composite'];
  },
});

/* ---------- Meme (top / bottom caption) ---------- */
export const meme = pictureTool({
  id: 'meme', name: 'Meme', suffix: () => '-meme', multi: false, outExt: (o, f) => (isPng(f) ? 'png' : 'jpg'),
  parseOptions: o => {
    const top = String(o.top ?? '').replace(CONTROL, ' ').trim(), bottom = String(o.bottom ?? '').replace(CONTROL, ' ').trim();
    if (!top && !bottom) throw new ToolError('Type a top line, a bottom line, or both.');
    if (top.length > 80 || bottom.length > 80) throw new ToolError('Each caption can be at most 80 characters.');
    return { top, bottom };
  },
  async build({ o, info, dir, f }) {
    const top = twoLines(o.top.toUpperCase()), bottom = twoLines(o.bottom.toUpperCase());
    const longest = Math.max(...[...top.split('\n'), ...bottom.split('\n')].map(l => l.length));
    const pt = fitPt(Math.max(14, Math.round(Math.min(info.w, info.h) * 0.085)), 'x'.repeat(Math.round(longest * 1.18)), info.w * 0.94), margin = Math.round(pt * 0.5);   // capitals are ~18% wider
    const common = ['-font', FONT, '-pointsize', String(pt), '-interline-spacing', String(-Math.round(pt * 0.1)), '-fill', 'white', '-stroke', 'black', '-strokewidth', String(Math.max(1, Math.round(pt / 14))), '-gravity'];
    const args = [];
    if (o.top) args.push(...common, 'North', '-annotate', `+0+${margin}`, imText(top));
    if (o.bottom) args.push(...common, 'South', '-annotate', `+0+${margin}`, imText(bottom));
    return [...(isPng(f) ? [] : JPG_OUT), ...args, ...(isPng(f) ? [] : ['-quality', '92'])];
  },
});

/* ---------- Blur faces (OpenCV + the small YuNet face model shipped in assets/models, via a Python helper) ---------- */
export const blurFaces = {
  id: 'blur', name: 'Blur faces', accepts: 'image', minFiles: 1, maxFiles: BATCH,
  parseOptions: o => ({ strength: pick(o.strength, ['soft', 'normal', 'strong'], 'normal') }),
  checkInputs: files => checkKind(files, 'image', { min: 1, max: BATCH }),
  async run({ job, dir, report }) {
    const outs = [], used = new Set(), n = job.files.length;
    let found = 0;
    for (const [i, f] of job.files.entries()) {
      report(10 + Math.round(80 * i / n), n > 1 ? `Looking for faces in picture ${i + 1} of ${n}` : 'Looking for faces');
      await probe(inPath(dir, f), dir);
      // ImageMagick (the system's patched decoders) turns the upload into a plain PNG first, so OpenCV's bundled
      // decoders never parse user bytes; the camera rotation is applied and metadata dropped on the way.
      const src = tmpPath(dir, `${i}-in.png`);
      await run('convert', [`${inPath(dir, f)}[0]`, '-auto-orient', '-strip', ...(isPng(f) ? [] : JPG_OUT), src], { cwd: dir, timeoutSec: timeouts.normal() });
      const outName = uniqueName(`${baseOf(f.name)}-blurred.${isPng(f) ? 'png' : 'jpg'}`, used);
      const { out } = await run('python3', ['-I', `${config.toolsDir}/blur-faces.py`, `${config.assetsDir}/models/face_detection_yunet_2023mar.onnx`, src, outPath(dir, outName), job.options.strength],
        { cwd: dir, timeoutSec: timeouts.normal(), memMb: 4096, env: { OPENBLAS_NUM_THREADS: '2', OPENCV_IO_MAX_IMAGE_PIXELS: String(MAX_PIXELS) } });
      found += parseInt(out.trim(), 10) || 0;
      outs.push(outName);
    }
    const note = found ? `${found} face${found === 1 ? '' : 's'} blurred.` : 'No faces were found. Faces seen from the side or very small ones can be missed, so check the result.';
    if (outs.length === 1) return { file: outs[0], name: outs[0], note };
    const zip = `${baseOf(job.files[0].name)}-and-${outs.length - 1}-more.zip`;
    await zipFiles(outs.map(o => outPath(dir, o)), outPath(dir, zip));
    return { file: zip, name: zip, count: outs.length, note };
  },
};
