// Filepress front end. Plain JS, no build step. Talks to /api/* (see src/server.js).
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- catalogue (ids match src/tools) ---------- */
const I = {
  compress: '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>',
  merge: '<rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/><path d="M10 12h4"/>',
  split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  word: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="m8 17 1.5-5 1.5 3 1.5-3 1.5 5"/>',
  topdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 11v6M9 14l3 3 3-3"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  imgpdf: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  ocr: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10M7 8h6M7 16h8"/>',
  sign: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  num: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  /* picture tools */
  icompress: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 9l3 3 3-3M9 15l3-3 3 3"/>',
  resize: '<path d="M21 3h-6M21 3v6M21 3l-7 7"/><rect x="3" y="11" width="10" height="10" rx="2"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  tojpg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 12h10M13 8l4 4-4 4"/>',
  fromjpg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M17 12H7M11 8l-4 4 4 4"/>',
  edit: '<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h12M20 18h0"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  upscale: '<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M13 21h6a2 2 0 0 0 2-2v-6"/><path d="M17 3h4v4M21 3l-5 5"/>',
  bg: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13 19"/><path d="M22 21H7M5 11l9 9"/>',
  stamp: '<path d="M5 21h14M6 17h12v-3a2 2 0 0 0-2-2h-1l-1-6a2 2 0 0 0-4 0l-1 6H8a2 2 0 0 0-2 2z"/>',
  meme: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  html: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
  blur: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><path d="M9 10h.01M15 10h.01M9 15c1 1 5 1 6 0"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;
// tab: which start-page tab the tile sits in. soon: shown but not built yet. accepts (client side) only for "soon" tools.
const TOOLS = [
  /* PDF tools */
  { id: 'compress', n: 'Compress', s: 'Make it smaller', v: 'Compress', ic: 'compress', t: '#EEF3FF', c: '#2563EB', kw: 'smaller shrink size email', ing: 'Compressing', tab: 'pdf' },
  { id: 'merge', n: 'Merge', s: 'Many into one', v: 'Merge', ic: 'merge', t: '#F1EEFF', c: '#6D5BF6', kw: 'combine join together', ing: 'Merging', tab: 'pdf' },
  { id: 'split', n: 'Split', s: 'Pages out', v: 'Split', ic: 'split', t: '#FFF1E8', c: '#F97316', kw: 'pages extract cut', ing: 'Splitting', tab: 'pdf' },
  { id: 'pdf-word', n: 'PDF → Word', s: 'Make it editable', v: 'Convert', ic: 'word', t: '#E8F1FF', c: '#1D6FE8', kw: 'docx edit convert', ing: 'Converting', tab: 'pdf' },
  { id: 'word-pdf', n: 'Office → PDF', s: 'Word, Excel, PowerPoint', v: 'Convert', ic: 'topdf', t: '#FFECEC', c: '#E5484D', kw: 'docx word excel ppt convert', ing: 'Converting', tab: 'pdf' },
  { id: 'pdf-jpg', n: 'PDF → JPG', s: 'Pages to pictures', v: 'Convert', ic: 'img', t: '#EAF8EF', c: '#16A34A', kw: 'image picture photo', ing: 'Drawing pages', tab: 'pdf' },
  { id: 'jpg-pdf', n: 'JPG → PDF', s: 'Pictures to PDF', v: 'Convert', ic: 'imgpdf', t: '#E6F7F6', c: '#0EA5A4', kw: 'image picture photo scan png', ing: 'Building the PDF', tab: 'pdf' },
  { id: 'ocr', n: 'Scan → Text', s: 'Searchable (OCR)', v: 'Read text', ic: 'ocr', t: '#FFF6E0', c: '#D97706', kw: 'ocr searchable copy recognise', ing: 'Reading the scan', tab: 'pdf' },
  { id: 'sign', n: 'Sign', s: 'Add signature', v: 'Sign', ic: 'sign', t: '#FFECF3', c: '#DB2777', kw: 'signature esign', ing: 'Signing', tab: 'pdf' },
  { id: 'rotate', n: 'Rotate', s: 'Fix orientation', v: 'Rotate', ic: 'rotate', t: '#EEF1F6', c: '#475569', kw: 'turn sideways upside', ing: 'Rotating', tab: 'pdf' },
  { id: 'protect', n: 'Protect', s: 'Add a password', v: 'Protect', ic: 'lock', t: '#ECEEFF', c: '#4F46E5', kw: 'password lock encrypt', ing: 'Locking', tab: 'pdf' },
  { id: 'numbers', n: 'Page numbers', s: 'Stamp numbers', v: 'Add numbers', ic: 'num', t: '#E6F6FC', c: '#0891B2', kw: 'number stamp footer', ing: 'Numbering pages', tab: 'pdf' },
  /* Picture tools */
  { id: 'img-compress', n: 'Compress picture', s: 'Smaller, same look', v: 'Compress', ic: 'icompress', t: '#EAF8EF', c: '#16A34A', kw: 'smaller shrink photo jpg png size', ing: 'Compressing', tab: 'image' },
  { id: 'img-resize', n: 'Resize', s: 'By pixels or percent', v: 'Resize', ic: 'resize', t: '#E6F6FC', c: '#0891B2', kw: 'scale dimensions pixels percent shrink enlarge', ing: 'Resizing', tab: 'image' },
  { id: 'img-crop', n: 'Crop', s: 'Square, 16:9, trim…', v: 'Crop', ic: 'crop', t: '#E8F1FF', c: '#1D6FE8', kw: 'cut square ratio trim border', ing: 'Cropping', tab: 'image' },
  { id: 'to-jpg', n: 'Convert to JPG', s: 'PNG, WEBP, HEIC…', v: 'Convert', ic: 'tojpg', t: '#FFF6E0', c: '#D97706', kw: 'png webp heic gif tiff bmp jpeg convert', ing: 'Converting', tab: 'image' },
  { id: 'from-jpg', n: 'Convert from JPG', s: 'To PNG, WEBP, GIF…', v: 'Convert', ic: 'fromjpg', t: '#FFF1E8', c: '#F97316', kw: 'png webp gif bmp tiff convert', ing: 'Converting', tab: 'image' },
  { id: 'img-edit', n: 'Photo editor', s: 'Text, effects, frames', v: 'Edit', ic: 'edit', t: '#FFECF3', c: '#DB2777', kw: 'edit text effects frames stickers', ing: 'Editing', tab: 'image', soon: true, accepts: 'image' },
  { id: 'upscale', n: 'Upscale', s: 'Enlarge 2–4×', v: 'Upscale', ic: 'upscale', t: '#F1EEFF', c: '#6D5BF6', kw: 'enlarge bigger resolution', ing: 'Enlarging', tab: 'image', new: true },
  { id: 'remove-bg', n: 'Remove background', s: 'Cut out the subject', v: 'Remove', ic: 'bg', t: '#EEF3FF', c: '#2563EB', kw: 'background cutout transparent', ing: 'Cutting out', tab: 'image', soon: true, accepts: 'image' },
  { id: 'watermark', n: 'Watermark', s: 'Stamp text on it', v: 'Add watermark', ic: 'stamp', t: '#ECEEFF', c: '#4F46E5', kw: 'stamp copyright text logo', ing: 'Stamping', tab: 'image' },
  { id: 'meme', n: 'Meme', s: 'Caption a picture', v: 'Make the meme', ic: 'meme', t: '#FFF6E0', c: '#B45309', kw: 'caption text funny', ing: 'Captioning', tab: 'image' },
  { id: 'img-rotate', n: 'Rotate picture', s: 'Turn or flip', v: 'Rotate', ic: 'rotate', t: '#EEF1F6', c: '#475569', kw: 'turn flip mirror sideways', ing: 'Rotating', tab: 'image' },
  { id: 'html-img', n: 'Web page → picture', s: 'Paste a link, get a JPG', v: 'Capture', ic: 'html', t: '#E6F7F6', c: '#0EA5A4', kw: 'html url website screenshot', ing: 'Capturing', tab: 'image', soon: true, accepts: 'none' },
  { id: 'blur', n: 'Blur faces', s: 'Hide faces in a photo', v: 'Blur faces', ic: 'blur', t: '#FFECEC', c: '#E5484D', kw: 'privacy face anonymise hide', ing: 'Finding faces', tab: 'image', new: true },
];
const KIND_EXT = { pdf: ['pdf'], image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif'], office: ['docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'] };
const KIND_LABEL = { pdf: 'a PDF', image: 'a picture (JPG, PNG, GIF, WEBP, HEIC…)', office: 'a Word, Excel or PowerPoint file' };
const KIND_WORD = { pdf: 'PDF', image: 'picture', office: 'Office file' };
const extOf = n => (n.toLowerCase().match(/\.([a-z0-9]+)$/) || [, ''])[1];
const kindOf = n => Object.keys(KIND_EXT).find(k => KIND_EXT[k].includes(extOf(n))) || null;

/* ---------- state ---------- */
const S = {
  session: null,                // {locked, appName, limits, tools}
  files: [],                    // File objects waiting to be uploaded
  fromJob: null,                // {id, name, size} when chaining a previous result
  tool: null, opts: {},         // chosen tool; options kept PER TOOL id so they never leak between tools
  job: null, poll: null, timer: null, xhr: null, gen: 0,
  tab: 'pdf',                   // start page: which tool tab is open
  showAll: false,               // work page: show tools that do not fit the dropped file too
  cd: null, autoDone: new Set(), // result page: 5-second auto-download, once per job
};
const opt = () => (S.tool ? (S.opts[S.tool.id] ??= {}) : {});
const serverTool = id => (S.session?.tools || []).find(t => t.id === id);
const retention = () => S.session?.limits.retentionMin || 60;

/* ---------- previews: rendered right here in the browser, nothing is uploaded for this ---------- */
const thumbs = new WeakMap();   // File -> {url, pages, pending}
let pdfjsP = null;
const pdfjs = () => (pdfjsP ??= import('/vendor/pdfjs/build/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs'; return m; }));
async function renderPdfThumb(data) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data, isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, wasmUrl: '/vendor/pdfjs/wasm/', iccUrl: '/vendor/pdfjs/iccs/' });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 260 / base.width });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return { url: cv.toDataURL('image/jpeg', 0.82), pages: doc.numPages };
  } finally { task.destroy().catch(() => {}); }
}
function ensureThumb(file) {
  if (!file || thumbs.has(file)) return;
  const entry = { url: null, pages: null, pending: true }; thumbs.set(file, entry);
  (async () => {
    try {
      const kind = kindOf(file.name);
      if (kind === 'image') entry.url = URL.createObjectURL(file);
      else if (kind === 'pdf' && file.size <= 80 * 1048576) Object.assign(entry, await renderPdfThumb(new Uint8Array(await file.arrayBuffer())));
    } catch (e) { console.warn('No preview for this file:', e?.message || e); }
    entry.pending = false;
    paintThumbs();
  })();
}
/** Put finished previews into the rows and cards already on screen, without re-animating the list. */
function paintThumbs() {
  const list = currentList();
  $$('#files .file, #ocards .ocard').forEach(el => {
    const f = list[+el.dataset.fi]; const t = f && thumbs.get(f.file || f); if (!t?.url) return;
    const box = el.querySelector('.th, .opv'); if (!box || box.querySelector('img')) return;
    box.insertAdjacentHTML('afterbegin', `<img class="pv" src="${t.url}" alt="">`);
    const small = el.querySelector('.nm small'); if (small && t.pages && !/page/.test(small.textContent)) small.textContent += ` · ${t.pages} page${t.pages > 1 ? 's' : ''}`;
  });
}
const currentList = () => (S.fromJob ? [{ name: S.fromJob.name, size: S.fromJob.size, chained: true, file: S.fromJob.file }] : S.files);

/** Drag-to-reorder for a container of items with data-fi. Vertical lists move by their handle; the strip by the whole card. */
function sortable(container, sel, { horizontal, handle }) {
  let drag = null;
  container.addEventListener('pointerdown', e => {
    const item = e.target.closest(sel); if (!item || e.button) return;
    if (handle && !e.target.closest(handle)) return;
    e.preventDefault(); drag = { item, id: e.pointerId, moved: false };
    item.setPointerCapture(e.pointerId); item.classList.add('dragging');
  });
  container.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return; drag.moved = true;
    const parent = drag.item.parentNode, others = [...parent.querySelectorAll(sel)].filter(x => x !== drag.item);
    const before = others.find(x => { const r = x.getBoundingClientRect(); return horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2; });
    if (before) { if (before !== drag.item.nextSibling) parent.insertBefore(drag.item, before); } else if (parent.lastElementChild !== drag.item) parent.appendChild(drag.item);
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const { item, moved } = drag; drag = null; item.classList.remove('dragging');
    if (!moved) return;
    const order = [...item.parentNode.querySelectorAll(sel)].map(x => +x.dataset.fi);
    S.files = order.map(i => S.files[i]); renderWork();
  };
  container.addEventListener('pointerup', end); container.addEventListener('pointercancel', end);
}

/* ---------- boot ---------- */
async function loadSession() {
  const r = await fetch('/api/session', { cache: 'no-store' });
  S.session = await r.json();
  $$('[data-app-name]').forEach(e => e.textContent = S.session.appName);
  $$('[data-retention]').forEach(e => e.textContent = S.session.limits.retentionMin);
  $$('[data-maxmb]').forEach(e => e.textContent = S.session.limits.maxFileMb);
  document.title = `${S.session.appName} · PDF and picture tools, private by design`;
  $('#gate').hidden = !S.session.locked;
  if (S.session.locked) setTimeout(() => $('#gateCode').focus(), 50);
}
$('#gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('#gateCode').value }) });
  if (r.ok) { $('#gateErr').hidden = true; await loadSession(); route(); }
  else { const j = await r.json().catch(() => ({})); $('#gateErr').textContent = j.error || 'That code is not right.'; $('#gateErr').hidden = false; $('#gateCode').select(); }
});

/* ---------- orbit (start page decoration) ---------- */
const OK = ['compress', 'merge', 'split', 'word', 'img', 'sign', 'lock', 'ocr'];
$('#orbit').innerHTML = `<svg class="ring"><ellipse/></svg>` + OK.map((k, i) => `<div class="ob" data-i="${i}"><div class="obi">${svg(k)}</div></div>`).join('');
$$('#orbit .ob').forEach(el => el.style.animationDelay = `${-(el.dataset.i / OK.length * 44).toFixed(2)}s`);
function fitOrbit() {
  const o = $('#orbit'), w = o.offsetWidth, h = o.offsetHeight; if (!w) return;
  const cx = w / 2, cy = h / 2, rx = cx + 64, ry = cy + (innerHeight <= 800 ? 6 : 14);   // flat enough that the chips clear the tool tabs below
  const d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 1 ${2 * rx} 0 a ${rx} ${ry} 0 1 1 ${-2 * rx} 0`;
  $$('#orbit .ob').forEach(el => el.style.offsetPath = `path("${d}")`);
  const sv = o.querySelector('svg'); sv.setAttribute('width', w); sv.setAttribute('height', h); sv.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const e = sv.querySelector('ellipse'); e.setAttribute('cx', cx); e.setAttribute('cy', cy); e.setAttribute('rx', rx); e.setAttribute('ry', ry);
}
addEventListener('resize', fitOrbit);

/* ---------- tiles ---------- */
function tile(t, href, cls = '') {
  const a = document.createElement('a');
  a.className = `tile${cls}`; a.href = href; a.dataset.id = t.id;
  a.style.setProperty('--t', t.t); a.style.setProperty('--c', t.c);
  if (t.soon) a.classList.add('soon');
  a.innerHTML = `<span class="ic">${svg(t.ic)}</span><b>${t.n}</b><small>${t.s}</small>${t.soon ? '<span class="new">Soon</span>' : t.new ? '<span class="new">New</span>' : ''}`;
  return a;
}
function fillTiles(el, hrefOf, clsOf = () => '', list = TOOLS) { el.replaceChildren(...list.map(t => tile(t, hrefOf(t), clsOf(t)))); }
/* start page: two tabs, PDF tools and picture tools */
function renderTiles0() {
  const list = TOOLS.filter(t => t.tab === S.tab);
  fillTiles($('#tiles0'), t => `#work/${t.id}`, () => '', list); $('#tiles0').classList.toggle('seven', list.length > 12);
  $$('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === S.tab); b.setAttribute('aria-selected', b.dataset.tab === S.tab); });
}
$('#nPdf').textContent = TOOLS.filter(t => t.tab === 'pdf').length; $('#nImg').textContent = TOOLS.filter(t => t.tab === 'image').length;
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.tab; renderTiles0(); });
renderTiles0();

/** Which kind do the current inputs have? null when mixed or empty. */
function inputKind() {
  const kinds = new Set(S.fromJob ? [kindOf(S.fromJob.name)] : S.files.map(f => kindOf(f.name)));
  return kinds.size === 1 ? [...kinds][0] : null;
}
const inputCount = () => (S.fromJob ? 1 : S.files.length);
/** Could this tool take the current files at all (right kind, not too many)? Used to dim tiles. */
function kindFits(t) {
  const k = inputKind(), n = inputCount();
  const st = serverTool(t.id);
  if (!st) return !n || t.accepts === k;   // "soon" tools: sorted by the kind they will take
  // Office files may go to any PDF tool: the server turns them into PDFs first.
  if (k === 'office' && st.id === 'pdf-word') return false;   // Word -> PDF -> Word again makes no sense
  const accepts = k === 'office' && st.accepts === 'pdf' && st.id !== 'word-pdf' ? 'office' : st.accepts;
  return !n || (k === accepts && n <= st.maxFiles);
}
/** Will the server have to turn Office files into PDFs before this tool runs? */
const viaOffice = t => inputKind() === 'office' && serverTool(t.id)?.accepts === 'pdf' && t.id !== 'word-pdf';
/** Can the job actually run right now (also enough files)? Used for the Run button. */
function canRun(t) {
  const st = serverTool(t.id); if (!st) return inputCount() > 0;
  return kindFits(t) && inputCount() >= st.minFiles;
}
function suggestion() {
  if (S.tool || !inputCount()) return null;
  const k = inputKind(), total = S.files.reduce((a, f) => a + f.size, 0);
  if (k === 'office') return 'word-pdf';
  if (k === 'image') return inputCount() > 1 ? 'jpg-pdf' : total > 1.5e6 ? 'img-compress' : null;
  if (k === 'pdf' && inputCount() > 1) return 'merge';
  if (k === 'pdf' && total > 1.5e6) return 'compress';
  return null;
}
function renderTiles1() {
  const sug = suggestion(), k = inputKind();
  // Tools that cannot take the dropped file are hidden, not just greyed out; a line underneath lets you see them anyway.
  const hideMisfits = !!k && !S.showAll;
  fillTiles($('#tiles1'), t => `#work/${t.id}`, t => (S.tool?.id === t.id ? ' on' : '') + (sug === t.id ? ' sug' : '') + (kindFits(t) || S.tool?.id === t.id ? '' : hideMisfits ? ' off' : ' dim'));
  $$('#tiles1 .tile.dim').forEach(el => { const st = serverTool(el.dataset.id); el.title = st ? `Needs ${KIND_LABEL[st.accepts]}${st.maxFiles === 1 ? ', one at a time' : ''}` : ''; });
  $('#workQ').textContent = k ? `What do you want to do with ${inputCount() > 1 ? 'these' : 'this'} ${KIND_WORD[k]}${inputCount() > 1 ? 's' : ''}?` : 'What do you want to do?';
  const hidden = $$('#tiles1 .tile.off').length, more = $('#more');
  more.hidden = !k;
  if (k) more.innerHTML = hideMisfits
    ? `${hidden} tool${hidden === 1 ? '' : 's'} for other kinds of files hidden · <button type="button" id="showAll">Show everything</button>`
    : `Showing every tool · <button type="button" id="showAll">Only tools that fit this ${KIND_WORD[k]}</button>`;
  $('#showAll')?.addEventListener('click', () => { S.showAll = !S.showAll; renderTiles1(); });
  filter();
}
function filter() {
  const q = $('#q').value.trim().toLowerCase(); let n = 0;
  $$('#tiles1 .tile').forEach(el => { const t = TOOLS.find(x => x.id === el.dataset.id); const hit = !q || (t.n + ' ' + t.s + ' ' + t.kw).toLowerCase().includes(q); el.classList.toggle('hide', !hit); if (hit && !el.classList.contains('off')) n++; });
  $('#empty').classList.toggle('on', !n);
}
$('#q').addEventListener('input', filter);

/* ---------- routing ---------- */
function setView(v) {
  $$('section[data-view]').forEach(s => s.classList.toggle('on', s.dataset.view === v));
  $$('#crumbs span').forEach(s => s.classList.toggle('on', s.dataset.s === (v === 'run' ? 'work' : v)));
  window.scrollTo(0, 0);
  if (v === 'start') requestAnimationFrame(fitOrbit);
}
function stopPolling() { S.gen++; clearInterval(S.poll); S.poll = null; clearInterval(S.timer); S.timer = null; clearInterval(S.cd); S.cd = null; }
function route() {
  const h = location.hash || '#start';
  const [, view, arg] = h.match(/^#(\w+)(?:\/([\w-]+))?/) || [, 'start'];
  stopPolling();
  if (S.xhr && view !== 'run') { S.xhr.abort(); S.xhr = null; }   // leaving the run view cancels an upload in progress
  if (view === 'work') {
    let t = arg ? TOOLS.find(x => x.id === arg) || null : null;
    if (t?.soon) { toast(`${t.n} is coming soon`); t = null; history.replaceState(null, '', '#work'); }
    S.tool = t; setView('work'); renderWork();
    if (arg && innerWidth <= 720) setTimeout(() => $('#opts').scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return;
  }
  if (view === 'run' && arg) { setView('run'); watchJob(arg); return; }
  if (view === 'done' && arg) { setView('done'); showDone(arg); return; }
  S.files = []; S.fromJob = null; S.tool = null; S.opts = {}; S.job = null; S.showAll = false;
  setView('start');
}
addEventListener('hashchange', route);

/* ---------- files ---------- */
function addFiles(list) {
  const max = S.session?.limits.maxFileMb || 200, maxFiles = S.session?.limits.maxFiles || 20;
  let added = 0, skipped = [];
  for (const f of list) {
    if (!kindOf(f.name)) { skipped.push(`${f.name} (type not supported)`); continue; }
    if (f.size > max * 1048576) { skipped.push(`${f.name} (over ${max} MB)`); continue; }
    if (S.files.length >= maxFiles) { skipped.push(`${f.name} (limit ${maxFiles} files)`); continue; }
    S.files.push(f); added++;
  }
  if (added) S.fromJob = null;   // real files replace a chained result; a rejected drop leaves it alone
  if (skipped.length) toast(`Skipped: ${skipped.slice(0, 2).join(', ')}${skipped.length > 2 ? ` +${skipped.length - 2} more` : ''}`, 4200);
  else if (added) toast(`${added} file${added > 1 ? 's' : ''} added`);
  return added;
}
for (const [dropSel, inputSel, goWork, fresh] of [['#drop0', '#file0', true, false], ['#add1', '#file1', false, false], ['#drop2', '#file2', true, true]]) {
  const d = $(dropSel), inp = $(inputSel);
  const reset = () => { if (fresh) { S.files = []; S.fromJob = null; S.tool = null; S.opts = {}; S.showAll = false; } };
  inp.addEventListener('change', () => { if (!inp.files.length) return; reset(); addFiles(inp.files); inp.value = ''; if (goWork) location.hash = S.tool ? `#work/${S.tool.id}` : '#work'; else renderWork(); });
  ['dragenter', 'dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; reset(); addFiles(e.dataTransfer.files); if (goWork) location.hash = '#work'; else renderWork(); });
}

/* ---------- work view ---------- */
let sortablesReady = false;
function renderWork() {
  const list = currentList();
  const k = inputKind();
  list.forEach(f => ensureThumb(f.file || f));
  const multi = !S.fromJob && list.length > 1;
  $('#files').replaceChildren(...list.map((f, i) => {
    const el = document.createElement('div'); el.className = 'file'; el.dataset.fi = i; el.style.animationDelay = `${i * 0.05}s`;
    const kind = kindOf(f.name), bad = S.tool && serverTool(S.tool.id) && kind !== serverTool(S.tool.id).accepts && !(kind === 'office' && viaOffice(S.tool));
    if (bad) el.classList.add('bad');
    const t = thumbs.get(f.file || f), ext = esc(extOf(f.name) || 'file');
    el.innerHTML = `${multi ? '<span class="hdl" data-hdl title="Drag to reorder">⋮⋮</span>' : ''}<div class="th">${t?.url ? `<img class="pv" src="${t.url}" alt="">` : ''}<i>${ext}</i></div><div class="nm"><b>${esc(f.name)}</b><small>${fmt(f.size)}${t?.pages ? ` · ${t.pages} page${t.pages > 1 ? 's' : ''}` : ''}${f.chained ? ' · result of the last job' : ''}</small></div>
      <div class="ctl">${multi ? `<button data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button data-dn="${i}" aria-label="Move down" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>` : ''}<button class="x" data-rm="${i}" aria-label="Remove"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
    return el;
  }));
  // page-order strip: big previews you can drag, shown when the chosen tool joins several files
  const joins = multi && S.tool && (serverTool(S.tool.id)?.maxFiles || 1) > 1;
  $('#order').hidden = !joins;
  if (joins) $('#ocards').replaceChildren(...list.map((f, i) => {
    const el = document.createElement('div'); el.className = 'ocard'; el.dataset.fi = i;
    const t = thumbs.get(f.file || f), ext = esc(extOf(f.name) || 'file');
    el.innerHTML = `<span class="n">${i + 1}</span><div class="opv">${t?.url ? `<img class="pv" src="${t.url}" alt="">` : ext}</div><small>${esc(f.name)}</small>`;
    return el;
  }));
  if (!sortablesReady) { sortable($('#files'), '.file', { horizontal: false, handle: '[data-hdl]' }); sortable($('#ocards'), '.ocard', { horizontal: true }); sortablesReady = true; }
  $('#fCount').textContent = `${list.length} file${list.length === 1 ? '' : 's'}`;
  $$('[data-rm]').forEach(x => x.addEventListener('click', () => { if (S.fromJob) S.fromJob = null; else S.files.splice(+x.dataset.rm, 1); renderWork(); }));
  $$('[data-up]').forEach(x => x.addEventListener('click', () => { const i = +x.dataset.up; [S.files[i - 1], S.files[i]] = [S.files[i], S.files[i - 1]]; renderWork(); }));
  $$('[data-dn]').forEach(x => x.addEventListener('click', () => { const i = +x.dataset.dn; [S.files[i + 1], S.files[i]] = [S.files[i], S.files[i + 1]]; renderWork(); }));
  const warn = $('#fileWarn'), st = S.tool && serverTool(S.tool.id);
  if (list.length && !k) { warn.textContent = 'These files are of different types. Use one type per job.'; warn.hidden = false; }
  else if (st && list.length && !kindFits(S.tool)) { warn.textContent = `${S.tool.n} needs ${KIND_LABEL[st.accepts]}${st.maxFiles === 1 ? ', one at a time' : ''}.`; warn.hidden = false; }
  else if (st && list.length && list.length < st.minFiles) { warn.textContent = `${S.tool.n} needs at least ${st.minFiles} files. Add ${st.minFiles - list.length} more.`; warn.hidden = false; }
  else if (st && list.length && viaOffice(S.tool)) { warn.textContent = `Your ${list.length > 1 ? 'files are' : 'file is'} turned into a PDF first, then ${S.tool.n} runs on it.`; warn.hidden = false; warn.classList.add('note'); }
  else warn.hidden = true;
  if (!warn.hidden && !(st && list.length && viaOffice(S.tool))) warn.classList.remove('note');
  renderTiles1();
  const t = S.tool, opts = $('#opts');
  if (!t) { opts.classList.remove('on'); $('#act').hidden = true; $('#sticky').hidden = true; return; }
  renderOpts(t); opts.classList.add('on');
  $('#act').hidden = false; $('#sticky').hidden = false;
  $('#go').innerHTML = `${t.v}${list.length > 1 ? ` ${list.length} files` : ''} <span class="ar">→</span>`; $('#go2').textContent = `${t.v} →`;
  est();
}
const LV = [{ k: 'smallest', n: 'Smallest', p: .86, d: 'Smallest file. Photos visibly softer, text still crisp.' }, { k: 'balanced', n: 'Balanced', p: .71, d: 'Email-ready. Text stays sharp, photos a touch softer.' }, { k: 'best', n: 'Best', p: .35, d: 'Looks identical. Only trims the fat.' }];
const seg = (name, items, value, cls = '') => `<div class="seg ${cls} c${items.length}" data-seg="${name}"><div class="hl"></div>${items.map(it => `<button type="button" class="${it.v === value ? 'on' : ''}" data-v="${esc(it.v)}">${esc(it.n)}${it.s ? `<small>${esc(it.s)}</small>` : ''}</button>`).join('')}</div>`;
const sw = (name, on) => `<button type="button" class="sw ${on ? 'on' : ''}" data-sw="${name}" role="switch" aria-checked="${on}"></button>`;
const hint = t => `<p class="hint"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span id="hintText">${esc(t)}</span></p>`;

function renderOpts(t) {
  const b = $('#optin'), o = opt();
  const head = `<h6><i class="toolic">${svg(t.ic)}</i>${t.n} settings</h6>`;
  const total = S.fromJob ? S.fromJob.size : S.files.reduce((a, f) => a + f.size, 0);
  let html = head;
  switch (t.id) {
    case 'compress': o.level ??= 'balanced';
      html += seg('level', LV.map(l => ({ v: l.k, n: l.n, s: total ? `≈ ${fmt(total * (1 - l.p))}` : '' })), o.level) + hint(LV.find(l => l.k === o.level).d); break;
    case 'merge': o.divider ??= false;
      html += `<div class="row"><span>Order</span><b>As shown · drag the cards or use the arrows</b></div><div class="row"><span>Blank page between files</span>${sw('divider', o.divider)}</div>`; break;
    case 'split': o.mode ??= 'ranges'; o.ranges ??= ''; o.every ??= 2;
      html += seg('mode', [{ v: 'ranges', n: 'Pick pages', s: 'e.g. 1-3, 7' }, { v: 'each', n: 'Every page', s: 'one file each' }, { v: 'every', n: 'Every N pages', s: 'chunks' }], o.mode);
      if (o.mode === 'ranges') html += `<div class="field"><label for="f_ranges">Pages to keep</label><input id="f_ranges" data-opt="ranges" inputmode="numeric" placeholder="1-3, 7" value="${esc(o.ranges)}"></div>`;
      if (o.mode === 'every') html += `<div class="field"><label for="f_every">Pages per file</label><input id="f_every" data-opt="every" type="number" min="1" max="500" value="${esc(o.every)}"></div>`;
      break;
    case 'pdf-jpg': o.dpi ??= '150';
      html += seg('dpi', [{ v: '100', n: 'Small', s: '100 dpi' }, { v: '150', n: 'Normal', s: '150 dpi' }, { v: '300', n: 'Sharp', s: '300 dpi' }], o.dpi) + hint('One JPG per page. Several pages come as a ZIP.'); break;
    case 'jpg-pdf': o.pagesize ??= 'auto';
      html += seg('pagesize', [{ v: 'auto', n: 'Picture size', s: 'no borders' }, { v: 'A4', n: 'A4 pages', s: 'fit inside' }, { v: 'Letter', n: 'Letter', s: 'fit inside' }], o.pagesize) + hint('Pictures are placed one per page, in the order listed.'); break;
    case 'ocr': o.langs ??= ['eng', 'tel']; o.deskew ??= true;
      html += `<div class="sub">Languages in the scan</div><div class="chk"><label><input type="checkbox" data-lang="eng" ${o.langs.includes('eng') ? 'checked' : ''}>English</label><label><input type="checkbox" data-lang="tel" ${o.langs.includes('tel') ? 'checked' : ''}>Telugu</label></div>
        <div class="row"><span>Straighten crooked pages</span>${sw('deskew', o.deskew)}</div>` + hint('The scan stays as it is. An invisible text layer is added so you can search and copy.'); break;
    case 'sign': o.mode ??= 'text'; o.text ??= ''; o.image ??= ''; o.pages ??= 'last'; o.pos ??= 'br'; o.size ??= 'medium';
      html += seg('mode', [{ v: 'text', n: 'Type it' }, { v: 'image', n: 'Draw it' }], o.mode, 'slim');
      if (o.mode === 'text') html += `<div class="field"><label for="f_text">Name to sign with</label><input id="f_text" data-opt="text" maxlength="60" placeholder="Your name" value="${esc(o.text)}"></div><div class="sigprev" id="sigprev">${esc(o.text)}</div>`;
      else html += `<div class="sigpad" id="sigpad"><canvas id="sigcv" width="800" height="320"></canvas><div class="ph" id="sigph" ${o.image ? 'hidden' : ''}>Draw your signature here</div><button type="button" class="clear" id="sigclear">Clear</button></div>`;
      html += `<div class="sub">Where</div>` + seg('pages', [{ v: 'last', n: 'Last page' }, { v: 'first', n: 'First page' }, { v: 'all', n: 'Every page' }], o.pages, 'slim')
        + `<div class="sub">Corner</div>` + seg('pos', [{ v: 'bl', n: 'Bottom left' }, { v: 'bc', n: 'Bottom middle' }, { v: 'br', n: 'Bottom right' }, { v: 'tl', n: 'Top left' }, { v: 'tr', n: 'Top right' }], o.pos, 'slim')
        + `<div class="sub">Size</div>` + seg('size', [{ v: 'small', n: 'Small' }, { v: 'medium', n: 'Medium' }, { v: 'large', n: 'Large' }], o.size, 'slim');
      break;
    case 'rotate': o.angle ??= '+90';
      html += seg('angle', [{ v: '+90', n: '90° right', s: '↻' }, { v: '-90', n: '90° left', s: '↺' }, { v: '+180', n: 'Upside down', s: '180°' }], o.angle); break;
    case 'protect': o.password ??= ''; o.password2 ??= '';
      html += `<div class="fieldrow"><div class="field"><label for="f_pw">Password</label><div class="pw"><input id="f_pw" data-opt="password" type="password" minlength="4" maxlength="64" autocomplete="new-password" value="${esc(o.password)}"><button type="button" id="pwShow">Show</button></div></div>
        <div class="field"><label for="f_pw2">Again, to be sure</label><input id="f_pw2" data-opt="password2" type="password" maxlength="64" autocomplete="new-password" value="${esc(o.password2)}"></div></div>` + hint('Anyone opening the PDF will need this password. It is used once and not stored.'); break;
    case 'numbers': o.pos ??= 'bc'; o.format ??= 'n';
      html += `<div class="sub">Style</div>` + seg('format', [{ v: 'n', n: '1', s: 'just the number' }, { v: 'n/N', n: '1 / 12', s: 'with total' }, { v: 'Page n of N', n: 'Page 1 of 12', s: 'in words' }], o.format)
        + `<div class="sub">Position</div>` + seg('pos', [{ v: 'bl', n: 'Bottom left' }, { v: 'bc', n: 'Bottom middle' }, { v: 'br', n: 'Bottom right' }, { v: 'tc', n: 'Top middle' }, { v: 'tr', n: 'Top right' }], o.pos, 'slim'); break;
    case 'img-compress': o.level ??= 'balanced';
      html += seg('level', [{ v: 'smallest', n: 'Smallest', s: 'visibly softer' }, { v: 'balanced', n: 'Balanced', s: 'hard to tell' }, { v: 'best', n: 'Best', s: 'just trims the fat' }], o.level) + hint('JPG stays JPG and PNG stays PNG. Camera details (EXIF) are removed, which also saves space.'); break;
    case 'img-resize': o.mode ??= 'percent'; o.percent ??= '50'; o.width ??= '1920'; o.height ??= '1080'; o.fit ??= 'inside';
      html += seg('mode', [{ v: 'percent', n: 'By percent' }, { v: 'pixels', n: 'By pixels' }], o.mode, 'slim');
      if (o.mode === 'percent') html += `<div class="sub">Scale</div>` + seg('percent', [{ v: '25', n: '25%' }, { v: '50', n: '50%' }, { v: '75', n: '75%' }, { v: '150', n: '150%' }, { v: '200', n: '200%' }], String(o.percent), 'slim');
      else html += `<div class="fieldrow"><div class="field"><label for="f_w">Width (px)</label><input id="f_w" data-opt="width" type="number" inputmode="numeric" min="1" max="10000" value="${esc(o.width)}"></div><div class="field"><label for="f_h">Height (px)</label><input id="f_h" data-opt="height" type="number" inputmode="numeric" min="1" max="10000" value="${esc(o.height)}"></div></div>`
        + `<div class="sub">Shape</div>` + seg('fit', [{ v: 'inside', n: 'Keep proportions', s: 'fits inside the box' }, { v: 'exact', n: 'Exactly this size', s: 'may stretch' }], o.fit);
      break;
    case 'img-crop': o.mode ??= 'ratio'; o.ratio ??= 'square'; o.from ??= 'center';
      html += seg('mode', [{ v: 'ratio', n: 'Cut to a shape' }, { v: 'trim', n: 'Trim plain borders' }], o.mode, 'slim');
      if (o.mode === 'ratio') html += `<div class="sub">Shape</div>` + seg('ratio', [{ v: 'square', n: '1:1' }, { v: '4:3', n: '4:3' }, { v: '3:2', n: '3:2' }, { v: '16:9', n: '16:9' }, { v: '3:4', n: '3:4' }, { v: '9:16', n: '9:16' }], o.ratio, 'slim')
        + `<div class="sub">Keep which part</div>` + seg('from', [{ v: 'center', n: 'Middle' }, { v: 'top', n: 'Top' }, { v: 'bottom', n: 'Bottom' }, { v: 'left', n: 'Left' }, { v: 'right', n: 'Right' }], o.from, 'slim') + hint('The biggest rectangle of that shape that fits in the picture is kept.');
      else html += hint('Removes a plain-coloured frame around the picture (white or black edges, scanner borders).');
      break;
    case 'to-jpg': o.quality ??= '90';
      html += seg('quality', [{ v: '80', n: 'Smaller', s: '80' }, { v: '90', n: 'Normal', s: '90' }, { v: '96', n: 'Sharpest', s: '96' }], o.quality) + hint('Transparent areas become white. Animated GIFs keep only their first frame.'); break;
    case 'from-jpg': o.format ??= 'png';
      html += seg('format', [{ v: 'png', n: 'PNG' }, { v: 'webp', n: 'WEBP' }, { v: 'gif', n: 'GIF' }, { v: 'bmp', n: 'BMP' }, { v: 'tiff', n: 'TIFF' }], o.format, 'slim'); break;
    case 'img-rotate': o.turn ??= '90';
      html += seg('turn', [{ v: '90', n: '90° right', s: '↻' }, { v: '-90', n: '90° left', s: '↺' }, { v: '180', n: 'Upside down', s: '180°' }, { v: 'flop', n: 'Mirror', s: 'left ↔ right' }, { v: 'flip', n: 'Flip', s: 'top ↔ bottom' }], o.turn); break;
    case 'upscale': o.factor ??= '2';
      html += seg('factor', [{ v: '2', n: '2×', s: 'twice as wide' }, { v: '3', n: '3×' }, { v: '4', n: '4×' }], o.factor) + hint('Plain enlargement with a light sharpen — good for printing or slides. It does not invent new detail like an AI upscaler.'); break;
    case 'watermark': o.text ??= ''; o.pos ??= 'center'; o.opacity ??= 'medium'; o.size ??= 'medium'; o.tile ??= false;
      html += `<div class="field"><label for="f_wm">Text</label><input id="f_wm" data-opt="text" maxlength="60" placeholder="© Your name" value="${esc(o.text)}"></div>`
        + `<div class="row"><span>Repeat across the whole picture</span>${sw('tile', o.tile)}</div>`
        + (o.tile ? '' : `<div class="sub">Where</div>` + seg('pos', [{ v: 'center', n: 'Middle' }, { v: 'tl', n: 'Top left' }, { v: 'tr', n: 'Top right' }, { v: 'bl', n: 'Bottom left' }, { v: 'br', n: 'Bottom right' }], o.pos, 'slim'))
        + `<div class="sub">Strength</div>` + seg('opacity', [{ v: 'light', n: 'Light' }, { v: 'medium', n: 'Medium' }, { v: 'strong', n: 'Strong' }], o.opacity, 'slim')
        + `<div class="sub">Size</div>` + seg('size', [{ v: 'small', n: 'Small' }, { v: 'medium', n: 'Medium' }, { v: 'large', n: 'Large' }], o.size, 'slim');
      break;
    case 'meme': o.top ??= ''; o.bottom ??= '';
      html += `<div class="field"><label for="f_top">Top line</label><input id="f_top" data-opt="top" maxlength="80" placeholder="WHEN THE FILE" value="${esc(o.top)}"></div><div class="field"><label for="f_bottom">Bottom line</label><input id="f_bottom" data-opt="bottom" maxlength="80" placeholder="IS FINALLY SMALL ENOUGH" value="${esc(o.bottom)}"></div>` + hint('Classic white capitals with a black outline. Long lines wrap onto two rows.'); break;
    case 'blur': o.strength ??= 'normal';
      html += seg('strength', [{ v: 'soft', n: 'Soft' }, { v: 'normal', n: 'Normal' }, { v: 'strong', n: 'Strong' }], o.strength) + hint('Faces are found on our server with a small open-source model; nothing is sent anywhere else. Faces seen from the side or very small ones can be missed, so check the result.'); break;
    default:
      html += `<div class="row"><span>Settings</span><b>None needed</b></div>` + hint(t.id === 'pdf-word' ? 'Text and layout are rebuilt into an editable Word file. Scanned PDFs need "Scan → Text" first.' : 'Word, Excel and PowerPoint files become PDFs that look like the printout.');
  }
  b.innerHTML = html;
  const ic = b.querySelector('.toolic'); ic.style.setProperty('--t', t.t); ic.style.setProperty('--c', t.c);
  // wire controls
  $$('#optin .seg').forEach(sg => sg.addEventListener('click', e => { const x = e.target.closest('button'); if (!x) return; o[sg.dataset.seg] = x.dataset.v; renderOpts(t); est(); }));
  $$('#optin [data-sw]').forEach(s => s.addEventListener('click', () => { o[s.dataset.sw] = !o[s.dataset.sw]; renderOpts(t); }));
  $$('#optin [data-opt]').forEach(inp => inp.addEventListener('input', () => { o[inp.dataset.opt] = inp.value; inp.classList.remove('err'); if (inp.dataset.opt === 'text' && $('#sigprev')) $('#sigprev').textContent = inp.value; est(); }));
  $$('#optin [data-lang]').forEach(c => c.addEventListener('change', () => { o.langs = $$('#optin [data-lang]:checked').map(x => x.dataset.lang); }));
  $('#pwShow')?.addEventListener('click', () => { const i = $('#f_pw'); i.type = i.type === 'password' ? 'text' : 'password'; $('#pwShow').textContent = i.type === 'password' ? 'Show' : 'Hide'; });
  if ($('#sigcv')) sigPad($('#sigcv'), o);
  requestAnimationFrame(() => $$('#optin .seg').forEach(moveHl));
}
function moveHl(sg) { const on = sg.querySelector('button.on'), hl = sg.querySelector('.hl'); if (!on) return; hl.style.width = on.offsetWidth + 'px'; hl.style.transform = `translateX(${on.offsetLeft - 4}px)`; }
addEventListener('resize', () => $$('#optin .seg').forEach(moveHl));

/** A tiny drawing pad that stores a PNG data URL in o.image. */
function sigPad(cv, o) {
  const ctx = cv.getContext('2d'); ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14195A';
  if (o.image) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0); im.src = o.image; }
  let drawing = false, last = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.addEventListener('pointerdown', e => { drawing = true; last = pt(e); cv.setPointerCapture(e.pointerId); $('#sigph').hidden = true; });
  cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
  const up = () => { if (!drawing) return; drawing = false; o.image = cv.toDataURL('image/png'); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
  $('#sigclear').addEventListener('click', () => { ctx.clearRect(0, 0, cv.width, cv.height); o.image = ''; $('#sigph').hidden = false; });
}

function est() {
  const t = S.tool; if (!t) return;
  const o = opt(), n = inputCount(), total = S.fromJob ? S.fromJob.size : S.files.reduce((a, f) => a + f.size, 0);
  let s;
  if (!n) s = 'Add a file to begin';
  else if (t.id === 'compress') s = `${fmt(total)} → <b>about ${fmt(total * (1 - LV.find(l => l.k === o.level).p))}</b>`;
  else if (t.id === 'merge') s = n < 2 ? 'Add one more PDF to merge' : `${n} files → <b>one PDF</b>`;
  else s = `${n} file${n > 1 ? 's' : ''} · <b>${fmt(total)}</b>`;
  $('#est').innerHTML = s; $('#est2').innerHTML = s;
  const ok = canRun(t);
  $('#go').disabled = !ok; $('#go2').disabled = !ok;
}

/** Client-side checks that mirror the server's, so mistakes show before the upload. */
function validateOptions() {
  const o = opt(), t = S.tool.id;
  const bad = (sel, msg) => { const i = sel && $(sel); if (i) { i.classList.add('err'); i.focus(); } toast(msg, 3500); return false; };
  if (t === 'split' && o.mode === 'ranges' && !/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(o.ranges || '')) return bad('#f_ranges', 'Type the pages you want, like 1-3, 7');
  if (t === 'split' && o.mode === 'every' && !(+o.every >= 1 && +o.every <= 500)) return bad('#f_every', 'Pages per file must be between 1 and 500');
  if (t === 'protect') { if ((o.password || '').length < 4) return bad('#f_pw', 'Choose a password of at least 4 characters'); if (o.password !== o.password2) return bad('#f_pw2', 'The two passwords do not match'); }
  if (t === 'sign' && o.mode === 'text' && !(o.text || '').trim()) return bad('#f_text', 'Type the name to sign with');
  if (t === 'sign' && o.mode === 'image' && !o.image) return bad(null, 'Draw your signature first');
  if (t === 'ocr' && !(o.langs || []).length) return bad(null, 'Pick at least one language');
  if (t === 'img-resize' && o.mode === 'pixels') { const okN = v => Number.isInteger(+v) && +v >= 1 && +v <= 10000; if (!okN(o.width)) return bad('#f_w', 'Width must be between 1 and 10000 pixels'); if (!okN(o.height)) return bad('#f_h', 'Height must be between 1 and 10000 pixels'); }
  if (t === 'watermark' && !(o.text || '').trim()) return bad('#f_wm', 'Type the watermark text');
  if (t === 'meme' && !(o.top || '').trim() && !(o.bottom || '').trim()) return bad('#f_top', 'Type a top line, a bottom line, or both');
  return true;
}
const serverOptions = () => { const { password2, ...rest } = opt(); return rest; };

[$('#go'), $('#go2')].forEach(b => b.addEventListener('click', startJob));
async function startJob() {
  if (!S.tool || !canRun(S.tool) || !validateOptions()) return;
  const fd = new FormData();
  fd.append('tool', S.tool.id); fd.append('options', JSON.stringify(serverOptions()));
  if (S.fromJob) fd.append('from', S.fromJob.id); else S.files.forEach(f => fd.append('files', f, f.name));
  const toolId = S.tool.id, label = S.tool.ing;
  const metaText = `${inputCount() > 1 ? inputCount() + ' files' : (S.fromJob?.name || S.files[0].name)} · ${fmt(S.fromJob ? S.fromJob.size : S.files.reduce((a, f) => a + f.size, 0))} · on our server`;
  history.pushState(null, '', '#run/pending'); stopPolling(); setView('run');
  resetRun(`${label}…`, metaText, toolId);
  setRun(0, S.fromJob ? 'Starting' : 'Sending your file', 0);
  const xhr = S.xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/jobs');
  xhr.upload.onprogress = e => { if (xhr === S.xhr && e.lengthComputable) setRun(Math.round(e.loaded / e.total * 35), e.loaded >= e.total ? 'Received, starting the job' : `Sending your file · ${Math.round(e.loaded / e.total * 100)}%`, 0); };
  xhr.onerror = () => { if (xhr === S.xhr) showError('The upload did not get through. Check your connection and try again.', toolId); };
  xhr.onload = () => {
    if (xhr !== S.xhr) return;   // the user left this screen; the server will still wipe the job on its timer
    S.xhr = null;
    let j = {}; try { j = JSON.parse(xhr.responseText); } catch { /* ignore */ }
    if (xhr.status === 401) { loadSession(); return showError('The session was locked. Enter the code and try again.', toolId); }
    if (xhr.status >= 300) return showError(j.error || 'The server could not start this job.', toolId);
    S.job = j; history.replaceState(null, '', `#run/${j.id}`); watchJob(j.id);
  };
  xhr.send(fd);
}
function resetRun(title, meta, toolId) {
  $('.runpg').classList.remove('failed'); $('#errbox').hidden = true;
  $('#rTitle').textContent = title; $('#rMeta').textContent = meta || '';
  $('#errBack').href = toolId ? `#work/${toolId}` : '#work';
}
function setRun(pct, step, dotStage) {
  $('#rfg').style.strokeDashoffset = 565 * (1 - pct / 100); $('#rpct').textContent = `${pct}%`;
  if (step && $('#rSt span')?.textContent !== step) $('#rSt').innerHTML = `<span>${esc(step)}</span>`;
  $$('#dots i').forEach((d, i) => d.className = i < dotStage ? 'fin' : i === dotStage ? 'on' : '');
}
function showError(msg, toolId) {
  stopPolling(); $('.runpg').classList.add('failed'); $('#rTitle').textContent = 'That did not work'; $('#rSt').innerHTML = '';
  $('#errMsg').textContent = msg; $('#errbox').hidden = false; $$('#dots i').forEach(d => d.className = '');
  if (toolId) $('#errBack').href = `#work/${toolId}`;
}
async function fetchJob(id) { const r = await fetch(`/api/jobs/${id}`, { cache: 'no-store' }); if (r.status === 401) { loadSession(); throw new Error('locked'); } if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Lost'); return r.json(); }
function watchJob(id) {
  stopPolling();
  const gen = S.gen; let inFlight = false;
  if (id === 'pending') return; // upload still going; startJob drives the screen
  if (S.job?.id !== id) resetRun('Working…', '', null);
  const tick = async () => {
    if (inFlight || gen !== S.gen) return; inFlight = true;
    let j; try { j = await fetchJob(id); } catch (e) { inFlight = false; if (gen !== S.gen) return; return showError(e.message === 'locked' ? 'The session was locked. Enter the code and try again.' : `This job is gone. Results are wiped after ${retention()} minutes.`, S.job?.tool); }
    inFlight = false; if (gen !== S.gen) return;
    S.job = j;
    const t = TOOLS.find(x => x.id === j.tool); if (t) { $('#rTitle').textContent = `${t.ing}…`; $('#errBack').href = `#work/${t.id}`; }
    if (!$('#rMeta').textContent) $('#rMeta').textContent = `${j.files.length > 1 ? j.files.length + ' files' : j.files[0]?.name || ''} · ${fmt(j.files.reduce((a, f) => a + f.size, 0))} · on our server`;
    if (j.status === 'error') return showError(j.error, j.tool);
    if (j.status === 'done') { stopPolling(); setRun(100, 'Ready', 4); setTimeout(() => { if (location.hash === `#run/${id}`) { history.replaceState(null, '', `#done/${id}`); route(); } }, 500); return; }
    const pct = 35 + Math.round(j.progress * 0.65);
    setRun(pct, j.step, j.status === 'queued' ? 1 : j.progress < 50 ? 2 : 3);
  };
  tick(); S.poll = setInterval(tick, 800);
}

/* ---------- done view ---------- */
async function showDone(id) {
  const gen = S.gen;
  let j; try { j = S.job?.id === id && S.job.status === 'done' ? S.job : await fetchJob(id); } catch { if (gen !== S.gen) return; location.hash = '#start'; return toast(`That result is gone. Results are wiped after ${retention()} minutes.`, 4000); }
  if (gen !== S.gen) return;
  if (j.status !== 'done') { location.hash = `#run/${id}`; return; }
  S.job = j;
  const t = TOOLS.find(x => x.id === j.tool) || TOOLS[0];
  const before = j.files.reduce((a, f) => a + f.size, 0), after = j.result.size;
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  const isC = j.tool === 'compress';
  $('#dTitle').innerHTML = isC && pct > 0 ? `Smaller by <span class="g" id="dPct">0%</span>` : isC ? 'Already compact' : j.tool === 'merge' ? `<span class="g">One PDF</span> from ${j.files.length} files` : `${esc(t.n)} <span class="g">done</span>`;
  $('#dSub').textContent = j.result.note || (j.result.count > 1 ? `${j.result.count} files packed into one ZIP. Ready to download.` : 'Ready to download. Nothing else was changed.');
  $('#dBefore').textContent = fmt(before); $('#dAfter').textContent = fmt(after);
  $('#sizes').hidden = $('#dBarWrap').hidden = !isC;
  const bar = $('#dBar'); bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)'; requestAnimationFrame(() => { bar.style.transition = ''; bar.style.transform = `scaleX(${Math.max(.08, before ? after / before : 1)})`; });
  if (isC && pct > 0) { const t0 = performance.now(); (function c(now) { const q = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - q, 3); const el = $('#dPct'); if (el) el.textContent = Math.round(pct * e) + '%'; if (q < 1) requestAnimationFrame(c); })(t0); }
  $('#dl').href = `/api/jobs/${id}/download`; $('#dl').setAttribute('download', j.result.name); $('#dl').removeAttribute('aria-disabled');
  // The file downloads by itself after 5 seconds (once per job), or straight away on a click.
  const ring = $('#ring'), note = $('#dlNote'), cnt = $('#cnt'), fgc = $('#fgc');
  clearInterval(S.cd); S.cd = null;
  const saved = () => { ring.className = 'ring done'; $('#dlTxt').textContent = 'Download again'; note.className = 'dlnote ok'; note.innerHTML = '<b>Saved.</b> Look in your Downloads folder.'; S.autoDone.add(id); try { sessionStorage.setItem('fp-dl-' + id, '1'); } catch { /* private mode */ } clearInterval(S.cd); S.cd = null; };
  let already = S.autoDone.has(id); try { already ||= !!sessionStorage.getItem('fp-dl-' + id); } catch { /* ignore */ }
  if (already) saved();
  else {
    let left = 5; ring.className = 'ring'; $('#dlTxt').textContent = 'Download'; note.className = 'dlnote';
    const paint = () => { cnt.textContent = left; fgc.style.strokeDashoffset = 88 * (1 - left / 5); note.innerHTML = `Starts by itself in <b>${left} s</b> — or click to get it now`; };
    paint();
    S.cd = setInterval(() => { if (--left > 0) return paint(); saved(); $('#dl').click(); }, 1000);
  }
  $('#dl').onclick = () => { if (!S.autoDone.has(id)) saved(); };
  // chaining: only when the result can be an input again
  const rk = kindOf(j.result.name), chainable = !!rk;
  $('#chainwrap').hidden = !chainable;
  if (chainable) {
    $('#chipK').textContent = rk === 'image' ? extOf(j.result.name).toUpperCase() : rk === 'pdf' ? 'PDF' : 'DOC'; $('#chipK').className = `k ${rk}`;
    $('#chipName').textContent = j.result.name; $('#chipSize').textContent = `· ${fmt(after)}`;
    const fits2 = x => { const a = serverTool(x.id)?.accepts || x.accepts; return a === rk || (rk === 'office' && a === 'pdf' && x.id !== 'pdf-word'); };
    fillTiles($('#tiles2'), x => `#work/${x.id}`, x => (fits2(x) ? '' : ' dim'), TOOLS.filter(fits2));
  }
  // the result can be previewed too: fetch it once (it is ours) so the next job shows its first page
  let chainedFile = null;
  if (chainable) fetch(`/api/jobs/${id}/download`).then(r => r.ok ? r.blob() : null).then(b => { if (b) chainedFile = new File([b], j.result.name); }).catch(() => {});
  $$('#tiles2 .tile').forEach(el => el.addEventListener('click', () => { S.fromJob = { id, name: j.result.name, size: after, file: chainedFile }; S.files = []; S.opts = {}; S.showAll = false; }));
  clearInterval(S.timer);
  const paint = () => { const left = Math.max(0, Math.round((j.expiresAt - Date.now()) / 1000)); $('#tmr').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; if (!left) clearInterval(S.timer); };
  paint(); S.timer = setInterval(paint, 1000);
}
$('#del').addEventListener('click', async () => {
  if (!S.job) return;
  clearInterval(S.cd); S.cd = null; S.autoDone.add(S.job.id);   // never auto-download something the user just deleted
  const jobId = S.job.id;
  const r = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => ({ ok: false, status: 0 }));
  toast(r.ok || r.status === 404 ? 'Wiped. Nothing of it remains on the server.' : 'Could not delete right now.');
  if (r.ok || r.status === 404) { clearInterval(S.timer); $('#tmr').textContent = '00:00'; $('#dl').setAttribute('aria-disabled', 'true'); setTimeout(() => { if (location.hash === `#done/${jobId}`) location.hash = '#start'; }, 1200); }
});

/* ---------- toast ---------- */
let tt; function toast(m, ms = 2600) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms); }

await loadSession();
route();
if (document.fonts) document.fonts.ready.then(fitOrbit);
