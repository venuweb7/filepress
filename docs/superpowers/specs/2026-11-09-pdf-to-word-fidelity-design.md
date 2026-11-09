# PDF → Word: keep fill-in blanks and word spaces

Date: 2026-11-09. Status: approved.

## Problem

PDF → Word shells out to `pdf2docx` 0.5.13. On a Word-made form (an affidavit with fill-in
blanks, one table and two side-by-side boxes) it produced a worse file than iLovePDF:

1. **Blank lines vanished.** Word exports a "______" blank as a filled rectangle under 1 pt tall.
   pdf2docx only keeps such a rule when text sits on it (it becomes an underline); a rule with
   nothing above it is discarded (`pdf2docx/text/TextSpan.py`, "didn't consider the case that
   an underline is out of a span").
2. **Words glued together.** The PDF stores each inter-word space as its own text piece, at a
   different font size from the words, so the pieces never merge; `pdf2docx/text/Spans.py`
   `Spans.restore` drops any piece that is whitespace-only with no style.
3. **Side-by-side boxes stack vertically.** pdf2docx has no floating boxes; each becomes a
   full-width table. **Out of scope here; a follow-up.**

A local run reproduces the deployed output byte for byte, so this is the engine, not the deploy.
No `pdf2docx` setting changes any of the three.

## Goal

Fix 1 and 2 inside Filepress without changing the engine's layout analysis for everything else.
Measured on the affidavit: same section count (6) and rendered page count (4) as today, the
glued sentence spaced, 18 blanks visible as underscores, the table header intact. Reviewed 2026-11-09 by
the pre-push panel; the blank detector was reworked after the bug hunter showed the first version drawing
over written values, over multi-rectangle paths and over decorative rules.

## Design

### New helper `src/tools/pdf-word.py`

Usage: `python3 -I pdf-word.py <in.pdf> <out.docx> <pre.pdf>` where `pre.pdf` is a scratch path
the caller owns (the job's `tmp/` folder). Exit 0 on success; non-zero with a one-line stderr
message when the engine fails. Prints nothing on success.

Steps:

1. **Pre-pass (blank lines → underscores).** Open `in.pdf` with PyMuPDF (already a pdf2docx
   dependency). Skip a page that is rotated or has more than 5000 vector paths. Take every filled path
   (`page.get_drawings()`, type contains "f") and split it into its shapes: each rectangle operator is one
   shape, each run of connected line or curve segments is one shape (many producers draw a thin rule as a
   closed four-segment path). A shape is a **rule** when it is ≤ 2.5 pt tall and dark (every RGB channel
   < 0.25, fill opacity > 0.5); an **upright** when it is ≤ 2.5 pt wide and > 4 pt tall (any colour). Short
   pieces (each ≤ 24 pt) on one line less than 4.5 pt apart with no word between them are merged (a dashed
   blank is one blank; the "/" between date boxes keeps them apart); rules under 8 pt wide are then dropped.
   Skip the page if the pieces as drawn + uprights exceed 300 (ruled paper, a grid, dotted leaders). For each
   rule:
   - skip it if an upright comes within 1.5 pt (a table grid line);
   - words **on its line** are those whose box crosses the rule's top edge, at any depth (a label, a value
     sitting on or dipping below the line, a large font);
   - skip it if any word overlaps it horizontally and ends within 8 pt above it without crossing it (a
     heading's paragraph border, or a value written high: ambiguous, never draw);
   - it must read into text at underline height: a **label** on its line whose baseline is above the rule
     (estimated as the word box's bottom minus 22 % of its height, with 1.5 pt of slack),
     that starts at least 3 pt before the rule and ends less than 8 pt before its start or up to 8 pt past it
     (Word's "I/We, ____" overlaps a little), or a **continuation** on its line, baseline above the rule,
     that starts less than 8 pt after the rule's end ("____ residing at"). Titles, column headings, one-cell
     table rows, dividers and mid-height ornament bars have neither; column gaps are wider than 8 pt;
   - words on its line that overlap it by more than 1 pt are grouped (a gap < 8 pt is word spacing): more
     than one group means a table row or an underlined heading → skip; one group starting within 3 pt of the
     rule's start with no continuation after the rule → a numbered or plain title over a wider rule → skip;
     otherwise one group → draw only on the text-free end stretches of the rule that fit about three
     underscores (≥ 18 pt), 2.5 pt clear of the text; no group → draw on the whole rule. In both cases the
     underscores start 2.5 pt after a label that touches the rule and end 2.5 pt before a continuation that
     touches it (closer than about 1.7 pt and the reader glues text and underscores into one word).
   Underscores are written per page through the page's own `Shape` (Helvetica 11 pt, black, baseline
   0.5 pt above the rule's top, `n = floor(width / width_of("_"))`) after `page.wrap_contents()`, so a
   transform the page's content left open cannot shift them. Runs side by side (baselines within 9 pt) are
   kept at least 12 pt apart (whole underscores are trimmed, the later run is dropped if need be; a run
   overlapping an earlier one is dropped): closer, the reader would merge them into one text line whose box
   swallows a "/" or "-" written between them and the engine would drop it. The copy is then read back
   twice: every underscore run must sit on its rule (a pure-underscore word starting within 2 pt of the run,
   or a word glued to a touching label that ends within 2 pt of the run's end, with the rule's top inside the
   word's box); and the engine's own page clean-up (`RawPageFitz.restore` + `clean_up` with the conversion's
   default settings, which is where it drops lines it sees as overlapped; a dropped line is not deleted but
   given an empty box, so those are skipped) is run on the original page and on the pre-passed page, and
   every visible character of the original, typed underscores included, must survive on the copy at the
   same place (character, x centre, y centre rounded to points, 1 pt of slack). Either failure makes the
   pre-pass raise and the original is converted. If nothing was drawn, the original is converted and no copy is written.
   Scanned PDFs have no drawings, so nothing happens to them. The guiding rule: never draw where text is;
   when unsure, leave the rule alone, so the worst case is a blank that stays missing, as today.
2. **Engine patch (word spaces).** Replace `pdf2docx.text.Spans.Spans.restore` with a version that,
   on meeting a whitespace-only unstyled text span, remembers it and adds nothing; when the next
   real text span arrives and the previous appended span is a `TextSpan` whose text does not
   already end in a space, append `' '` to its last character (`prev.chars[-1].c += ' '`, the same
   trick pdf2docx itself uses in `Lines.py` for line joins). Leading or trailing blank spans on a
   line are still dropped, as today. No new spans are created, so blocks, lines and sections are
   detected exactly as before.
3. **Convert.** `Converter(pre.pdf).convert(out.docx, raw_exceptions=True)`: a page the engine cannot handle
   on the copy raises instead of being skipped quietly, so the fallback below runs on the original (which is
   converted with the engine's defaults, exactly as today).

Error handling:

- If step 1 raises for any reason, write the reason to stderr and convert `in.pdf` instead. The
  tool is never worse than today.
- If step 3 raises on the pre-passed copy, write the reason to stderr and convert `in.pdf` instead. If
  that raises too, or `out.docx` is missing, exit non-zero; `convert.js` keeps its existing
  message ("This PDF could not be turned into Word. Scanned PDFs need "Scan → Text" first.").

### `src/tools/convert.js`

`pdfToWord.run` calls `run('python3', ['-I', `${config.toolsDir}/pdf-word.py`, inPath, outPath,
tmpPath(dir, 'pdf-word-pre.pdf')], …)` with the same `cwd`, `timeoutSec: timeouts.heavy()`,
`memMb: 4096` (the cap the face-blur helper uses; a 3-page form peaks near 120 MB) and
`OPENBLAS_NUM_THREADS: '2'`. Same runner, same worker user.
No change to `run.js`, the Dockerfile or the sudoers file.

### Tests (`test/api.test.js`)

`makeFixtures` adds `form.pdf` (pdf-lib, one A4 page), with rows kept apart by full sentences so the
engine does not read neighbouring fragments as a borderless table:

- "Name:" then a black rule 0.8 pt tall, 200 pt wide, then "(as on the share certificate)";
- "Place:" and "Date:" each followed by a blank, the two blanks drawn as ONE path holding two rectangles;
- "Holder:" then a 315 pt rule with the value "Ram Kumar" already written on it;
- "Address:" at 11 pt with a blank, 14 pt under the line above (single-spaced);
- a sentence drawn word by word at 12 pt with each space drawn as its own piece at 14.7 pt;
- three thin black rules that are not blanks: a 14 pt heading "ACME Corporation Ltd" with a full-width
  border 1 pt under its descender, a table row "Item / Qty / Price" over a full-width horizontal-only rule
  at underline position, and a bare full-width divider;
- a 3-column table with a grey (0.73) grid of 0.7 pt rectangles and the header "Folio Number",
  "Face value", "Certificate No";
- page 2, whose content starts with a translation transform that is never undone: a title "INVOICE" over a
  page-wide rule at underline position, a blank after "Ref:", a one-cell row "Total" over a page-wide rule,
  a divider with "Right column body text here" beside it in another column, and "Code:" with a blank on
  which the value "AB-12" is typed 2 pt below the rule's top, all separated by full sentences;
- page 3, with an offset CropBox: "Pin:" with a blank, then "Next paragraph of text."

The PDF → Word test converts `form.pdf`, reads `word/document.xml` out of the .docx (Python `zipfile`
one-liner through `execFileSync`; `unzip` is not guaranteed on the box), turns `</w:p>` and `<w:br/>` into
newlines and drops the other tags without adding spaces (so glued words stay glued), and asserts:

- each of `Name:`, `Place:`, `Date:`, `Ram Kumar`, `Address:`, `Ref:`, `AB-12`, `Pin:` is followed (after
  optional whitespace) by 5+ underscores;
- `have hereunto set their respective hands` appears with spaces;
- `ACME Corporation Ltd`, `Item`, `Qty`, `Price`, `Folio Number`, `Certificate No`, `INVOICE`, `Total`,
  `Right column body text here`, `Next paragraph of text.` appear, and none of them is followed by
  underscores;
- exactly 8 runs of 3+ underscores (nothing on headings, table rules, dividers, the grid, or the line after
  a blank on the transformed and cropped pages).

The existing `text.pdf` → .docx assertion stays.

### Docs

- README tool table, PDF → Word row: "An editable .docx with flowing paragraphs; fill-in blanks
  and word spacing kept".
- On-page hint in `public/app.js` for `pdf-word`: "Text and layout are rebuilt into an editable
  Word file; fill-in blanks stay as blanks. Scanned PDFs need "Scan → Text" first." The served
  `app.js` changes, which is the deploy-watch marker.
- `docs/DESIGN.md`: mention `pdf-word.py` next to pdf2docx.

### Rollout

New handling of user input → full pre-push panel (security-reviewer, bug-hunter, tester) plus the
secret/PII scan before pushing. Push to `origin` (both remotes). Watch
https://filepress-production.up.railway.app until `/app.js` contains "fill-in blanks stay as
blanks"; report LIVE / BUILDING / FAILED.

## Known limits (accepted 2026-11-09, after three review rounds)

- **Layout drift.** Adding underscores gives the engine more text to analyse, so a "Label: ____" row may
  come out as a two-cell borderless table or merge with a neighbour line where the plain engine made
  separate paragraphs. The words and their order are preserved; the test checks presence and order, not
  paragraph or table counts. Starting the underscores 2.5 pt after a touching label removes the worst case.
- **The guards cost time.** The engine's page clean-up runs twice more for every page that got underscores.
  Measured: the three-page affidavit 3 s in all; a 60-page document with a blank on every page 25 s against
  15 s for the plain engine. Pages without blanks pay nothing. Well inside the 480 s tool timeout.
- **A page error on the copy costs a second run.** With `raw_exceptions=True` the engine stops at the first
  failing page of the copy and the original is converted from scratch, inside the same 480 s timeout. A file
  that the plain engine converted in more than about half the timeout, with a page that fails only on the
  copy, can now time out. Judged rare; the alternative (skipping the page quietly) loses content.
- **Memory cap.** The tool now runs under a 4 GB address-space cap like the face-blur helper; measured: 450
  text pages pass at 2.1 GB resident. Very large image-heavy PDFs that only ever worked because there was no
  cap may now fail with the "needed too much memory" message.
- **Blanks the detector will not touch**, by design (nothing is drawn, as today): a blank with no label or
  continuation within 8 pt on its line (a bare address-continuation line, a label followed by a tab stop); a
  blank whose text sits exactly where the rule starts with nothing after the rule; a value with a wide gap
  between its words; rotated pages; stroked (not filled) rules.

## Non-goals

- Side-by-side boxes (floating frames). Follow-up.
- Blanks as underlined tabs instead of underscores. Underscores are real glyphs and survive the
  engine; underlined spaces would be trimmed by its whitespace stripping.
- Any change to the other tools or to the runner.
