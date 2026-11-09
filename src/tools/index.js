// The tool registry. Order here is the order shown in the app.
import compress from './compress.js';
import merge from './merge.js';
import split from './split.js';
import { pdfToWord, wordToPdf } from './convert.js';
import { pdfToJpg, jpgToPdf } from './images.js';
import ocr from './ocr.js';
import { rotate, protect } from './simple.js';
import { numbers, sign } from './stamp.js';
import { imgCompress, imgResize, imgCrop, toJpg, fromJpg, imgRotate, upscale, watermark, meme, blurFaces } from './pictures.js';

export const toolList = [
  compress, merge, split, pdfToWord, wordToPdf, pdfToJpg, jpgToPdf, ocr, sign, rotate, protect, numbers,
  imgCompress, imgResize, imgCrop, toJpg, fromJpg, imgRotate, upscale, watermark, meme, blurFaces,
];
export const tools = Object.fromEntries(toolList.map(t => [t.id, t]));
export const toolSummary = toolList.map(t => ({ id: t.id, name: t.name, accepts: t.accepts, minFiles: t.minFiles, maxFiles: t.maxFiles }));
