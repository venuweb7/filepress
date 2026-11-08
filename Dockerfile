# Pressa: Node app + the PDF engines it shells out to. Built for Railway (any Docker host works).
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PIP_BREAK_SYSTEM_PACKAGES=1

# Engines: Ghostscript (compress), qpdf (merge/split/rotate/protect), Poppler (pdftoppm/pdfinfo),
# LibreOffice (Office -> PDF), OCRmyPDF + Tesseract eng/tel (Scan -> Text), img2pdf + ImageMagick (pictures),
# pdf2docx (PDF -> Word), util-linux for prlimit, dumb-init as PID 1.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript qpdf poppler-utils img2pdf imagemagick \
      ocrmypdf tesseract-ocr-eng tesseract-ocr-tel \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation fonts-dejavu-core fonts-noto-core \
      python3 python3-pip libglib2.0-0 util-linux dumb-init ca-certificates \
    && pip3 install --no-cache-dir pdf2docx \
    && python3 -c "import pdf2docx, numpy, cv2, fitz" \
    && apt-get purge -y python3-pip && apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/*

# ImageMagick's default policy blocks PDF/PS; we only use it for pictures, but make sure it allows PNG/JPEG.
RUN sed -i 's/<policy domain="coder" rights="none" pattern="PDF" \/>/<!-- PDF via ghostscript is not used by ImageMagick here -->/' /etc/ImageMagick-6/policy.xml || true

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY assets ./assets

RUN useradd -r -u 10001 -m -d /home/app app && mkdir -p /data/jobs && chown -R app:app /data /app
USER app
ENV PORT=8080 JOBS_DIR=/data/jobs HOME=/home/app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["dumb-init", "node", "src/server.js"]
