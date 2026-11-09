# PDF → Word fidelity (blanks and spaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF → Word keeps fill-in blank lines (as editable underscores) and no longer glues words together, with no change to the engine's layout analysis for everything else.

**Architecture:** A new Python helper `src/tools/pdf-word.py` wraps pdf2docx: it first writes underscores over text-less thin black rules in a scratch copy of the PDF (PyMuPDF), patches one pdf2docx method so a whitespace-only text piece between two words becomes a space on the previous word, then runs the engine. `src/tools/convert.js` calls the helper through the existing locked-down runner instead of the `pdf2docx` CLI. Spec: `docs/superpowers/specs/2026-11-09-pdf-to-word-fidelity-design.md`.

**Tech Stack:** Node 22 (Express app, `node --test`), Python 3 with pdf2docx 0.5.13 + PyMuPDF (already in the Docker image), pdf-lib for test fixtures.

---

## File structure

- Create `src/tools/pdf-word.py` — the helper: blank-line pre-pass, engine patch, conversion. One responsibility: turn one PDF into one .docx.
- Modify `src/tools/convert.js` — `pdfToWord.run` calls the helper; header comment updated.
- Modify `test/api.test.js` — `makeFixtures` builds `form.pdf`; the PDF → Word test asserts blanks, spaces and the table header.
- Modify `README.md`, `public/app.js`, `docs/DESIGN.md` — one line each.

Run everything from the repo root. Tests need the same engines as the Dockerfile (all present on this box).

---

### Task 1: Failing test with a form fixture

**Files:**
- Modify: `test/api.test.js` (import at line 10, `makeFixtures` ~line 26-56, PDF → Word test ~line 229-235)

- [ ] **Step 1: Import `rgb` from pdf-lib**

Change line 10 from
```js
import { PDFDocument, StandardFonts } from 'pdf-lib';
```
to
```js
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, setFillingRgbColor, rectangle as rectOp, fill as fillOp, concatTransformationMatrix } from 'pdf-lib';
```

- [ ] **Step 2: Build `form.pdf` in `makeFixtures`**

Insert before the line `// A junk file that claims to be a PDF.`:

```js
  // A form as PDF -> Word must handle it. Page 1: fill-in blanks drawn as thin black rules inside sentences (one
  // pair drawn as a single path holding two rectangles, one blank already carrying a value, one single-spaced), a
  // sentence whose spaces are separate pieces at another size, three thin black rules that are NOT blanks (a
  // heading's border, a table row's rule, a bare divider) and a grey-gridded table. Pages 2 and 3 add awkward
  // geometry (see below). Rows with blanks are kept apart and their fragments do not line up: neighbouring rows of
  // aligned fragments read as a borderless table to the engine (a layout question, not what this test is about).
  {
    const form = await PDFDocument.create();
    const f = await form.embedFont(StandardFonts.Helvetica);
    const p = form.addPage([595, 842]);
    const black = rgb(0, 0, 0), grey = rgb(0.73, 0.73, 0.73);
    const T = (s, x, y, size = 12) => p.drawText(s, { x, y, size, font: f });
    const R = (x, y, w) => p.drawRectangle({ x, y, width: w, height: 0.8, color: black });
    T('Name:', 40, 762); R(80, 760, 200); T('(as on the share certificate)', 290, 762);
    T('I, the undersigned, hereby solemnly affirm and state on oath as follows.', 40, 744);
    T('Place:', 40, 726); T('Date:', 206, 726);   // two blanks as ONE path holding two rectangles
    p.pushOperators(pushGraphicsState(), setFillingRgbColor(0, 0, 0), rectOp(78, 724, 122, 0.8), rectOp(240, 724, 125, 0.8), fillOp(), popGraphicsState());
    T('This declaration is made in good faith and nothing material has been concealed.', 40, 708);
    T('Holder:', 40, 690); R(83, 688, 317); T('Ram Kumar', 90, 690);   // a value already written on the blank
    T('The particulars given above are true to the best of my knowledge.', 40, 672);
    T('Address:', 40, 658, 11); R(88, 656.5, 312);   // single-spaced under the line above
    let x = 40;
    for (const w of ['have', 'hereunto', 'set', 'their', 'respective', 'hands']) {
      T(w, x, 630); x += f.widthOfTextAtSize(w, 12);
      p.drawText(' ', { x, y: 630, size: 14.7, font: f }); x += f.widthOfTextAtSize(' ', 14.7);
    }
    T('ACME Corporation Ltd', 40, 600, 14); R(40, 593.7, 515);   // heading with a border 2 pt under its descender
    T('Item', 60, 560); T('Qty', 200, 560); T('Price', 340, 560); R(40, 557.7, 515);   // table row over a horizontal-only rule
    R(40, 530, 515);   // a bare divider
    for (const y of [470, 450, 430]) p.drawRectangle({ x: 60, y, width: 400, height: 0.7, color: grey });
    for (const gx of [60, 193, 326, 460]) p.drawRectangle({ x: gx, y: 430, width: 0.7, height: 40.7, color: grey });
    T('Folio Number', 65, 456, 10); T('Face value', 198, 456, 10); T('Certificate No', 331, 456, 10);
    // Page 2: the content starts with a transform that is never undone (some producers do this), so everything
    // the reader sees is shifted; underscores must still land on their rules. Also: a title over a page-wide
    // rule, a one-cell table row, a divider beside another column's text, and a value typed 2 pt below its line.
    const p2 = form.addPage([595, 842]);
    p2.pushOperators(concatTransformationMatrix(1, 0, 0, 1, 30, -40));
    const T2 = (s, x, y, size = 12) => p2.drawText(s, { x, y, size, font: f });
    const R2 = (x, y, w) => p2.drawRectangle({ x, y, width: w, height: 0.8, color: black });
    T2('INVOICE', 40, 760, 18); R2(40, 757.3, 515);   // title over a page-wide rule at underline position
    T2('Issued under the terms printed overleaf and subject to the usual conditions.', 40, 730);
    T2('Ref:', 40, 700); R2(67, 698, 233);
    T2('Payment is due within thirty days of the date shown on this document.', 40, 670);
    T2('Total', 46, 640); R2(40, 637.5, 515);   // a one-cell table row over a horizontal-only rule
    T2('All amounts are stated in rupees unless marked otherwise in the schedule.', 40, 610);
    R2(40, 580, 210); T2('Right column body text here', 300, 582);   // a divider with another column beside it
    T2('The schedule forms part of this document and must be read with it.', 40, 550);
    T2('Code:', 40, 520); R2(77, 518, 323); T2('AB-12', 90, 517);   // value typed with its baseline 2 pt below the rule's top
    // Page 3: an offset CropBox; the reader and the writer must agree on where the rule is.
    const p3 = form.addPage([595, 842]);
    p3.setCropBox(20, 30, 480, 770);
    p3.drawText('Pin:', { x: 60, y: 700, size: 12, font: f }); p3.drawRectangle({ x: 86, y: 698, width: 214, height: 0.8, color: black });
    p3.drawText('Next paragraph of text.', { x: 60, y: 670, size: 12, font: f });
    await fs.writeFile(path.join(FIX, 'form.pdf'), await form.save());
  }
```

- [ ] **Step 3: Extend the PDF → Word test**

Replace the test body
```js
test('Office -> PDF and PDF -> Word', { timeout: 300_000 }, async () => {
  const w = await runTool('word-pdf', ['memo.docx'], {});
  assert.equal(pages(w.out), 1); assert.match(text(w.out), /Filepress memo/);
  const d = await runTool('pdf-word', ['text.pdf'], {});
  assert.match(d.job.result.name, /\.docx$/);
  assert.equal((await fs.readFile(d.out)).subarray(0, 2).toString(), 'PK');
});
```
with
```js
test('Office -> PDF and PDF -> Word', { timeout: 300_000 }, async () => {
  const w = await runTool('word-pdf', ['memo.docx'], {});
  assert.equal(pages(w.out), 1); assert.match(text(w.out), /Filepress memo/);
  const d = await runTool('pdf-word', ['text.pdf'], {});
  assert.match(d.job.result.name, /\.docx$/);
  assert.equal((await fs.readFile(d.out)).subarray(0, 2).toString(), 'PK');
  // The form: blanks survive as underscores (also after a value already written, and single-spaced), word spaces
  // survive, and nothing is drawn on a heading's border, a table row's rule, a bare divider or the grey grid.
  // Faithful text of a .docx: runs stay glued unless the file really has a space between them.
  const docxText = f => run('python3', ['-I', '-c', 'import zipfile,sys;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode())', f])
    .replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>|<w:br\/>/g, '\n').replace(/<[^>]+>/g, '');
  const t = docxText((await runTool('pdf-word', ['form.pdf'], {})).out);
  for (const label of ['Name:', 'Place:', 'Date:', 'Ram Kumar', 'Address:', 'Ref:', 'AB-12', 'Pin:']) assert.match(t, new RegExp(label + '\\s*_{5,}'), `blank after "${label}" kept`);
  assert.match(t, /have hereunto set their respective hands/, 'word spaces kept');
  for (const s of ['ACME Corporation Ltd', 'Item', 'Qty', 'Price', 'Folio Number', 'Certificate No', 'INVOICE', 'Total', 'Right column body text here', 'Next paragraph of text.']) assert.match(t, new RegExp(s), `"${s}" kept`);
  assert.doesNotMatch(t, /(ACME Corporation Ltd|Item|Qty|Price|INVOICE|Total|Right column body text here|Next paragraph of text\.)\s*_{3,}/, 'no underscores on headings, table rules, dividers or the line after a blank');
  assert.equal((t.match(/_{3,}/g) || []).length, 8, 'exactly the eight blanks became underscores');
});
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `node --test --test-name-pattern="PDF -> Word" test/api.test.js 2>&1 | tail -30`
Expected: FAIL on `blank after "Name:" kept` (today's engine drops the blank).

- [ ] **Step 5: Commit**

```bash
git add test/api.test.js
git commit -m "Test: PDF → Word must keep fill-in blanks, word spaces and the table header of a form"
```

---

### Task 2: The helper `src/tools/pdf-word.py`

**Files:**
- Create: `src/tools/pdf-word.py`

- [ ] **Step 1: Write the helper**

```python
#!/usr/bin/env python3
"""PDF -> Word: pdf2docx plus two fixes.

Usage: pdf-word.py <in.pdf> <out.docx> <pre.pdf>     (<pre.pdf> is scratch space owned by the caller)

1. Fill-in blanks. Word exports a "______" blank as a filled rectangle under 1 pt tall with nothing written on
   it. pdf2docx only keeps such a rule when text sits on it (then it is an underline), so blanks vanish. The
   pre-pass writes underscores of the same width onto every blank in a scratch copy of the PDF; the engine then
   carries them into Word as editable text. The rules for what counts as a blank are deliberately cautious:
   underscores are never drawn where text already is, and a rule with no text beside it is left alone, so the
   worst case is a blank that stays missing, as today, never a line that was not there.
2. Word spaces. Some PDFs store every inter-word space as its own text piece, often at another font size, and
   pdf2docx drops whitespace-only pieces, gluing the words together. The patched Spans.restore glues the space
   onto the previous word instead. It adds no new pieces, so blocks, lines and sections are found exactly as
   before.

Both are best-effort: if the pre-pass fails on an odd PDF, or the engine fails on the pre-passed copy, the
original is converted as it always was.
"""
import sys
import warnings

warnings.filterwarnings("ignore")  # library deprecation chatter is not an error worth showing the user

from collections import Counter

import pymupdf
from pdf2docx import Converter
from pdf2docx.page.RawPageFitz import RawPageFitz
from pdf2docx.text import Spans as spans_module
from pdf2docx.text.TextSpan import TextSpan
from pdf2docx.image.ImageSpan import ImageSpan

MAX_RULE_HEIGHT = 2.5   # pt: anything taller is a box or a shading, not a line
MIN_RULE_WIDTH = 8.0    # pt: shorter marks are dashes or noise; also the narrowest gap worth underscoring
DARK = 0.25             # every colour channel below this = black-ish; grey decorative rules are skipped
HOVER = 8.0             # pt: a word ending within this above a rule, without crossing it, makes the rule ambiguous
NEAR = 8.0              # pt: a label ends, or a continuation starts, less than this from the rule (Word leaves about
                        #     a space's width, sometimes a little more); column gaps are wider
EDGE = 3.0              # pt: a label must start at least this far before the rule, or it is text sitting on the rule
CLEAR = 2.5             # pt: underscores keep this distance from text that touches the rule (closer than ~1.7 pt and
                        #     the reader glues the two into one word)
MIN_GAP_BY_TEXT = 18.0  # pt: a leftover stretch beside text on the rule must fit ~3 underscores, or it is noise
DASH_GAP = 4.5          # pt: dashes on one line this close together, with nothing written between, are one blank
DASH_MAX = 24.0         # pt: longer pieces are blanks in their own right, never merged
MIN_RUN_GAP = 12.0      # pt: two underscore runs side by side closer than this would be read back as one line, and
                        #     that line's box would swallow a "/" or "-" written between them
NEAR_BASELINES = 9.0    # pt: runs whose baselines differ by less than this count as side by side for that purpose
ENGINE_SETTINGS = Converter.default_settings.fget(None)  # the parsing settings the conversion itself will use
GRID_TOUCH = 1.5        # pt: a rule this close to a thin upright rule is a table grid line
MAX_DRAWINGS = 5000     # a page with more vector paths than this (a map, a CAD drawing) is left alone
MAX_RULES = 300         # a page with more thin rules than this is ruled paper or a grid, not a form
FONT_NAME, FONT_SIZE = "helv", 11
FONT = pymupdf.Font(FONT_NAME)


def shapes_in(drawing):
    """The bounding box of each separate shape inside one filled path: a rectangle operator is one shape, a run of
    connected line or curve segments is one shape (that is how many producers draw a thin rule)."""
    boxes, current, end = [], None, None   # current = [min x, min y, max x, max y] of the open run of segments
    flush = lambda: boxes.append(pymupdf.Rect(*current)) if current is not None else None
    for item in drawing.get("items") or []:
        kind = item[0]
        if kind in ("re", "qu"):
            flush()
            current, end = None, None
            boxes.append(pymupdf.Rect(item[1]) if kind == "re" else item[1].rect)
            continue
        if kind not in ("l", "c"):
            continue
        points = item[1:]
        start = points[0]
        if current is None or end is None or abs(start.x - end.x) > 0.05 or abs(start.y - end.y) > 0.05:
            flush()
            current = [start.x, start.y, start.x, start.y]
        for pt in points:
            current = [min(current[0], pt.x), min(current[1], pt.y), max(current[2], pt.x), max(current[3], pt.y)]
        end = points[-1]
    flush()
    return boxes


def thin_rects(page, words):
    """(dark thin horizontal rules, thin upright rules of any colour) on a page, one entry per shape.
    None when the page is too busy to be a form."""
    drawings = page.get_drawings()
    if len(drawings) > MAX_DRAWINGS:
        return None
    rules, uprights = [], []
    for d in drawings:
        if "f" not in (d.get("type") or ""):
            continue
        fill = d.get("fill")
        opacity = d.get("fill_opacity")
        dark = bool(fill) and max(fill) < DARK and (opacity is None or opacity > 0.5)
        for r in shapes_in(d):
            if r.is_infinite or r.width <= 0 or r.height <= 0:
                continue
            if r.width <= MAX_RULE_HEIGHT and r.height > 4:
                uprights.append(r)
            elif dark and r.height <= MAX_RULE_HEIGHT and r.width >= 1:
                rules.append(r)
    # Dashes on one line are one blank: group the rules into lines, then merge short pieces whose gaps are small
    # and hold no text (a "/" between date boxes keeps them apart). Finally drop the tiny ones.
    if len(rules) + len(uprights) > MAX_RULES:
        return [], uprights  # ruled paper, a grid, dotted leaders: count the pieces as drawn, before merging
    rules.sort(key=lambda r: r.y0)
    lines, line = [], []
    for r in rules:
        if line and r.y0 - line[-1].y0 > 0.5:
            lines.append(line)
            line = []
        line.append(r)
    if line:
        lines.append(line)
    merged = []
    for line in lines:
        line.sort(key=lambda r: r.x0)
        last_piece = None  # the previous piece as drawn, before merging, so a long merged run keeps growing
        for r in line:
            last = merged[-1] if merged else None
            gap_has_text = last is not None and any(w[0] < r.x0 and w[2] > last.x1 and w[1] < r.y0 < w[3] for w in words)
            if (last is not None and last_piece is not None and abs(r.y0 - last_piece.y0) <= 0.5 and
                    abs(r.height - last_piece.height) <= 0.3 and r.width <= DASH_MAX and last_piece.width <= DASH_MAX and
                    r.x0 - last.x1 < DASH_GAP and not gap_has_text):
                merged[-1] = pymupdf.Rect(last.x0, min(last.y0, r.y0), max(last.x1, r.x1), max(last.y1, r.y1))
            else:
                merged.append(pymupdf.Rect(r))
            last_piece = r
    return [r for r in merged if r.width >= MIN_RULE_WIDTH], uprights


def blank_segments(page):
    """[(x0, x1, y)]: the stretches of fill-in blank lines on a page that carry no text."""
    words = page.get_text("words")  # (x0, y0, x1, y1, text, block, line, word)
    found = thin_rects(page, words)
    if found is None:
        return []
    rules, uprights = found
    if len(rules) + len(uprights) > MAX_RULES:
        return []
    baseline = lambda w: w[3] - 0.22 * (w[3] - w[1])  # the box bottom is the descender; the baseline sits above it
    out = []
    for r in rules:
        if any(u.x1 >= r.x0 - GRID_TOUCH and u.x0 <= r.x1 + GRID_TOUCH and
               u.y1 >= r.y0 - GRID_TOUCH and u.y0 <= r.y1 + GRID_TOUCH for u in uprights):
            continue
        # Words whose box crosses the rule's top edge, at any depth, are on its line: a label, a value sitting on
        # the line or dipping below it, a large font. Nothing is ever drawn over them.
        on_line = [w for w in words if w[1] < r.y0 < w[3]]
        across = [w for w in words if w[2] > r.x0 and w[0] < r.x1]
        if any(w[1] < r.y0 and r.y0 - HOVER <= w[3] <= r.y0 for w in across):
            continue  # text floats just above the rule without crossing it: a heading's border, or a value written high
        # A blank reads into text at underline height: a label ends just before it ("Name: ____"; the label may
        # overlap its start a little) or a continuation starts just after it ("____ residing at"). Only words whose
        # baseline is above the rule count: a bar at mid-text height is an ornament. Titles, column headings,
        # table rows and dividers have neither, however the rule is placed.
        anchors = [w for w in on_line if baseline(w) <= r.y0 + 1.5]  # 1.5 pt of slack for fonts with deep descenders
        labels = [w for w in anchors if w[0] < r.x0 - EDGE and r.x0 - NEAR < w[2] <= r.x0 + NEAR]
        continuations = [w for w in anchors if r.x1 - 1 <= w[0] < r.x1 + NEAR]
        if not (labels or continuations):
            continue
        # Words on the rule, ignoring a label or continuation that merely touches one of its ends.
        # Where the underscores may go: clear of a label or continuation that touches the rule.
        left = max([r.x0] + [w[2] + CLEAR for w in labels if w[2] > r.x0 - CLEAR])
        right = min([r.x1] + [w[0] - CLEAR for w in continuations if w[0] < r.x1 + CLEAR])
        on_words = sorted((w for w in on_line if w[2] > r.x0 + 1 and w[0] < r.x1 - 1), key=lambda w: w[0])
        if not on_words:
            if right - left >= MIN_RULE_WIDTH:
                out.append((left, right, r.y0))
            continue
        # Group the words on the rule; a gap narrower than MIN_RULE_WIDTH is just word spacing.
        groups = [[on_words[0]]]
        for w in on_words[1:]:
            if w[0] - max(x[2] for x in groups[-1]) < MIN_RULE_WIDTH:
                groups[-1].append(w)
            else:
                groups.append([w])
        if len(groups) > 1:
            continue  # several word groups over one rule: a table row or an underlined heading, not a blank
        group = groups[0]
        g0, g1 = group[0][0], max(w[2] for w in group)
        if g0 <= r.x0 + EDGE and not continuations and not (len(group) == 1 and group[0] in labels):
            continue  # text starting at (or running onto) the rule's start with nothing after it: a title such as "1. Introduction"
        if g0 - CLEAR - left >= MIN_GAP_BY_TEXT:
            out.append((left, g0 - CLEAR, r.y0))
        if right - (g1 + CLEAR) >= MIN_GAP_BY_TEXT:
            out.append((g1 + CLEAR, right, r.y0))
    return out


def engine_characters(page):
    """The visible characters pdf2docx keeps on a page after its own clean-up, each with its position:
    Counter of (character, x centre, y centre) rounded to whole points. Lines the engine drops as overlapped are
    not deleted but given an empty box, so they are skipped here; spaces are ignored."""
    raw = RawPageFitz(page)
    raw.restore(**ENGINE_SETTINGS)
    raw.clean_up(**ENGINE_SETTINGS)
    chars = Counter()
    for line in raw.blocks:
        box = getattr(line, "bbox", None)
        if box is None or box.is_empty:
            continue
        for span in getattr(line, "spans", None) or []:
            for ch in getattr(span, "chars", None) or []:
                c = ch.c.strip()  # the word-space patch may have glued a space onto a character
                if not c:
                    continue
                b = ch.bbox
                chars[(c, round((b.x0 + b.x1) / 2), round((b.y0 + b.y1) / 2))] += 1
    return chars


def lost_characters(before, after):
    """Entries of <before> with no counterpart in <after> at the same place (1 pt of slack for rounding)."""
    missing = before - after
    lost = Counter()
    for (c, x, y), n in missing.items():
        nearby = sum(after.get((c, x + dx, y + dy), 0) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
        if nearby < n:
            lost[(c, x, y)] = n - nearby
    return lost


def underline_blanks(src, dst):
    """Write <dst>: <src> with underscores drawn over every blank line. Returns how many were drawn (0 = <dst>
    not written). Raises if the underscores did not land on their rules, so the caller falls back to <src>."""
    doc = pymupdf.open(src)
    try:
        glyph = FONT.text_length("_", fontsize=FONT_SIZE)
        drawn = []  # (page number, x0, end of the underscores, y) of every run written
        for page in doc:
            if page.rotation:
                continue  # rotated pages: coordinates would need mapping; leave them as today
            runs = sorted(([x0, int((x1 - x0) / glyph), y] for x0, x1, y in blank_segments(page)), key=lambda r: (r[0], r[2]))
            runs = [r for r in runs if r[1] >= 1]
            # Runs side by side (baselines within NEAR_BASELINES) must stay MIN_RUN_GAP apart: trim whole
            # underscores, drop the later run if need be. Closer, the reader merges them into one line whose box
            # swallows whatever is written between them. A run overlapping an earlier one is dropped outright.
            for i in range(1, len(runs)):
                cur = runs[i]
                for prev in runs[:i]:
                    if prev[1] < 1 or cur[1] < 1 or abs(prev[2] - cur[2]) >= NEAR_BASELINES:
                        continue
                    end = lambda: prev[0] + prev[1] * glyph
                    if cur[0] < end() and cur[0] + cur[1] * glyph > prev[0]:
                        cur[1] = 0  # overlapping an earlier run
                        break
                    while cur[0] - end() < MIN_RUN_GAP and prev[1] > 1:
                        prev[1] -= 1
                    while cur[0] - end() < MIN_RUN_GAP and cur[1] > 1:
                        cur[0] += glyph
                        cur[1] -= 1
                    if cur[0] - end() < MIN_RUN_GAP:
                        cur[1] = 0
                        break
            runs = [r for r in runs if r[1] >= 1]
            if not runs:
                continue
            page.wrap_contents()  # a transform the page's own content left open must not shift what we add
            shape = page.new_shape()
            for x0, n, y in runs:
                shape.insert_text(pymupdf.Point(x0, y - 0.5), "_" * n, fontname=FONT_NAME, fontsize=FONT_SIZE, color=(0, 0, 0))
                drawn.append((page.number, x0, x0 + n * glyph, y))
            shape.commit()
        if not drawn:
            return 0
        # Read the copy back: every run must sit on its rule, or the page geometry fooled us and we do nothing.
        # (A run read back glued to a touching label still counts, as long as it ends where the run ends.)
        # Then ask the engine itself: after its own clean-up (which drops lines it sees as overlapped), every
        # visible character of the original page must still be there on the pre-passed page.
        original = pymupdf.open(src)
        try:
            for pno in sorted({d[0] for d in drawn}):
                page = doc[pno]
                words = [w for w in page.get_text("words") if w[4].endswith("_")]
                for _, x0, x1, y in (d for d in drawn if d[0] == pno):
                    def lands(w):
                        pure = set(w[4]) == {"_"}
                        return (abs(w[0] - x0) <= 2 if pure else (w[0] < x0 and abs(w[2] - x1) <= 2)) and w[1] <= y <= w[3] + 1
                    if not any(lands(w) for w in words):
                        raise RuntimeError(f"underscores did not land on their rule on page {pno + 1}")
                lost = lost_characters(engine_characters(original[pno]), engine_characters(page))
                if lost:
                    raise RuntimeError(f"the engine would drop text on page {pno + 1}: {''.join(c for (c, _, _) in lost)[:40]!r}")
        finally:
            original.close()
        doc.save(dst)
        return len(drawn)
    finally:
        doc.close()


def restore_keeping_spaces(self, raws):
    """pdf2docx's Spans.restore, except that a whitespace-only piece between two words becomes a space on the
    previous word instead of being dropped (the same trick pdf2docx uses in Lines.py for line joins)."""
    gap = False
    for raw in raws:
        if "image" in raw:
            self.append(ImageSpan(raw))
            gap = False
            continue
        span = TextSpan(raw)
        if not span.text.strip() and not span.style:
            gap = True
            continue
        prev = self._instances[-1] if self._instances else None
        if gap and isinstance(prev, TextSpan) and prev.chars and not prev.text.endswith(" "):
            prev.chars[-1].c += " "
        gap = False
        self.append(span)
    return self


spans_module.Spans.restore = restore_keeping_spaces


def convert(pdf, out, **options):
    cv = Converter(pdf)
    try:
        cv.convert(out, **options)
    finally:
        cv.close()


def main(argv):
    if len(argv) != 4:
        sys.exit("usage: pdf-word.py <in.pdf> <out.docx> <pre.pdf>")
    src, out, pre = argv[1], argv[2], argv[3]
    source = src
    try:
        if underline_blanks(src, pre):
            source = pre
    except Exception as e:  # odd PDF: convert it as it is, never worse than before
        print(f"pre-pass skipped: {e}", file=sys.stderr)
    if source == src:
        convert(src, out)
        return
    try:
        # A page the engine cannot handle must raise here (not be skipped quietly), so the original gets its turn.
        convert(pre, out, raw_exceptions=True)
    except Exception as e:
        print(f"pre-passed copy failed ({e}); converting the original instead", file=sys.stderr)
        convert(src, out)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 2: Smoke-run it by hand on the test fixture**

Run (after Task 1 created the fixture; if `test/tmp/fixtures/form.pdf` is missing, run the test once first):
```bash
S=$(mktemp -d) && python3 -I src/tools/pdf-word.py test/tmp/fixtures/form.pdf $S/form.docx $S/pre.pdf && python3 -I -c 'import zipfile,re,sys;x=zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode();t=re.sub(r"<[^>]+>","",re.sub(r"</w:p>|<w:br/>","\n",x));print(t[:400]);print("underscore runs:",len(re.findall(r"_{3,}",t)))' $S/form.docx; rm -rf $S
```
Expected: text shows `Name:` then underscores, `Ram Kumar` then underscores, `have hereunto set their respective hands`, `Folio Number`; `underscore runs: 8` (5 on page 1, 2 on page 2, 1 on page 3).

- [ ] **Step 3: Commit**

```bash
git add src/tools/pdf-word.py
git commit -m "PDF → Word helper: keep fill-in blanks as underscores and keep word spaces on top of pdf2docx"
```

---

### Task 3: Wire the helper into `convert.js`

**Files:**
- Modify: `src/tools/convert.js:1-2` (header comment) and `:71-82` (`pdfToWord`)

- [ ] **Step 1: Update the header comment**

Change line 2 from
```js
// profile (macros off, links never updated). PDF -> Word uses pdf2docx, which keeps text flowing in paragraphs.
```
to
```js
// profile (macros off, links never updated). PDF -> Word uses pdf2docx through pdf-word.py, which also keeps
// fill-in blanks (as underscores) and inter-word spaces that the engine alone would drop.
```

- [ ] **Step 2: Call the helper**

Replace
```js
    await run('pdf2docx', ['convert', inPath(dir, f), outPath(dir, out)], { cwd: dir, timeoutSec: timeouts.heavy(), memMb: 0, env: { OPENBLAS_NUM_THREADS: '2' } });
```
with
```js
    await run('python3', ['-I', `${config.toolsDir}/pdf-word.py`, inPath(dir, f), outPath(dir, out), tmpPath(dir, 'pdf-word-pre.pdf')],
      { cwd: dir, timeoutSec: timeouts.heavy(), memMb: 4096, env: { OPENBLAS_NUM_THREADS: '2' } });   // 4 GB address space, like blur-faces; a 3-page form peaks near 120 MB
```
(`config` and `tmpPath` are already imported at the top of the file.)

- [ ] **Step 3: Run the test and watch it pass**

Run: `node --test --test-name-pattern="PDF -> Word" test/api.test.js 2>&1 | tail -15`
Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 4: Run the whole suite and the syntax check**

Run: `npm test 2>&1 | tail -12 && npm run check`
Expected: all tests pass (14 before this change), no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/convert.js
git commit -m "PDF → Word runs through pdf-word.py so blanks and word spaces survive"
```

---

### Task 4: Docs and the on-page hint

**Files:**
- Modify: `README.md:21`, `public/app.js:434`, `docs/DESIGN.md:21`

- [ ] **Step 1: README tool row**

Change
```
| **PDF → Word** | An editable .docx with flowing paragraphs | pdf2docx |
```
to
```
| **PDF → Word** | An editable .docx with flowing paragraphs; fill-in blanks and word spacing kept | pdf2docx + `pdf-word.py` |
```

- [ ] **Step 2: On-page hint (this string is also the deploy-watch marker)**

In `public/app.js` line 434 change the text
```
Text and layout are rebuilt into an editable Word file. Scanned PDFs need "Scan → Text" first.
```
to
```
Text and layout are rebuilt into an editable Word file; fill-in blanks stay as blanks. Scanned PDFs need "Scan → Text" first.
```

- [ ] **Step 3: DESIGN.md**

In `docs/DESIGN.md` line 21 change `pdf2docx (PDF → Word)` to `pdf2docx via `pdf-word.py` (PDF → Word; keeps blanks and word spaces)`.

- [ ] **Step 4: Syntax check and commit**

Run: `npm run check`
Expected: no output, exit 0.

```bash
git add README.md public/app.js docs/DESIGN.md docs/superpowers
git commit -m "Docs: PDF → Word keeps fill-in blanks and word spaces; design spec and plan"
```

---

### Task 5: Verify, review, push, watch

- [ ] **Step 1: Convert a real form (from the drop folder) through the helper**

Run the helper directly on a real Word-made form PDF from the drop folder and render:
```bash
S=$(mktemp -d) && python3 -I src/tools/pdf-word.py "drop/<a real form PDF>" $S/a.docx $S/pre.pdf && soffice --headless --norestore --convert-to pdf --outdir $S $S/a.docx >/dev/null 2>&1 && pdfinfo $S/a.pdf | grep Pages && pdftotext -layout $S/a.pdf - | grep -c "____"; rm -rf $S
```
Expected: the same page count as today's engine gives, and underscore lines present where the form had blanks.

- [ ] **Step 2: Secret/PII scan of the diff**

Run: `git diff 08fa771..HEAD | grep -n -i -E "api[_-]?key|secret|password|token|BEGIN (RSA|OPENSSH)|@gmail|[0-9]{1,3}(\.[0-9]{1,3}){3}" || echo "scan clean"`
Expected: `scan clean`.

- [ ] **Step 3: Pre-push panel** — security-reviewer, bug-hunter and tester on `git diff 08fa771..HEAD`, in parallel, each started fresh (no builder justification). Fix real findings, re-run `npm test`, commit.

- [ ] **Step 4: Push and watch**

```bash
git push origin main
```
Then poll until the served script carries the marker (10-minute cap):
```bash
for i in $(seq 1 40); do curl -s https://filepress-production.up.railway.app/app.js | grep -q "fill-in blanks stay as blanks" && echo LIVE && break; sleep 15; done
```
Report LIVE, BUILDING or FAILED to nandhu.

- [ ] **Step 5: Clean up** — remove any scratch folders; no servers left running (`pgrep -f src/server.js` empty).
