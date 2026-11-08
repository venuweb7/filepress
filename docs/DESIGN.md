# Filepress — design notes

A self-hosted PDF toolbox in the spirit of iLovePDF, built so that documents never leave a server we control.
Approved from the "version 2" prototype on 2026-11-08.

## Shape

```
browser (public/)  ──multipart──▶  POST /api/jobs  ──▶  job folder  ──▶  queue (p-queue, N workers)
      ▲                                                              │
      └──── poll GET /api/jobs/:id ◀────────────────────────────────┘ tool.run() shells out to an engine
                                   GET /api/jobs/:id/download · DELETE /api/jobs/:id
                                   sweeper wipes <jobsDir>/<id> RETENTION_MIN after the job ends
```

* **One container, no database.** Jobs live in memory and on local disk under `JOBS_DIR/<uuid>/{in,out,tmp}`.
  A restart forgets everything, which is fine: nothing is meant to outlive the hour anyway.
* **Engines** (all Debian packages, pinned by the base image): Ghostscript (compress), qpdf (merge, split,
  rotate, protect), Poppler (`pdftoppm`, `pdfinfo`), LibreOffice headless (Office → PDF), OCRmyPDF + Tesseract
  `eng`/`tel` (Scan → Text), img2pdf + ImageMagick (pictures), pdf2docx (PDF → Word), pdf-lib in a separate
  Node worker process (page numbers, signatures).
* **Front end** is plain HTML/CSS/JS, served statically. Hash routes: `#start`, `#work[/tool]`, `#run/<id>`, `#done/<id>`.
  Options are kept per tool, an upload is cancelled when you leave the screen, and Back works from the result page.

## Safety

* **Two users.** The web server runs as `app`; every converter runs as `worker` through `sudo` (the only
  allowed command is `env`, see `deploy/sudoers-filepress`). A bug in Ghostscript or LibreOffice therefore cannot
  read the server's environment (secrets) or touch its code. Job folders are shared through the `jobs` group
  (setgid on `/data/jobs`, umask 007). `/app` is root-owned and read-only.
* **Every engine runs through `src/run.js`:** no shell, argument arrays only, minimal environment, `HOME`/`TMPDIR`
  inside the job folder, wall-clock timeout enforced by `timeout -s KILL` (kills the whole process group, even
  across the user switch), CPU cap and address-space cap via `prlimit`, capped output. A deleted job stops its converter.
* **pdf-lib never runs in the web process.** Page numbers and signatures run in `stamp-worker.js`, a child
  Node with a heap cap and timeout. Signature pictures are checked from the PNG header (size and dimensions)
  before anything decodes them.
* **Ghostscript** runs with `-dSAFER`. **LibreOffice** gets a fresh profile per job pre-seeded with macros
  disabled, link updates off and untrusted referer links blocked, plus `--safe-mode`.
* **Limits:** per-file size, files per request, whole-request size (`Content-Length`), page count for page-by-page
  tools, pixel budget for PDF → JPG, queue length (503 when busy), rate limits on unlock (per IP and global) and
  on job creation.
* **Uploads:** extension allow-list, magic-byte check, sanitised names (also `%` and bidi control characters),
  random UUID folder per job, no user-controlled paths anywhere.
* **Access:** every browser gets a signed `httpOnly` cookie; jobs are bound to that session, so a job id alone
  is not enough to read someone else's result. Optional `ACCESS_CODE` (min 8 chars) gates the whole app; the code
  is part of the cookie signature, so changing it logs everyone out, and unlocking issues a fresh session id.
  `SESSION_SECRET`, if set, must be at least 32 characters.
* **Secrets in flight:** the Protect password goes to qpdf through a private argument file (never on the command
  line) and is dropped from memory as soon as the job ends. Logs never contain file names, passwords or contents.
* **Headers:** strict CSP (`'self'` only, no inline scripts/styles), `nosniff`, `DENY` framing, no referrer,
  COOP/CORP same-origin, HSTS when served over https.

## Limits and known trade-offs

* "Sealed box per job" means a separate user + fresh temp folder + resource caps, not a separate container per
  job and not a network namespace: converters can still reach the network. Keep the image rebuilt regularly
  so the engines pick up security patches.
* PDF → Word quality depends on the PDF; scans need OCR first. Typed signatures use a Latin handwriting font;
  other scripts must be drawn.
* Signatures are placed in a chosen corner of chosen pages (honouring page rotation and crop box); free
  placement on a page preview is a later step.
* LibreOffice needs ~1–2 GB RAM while converting; `CONCURRENCY=2` is a sane default on a 4–8 GB box.

## Configuration

See `.env.example`. On Railway set `ACCESS_CODE` and `SESSION_SECRET` as service variables; everything else
has sensible defaults. The image exposes `8080` and answers `GET /healthz`.
