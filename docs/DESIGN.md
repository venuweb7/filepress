# Pressa — design notes

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
  `eng`/`tel` (Scan → Text), img2pdf + ImageMagick (pictures), pdf2docx (PDF → Word), pdf-lib in Node
  (page numbers, signatures).
* **Front end** is plain HTML/CSS/JS, served statically. Hash routes: `#start`, `#work[/tool]`, `#run/<id>`, `#done/<id>`.

## Safety

* Every engine runs through `src/run.js`: no shell, argument arrays only, minimal environment, `HOME`/`TMPDIR`
  inside the job folder, wall-clock timeout, CPU cap via `prlimit`, process-group kill, capped output.
* Ghostscript runs with `-dSAFER`. LibreOffice gets a fresh profile per job (`-env:UserInstallation`).
* Uploads: extension allow-list, magic-byte check, per-file and per-request limits, sanitised names, random
  UUID folder per job, no user-controlled paths anywhere.
* Access: every browser gets a signed `httpOnly` cookie; jobs are bound to that session, so a job id alone
  is not enough to read someone else's result. Optional `ACCESS_CODE` gates the whole app. Rate limits on
  unlock attempts and job creation.
* Headers: strict CSP (`'self'` only, no inline scripts/styles), `nosniff`, `DENY` framing, no referrer.
* Container runs as an unprivileged user. Nothing is logged about file contents or passwords.

## Limits and known trade-offs

* "Sealed box per job" means process isolation + fresh temp folder, not a separate container per job.
* PDF → Word quality depends on the PDF; scans need OCR first.
* Signatures are placed in a chosen corner of chosen pages; free placement on a page preview is a later step.
* LibreOffice needs ~1–2 GB RAM while converting; `CONCURRENCY=2` is a sane default on a 4–8 GB box.

## Configuration

See `.env.example`. On Railway set `ACCESS_CODE` and `SESSION_SECRET` as service variables; everything else
has sensible defaults. The image exposes `8080` and answers `GET /healthz`.
