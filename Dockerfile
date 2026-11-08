# Filepress: Node app + the PDF engines it shells out to. Built for Railway (any Docker host works).
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PIP_BREAK_SYSTEM_PACKAGES=1

# Engines: Ghostscript (compress), qpdf (merge/split/rotate/protect), Poppler (pdftoppm/pdfinfo),
# LibreOffice (Office -> PDF), OCRmyPDF + Tesseract eng/tel (Scan -> Text), img2pdf + ImageMagick (pictures),
# pdf2docx (PDF -> Word), util-linux for prlimit, coreutils timeout, sudo for the user switch, dumb-init as PID 1.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript qpdf poppler-utils img2pdf imagemagick \
      ocrmypdf tesseract-ocr-eng tesseract-ocr-tel \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-dejavu-core fonts-noto-core \
      python3 python3-pip libglib2.0-0 util-linux sudo dumb-init ca-certificates \
    && pip3 install --no-cache-dir "pdf2docx==0.5.13" "pymupdf==2.1" "numpy==2.5.4" "opencv-python-headless==5.0.0.93" \
    && python3 -c "import pdf2docx, numpy, cv2, fitz" \
    && apt-get purge -y python3-pip && apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/*

# Two unprivileged users: "app" runs the web server, "worker" runs the converters (via sudo, see deploy/sudoers-filepress).
# They share the "jobs" group; job folders are group-writable thanks to the setgid bit on /data/jobs.
RUN groupadd -r jobs \
    && useradd -r -u 10001 -m -d /home/app -s /usr/sbin/nologin -G jobs app \
    && useradd -r -u 10002 -M -s /usr/sbin/nologin -G jobs worker \
    && mkdir -p /data/jobs && chown app:jobs /data/jobs && chmod 2770 /data/jobs

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY deploy/sudoers-filepress /etc/sudoers.d/filepress
# Application code stays owned by root and read-only for both users.
RUN chmod 0440 /etc/sudoers.d/filepress && visudo -cf /etc/sudoers.d/filepress && chmod -R a-w /app

USER app
ENV PORT=8080 JOBS_DIR=/data/jobs HOME=/home/app WORKER_USER=worker
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["dumb-init", "node", "src/server.js"]
