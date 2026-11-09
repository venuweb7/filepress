# Third-party licences

The application code is MIT (see `../LICENSE`). The repository also redistributes these fonts, all under the
SIL Open Font License 1.1 (full text in `OFL-1.1.txt`):

| Font | Where | Copyright |
|---|---|---|
| Outfit | `public/fonts/Outfit.woff2` | Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts) |
| Plus Jakarta Sans | `public/fonts/PlusJakartaSans.woff2` | Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans) |
| Caveat | `assets/fonts/Caveat.ttf` | Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat) |

One machine-learning model is redistributed as well, under the MIT licence (full text in `YUNET-MODEL-LICENSE.txt`):

| Model | Where | Copyright |
|---|---|---|
| YuNet face detector | `assets/models/face_detection_yunet_2023mar.onnx` | Copyright 2020 Shiqi Yu, from the OpenCV Model Zoo (https://github.com/opencv/opencv_zoo) |

The engines the container installs keep their own licences: Ghostscript (AGPL-3.0), LibreOffice (MPL-2.0),
qpdf (Apache-2.0), Poppler (GPL-2.0), Tesseract (Apache-2.0), OCRmyPDF (MPL-2.0), img2pdf (LGPL-3.0),
ImageMagick (ImageMagick License), pdf2docx (AGPL-3.0), PyMuPDF (AGPL-3.0), OpenCV (Apache-2.0). They are used as separate
programs over the command line, unmodified.
