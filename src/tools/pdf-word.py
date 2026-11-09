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
