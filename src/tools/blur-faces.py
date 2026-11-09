#!/usr/bin/env python3
"""Blur every face in a picture.

Usage: blur-faces.py <model.onnx> <in> <out> <soft|normal|strong>   -> prints the number of faces found.

Face detection is OpenCV's YuNet model (assets/models, MIT licence), run locally through OpenCV's DNN
module. Nothing is downloaded and nothing leaves the machine.
"""
import sys
import cv2

model, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
strength = sys.argv[4] if len(sys.argv) > 4 else 'normal'

img = cv2.imread(src, cv2.IMREAD_UNCHANGED)
if img is not None and img.ndim == 2:
    img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
if img is None:
    sys.exit('could not read the picture')
h, w = img.shape[:2]

# Detect on a copy no wider than 1280 px (fast, and small faces are still found), then map boxes back.
scale = min(1.0, 1280 / max(w, h))
bgr = img[:, :, :3] if img.shape[2] == 4 else img   # the detector wants plain colour; transparency is kept for the output
small = cv2.resize(bgr, (max(1, int(w * scale)), max(1, int(h * scale)))) if scale < 1 else bgr
sh, sw = small.shape[:2]
det = cv2.FaceDetectorYN.create(model, "", (sw, sh), score_threshold=0.6, nms_threshold=0.3, top_k=500)
det.setInputSize((sw, sh))
_, faces = det.detect(small)

boxes = []
for f in (faces if faces is not None else []):
    x, y, bw, bh = (float(v) / scale for v in f[:4])
    boxes.append((int(x), int(y), int(bw), int(bh)))

factor = {'soft': 0.22, 'normal': 0.35, 'strong': 0.55}.get(strength, 0.35)
for (x, y, bw, bh) in boxes:
    pad = int(max(bw, bh) * 0.2)
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(w, x + bw + pad), min(h, y + bh + pad)
    if x1 <= x0 or y1 <= y0:
        continue
    region = img[y0:y1, x0:x1]
    k = max(3, int(min(x1 - x0, y1 - y0) * factor) | 1)   # odd kernel, scaled to the face
    img[y0:y1, x0:x1] = cv2.GaussianBlur(region, (k, k), 0)

ok = cv2.imwrite(dst, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
if not ok:
    sys.exit('could not write the result')
print(len(boxes))
