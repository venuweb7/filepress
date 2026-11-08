# Filepress

Private PDF tools on your own server. Drop a file, pick a job, download the result. Everything is processed
locally in the container and wiped an hour later. No third party ever sees a page.

**Tools:** Compress · Merge · Split · PDF → Word · Office → PDF · PDF → JPG · JPG → PDF · Scan → Text (OCR,
English + Telugu) · Sign · Rotate · Protect · Page numbers.

## Run it

```bash
docker build -t filepress .
docker run -p 8080:8080 -e ACCESS_CODE=choose-a-code filepress
# open http://localhost:8080
```

On Railway: create a service from this repo (the Dockerfile is picked up automatically), then add the
variables `ACCESS_CODE` and `SESSION_SECRET`. Nothing else is required.

## Develop

Needs Node 22+ and the engines listed in the Dockerfile (`apt-get install ghostscript qpdf poppler-utils
libreoffice-writer libreoffice-calc libreoffice-impress ocrmypdf tesseract-ocr-eng tesseract-ocr-tel img2pdf
imagemagick` plus `pip install pdf2docx`).

```bash
npm install
npm start          # http://localhost:8080
npm test           # end-to-end: every tool through the HTTP API with real files
```

Settings are environment variables; see `.env.example`. Design notes in `docs/DESIGN.md`.

## License

MIT for this code (`LICENSE`). Bundled fonts are under the SIL Open Font License and the engines keep their own
licences; see `licenses/README.md`.
