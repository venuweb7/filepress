#!/usr/bin/env python3
"""Regenerate the README screenshots from the real app with Playwright (Chromium).

Starts the server on a spare port without an access code, drives the real UI with a sample PDF and
saves PNGs into docs/screenshots/. Run from the repo root:  python3 -I docs/make_screenshots.py
Needs: pip install playwright && playwright install chromium, ImageMagick (for the phone composite),
and the engines from the Dockerfile.
"""
import os, pathlib, random, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
TMP = ROOT / 'test' / 'tmp' / 'shots-readme'
TMP.mkdir(parents=True, exist_ok=True)
PORT = 19500 + random.randint(0, 400)
BASE = f'http://127.0.0.1:{PORT}'

# a realistic-looking sample: a few pages with a big picture, so Compress has something to show
pdf = TMP / 'holiday-photos.pdf'
if not pdf.exists():
    for i in range(3):
        subprocess.run(['convert', '-size', '2400x1800', 'plasma:fractal', '-quality', '100', str(TMP / f'p{i}.jpg')], check=True)
    subprocess.run(['img2pdf', '--pagesize', 'A4', *[str(TMP / f'p{i}.jpg') for i in range(3)], '-o', str(pdf)], check=True)

env = dict(os.environ, PORT=str(PORT), JOBS_DIR=str(TMP / 'jobs'), ACCESS_CODE='', TRUST_PROXY='0')
server = subprocess.Popen(['node', 'src/server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for _ in range(50):
    try:
        urllib.request.urlopen(BASE + '/healthz', timeout=1); break
    except Exception:
        time.sleep(0.2)
else:
    print(server.stdout.read()); sys.exit('server did not start')

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---- desktop ----
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1.5)
        pg = ctx.new_page(); pg.goto(BASE + '/'); pg.wait_for_function('document.fonts.ready.then(()=>true)'); pg.wait_for_timeout(1200)
        pg.screenshot(path=str(OUT / 'start.png'), clip={'x': 0, 'y': 0, 'width': 1280, 'height': 1180}, full_page=True)
        pg.set_input_files('#file0', str(pdf)); pg.wait_for_selector('section[data-view=work].on'); pg.wait_for_timeout(500)
        pg.click('#tiles1 .tile[data-id="compress"]'); pg.wait_for_timeout(3200)   # let the "file added" toast fade
        pg.screenshot(path=str(OUT / 'job.png'), full_page=True)
        pg.click('#go'); pg.wait_for_selector('section[data-view=run].on'); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(OUT / 'working.png'))
        pg.wait_for_selector('section[data-view=done].on', timeout=120_000); pg.wait_for_timeout(1800)
        pg.screenshot(path=str(OUT / 'result.png'), full_page=True)
        ctx.close()
        # ---- phone: start + result, composited side by side ----
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); pg.goto(BASE + '/'); pg.wait_for_function('document.fonts.ready.then(()=>true)'); pg.wait_for_timeout(1000)
        pg.screenshot(path=str(TMP / 'phone-start.png'))
        pg.set_input_files('#file0', str(pdf)); pg.wait_for_selector('section[data-view=work].on'); pg.wait_for_timeout(400)
        pg.click('#tiles1 .tile[data-id="compress"]'); pg.wait_for_timeout(3200)
        pg.screenshot(path=str(TMP / 'phone-job.png'))
        pg.click('#go2'); pg.wait_for_selector('section[data-view=done].on', timeout=120_000); pg.wait_for_timeout(1800)
        pg.screenshot(path=str(TMP / 'phone-result.png'))
        ctx.close(); b.close()
    subprocess.run(['convert', str(TMP / 'phone-start.png'), str(TMP / 'phone-job.png'), str(TMP / 'phone-result.png'),
                    '-bordercolor', '#F6F7FB', '-border', '24', '+append', '-resize', '1600x', str(OUT / 'phone.png')], check=True)
    for f in OUT.glob('*.png'):
        subprocess.run(['convert', str(f), '-strip', '-define', 'png:compression-level=9', str(f)], check=True)
        print(f.name, f.stat().st_size // 1024, 'KB')
finally:
    server.terminate()
