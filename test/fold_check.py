#!/usr/bin/env python3
"""Does the start page show both rows of tools without scrolling on common laptop screens?
Starts the server on a spare port and measures the bottom edge of the last tool tile.
Run from the repo root:  python3 -I test/fold_check.py
"""
import os, pathlib, random, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'test' / 'tmp' / 'fold'; OUT.mkdir(parents=True, exist_ok=True)
PORT = 19900 + random.randint(0, 90); BASE = f'http://127.0.0.1:{PORT}'
env = dict(os.environ, PORT=str(PORT), JOBS_DIR=str(OUT / 'jobs'), ACCESS_CODE='', TRUST_PROXY='0')
server = subprocess.Popen(['node', 'src/server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for _ in range(50):
    try: urllib.request.urlopen(BASE + '/healthz', timeout=1); break
    except Exception: time.sleep(0.2)
bad = 0
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h in [(1440, 900), (1536, 864), (1366, 768), (1280, 720), (1920, 1080)]:
            pg = b.new_page(viewport={'width': w, 'height': h}); pg.goto(BASE + '/'); pg.wait_for_function('document.fonts.ready.then(()=>true)'); pg.wait_for_timeout(500)
            r = pg.evaluate("() => { const t=[...document.querySelectorAll('#tiles0 .tile')]; const last=t[t.length-1].getBoundingClientRect(); const top=document.querySelector('#orbit').getBoundingClientRect(); return {tilesBottom: Math.round(last.bottom), scrollW: document.documentElement.scrollWidth, innerW: innerWidth}; }")
            ok = r['tilesBottom'] <= h and r['scrollW'] <= r['innerW']
            print(f"{w}x{h}: last tile bottom at {r['tilesBottom']}px of {h}px -> {'fits' if ok else 'DOES NOT FIT'}")
            if not ok: bad += 1
            pg.screenshot(path=str(OUT / f'start-{w}x{h}.png'))
            pg.close()
        b.close()
finally:
    server.terminate()
sys.exit(1 if bad else 0)
