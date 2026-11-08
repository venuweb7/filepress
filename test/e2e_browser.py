#!/usr/bin/env python3
"""Real-browser check of the Pressa front end with Playwright (Chromium).

Starts the server on a spare port, uploads a real PDF through the UI, runs Compress, waits for the
result page, verifies the download, then takes screenshots at laptop and phone sizes and runs the same
measured layout checks as the prototypes (sideways scroll, clipped labels, overlapping labels).

Run from the repo root:  python3 -I test/e2e_browser.py
Needs: pip install playwright && playwright install chromium ; the engines from the Dockerfile.
"""
import json, os, subprocess, sys, time, pathlib, random, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = ROOT / 'test' / 'tmp'
SHOTS = TMP / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 19000 + random.randint(0, 999)
BASE = f'http://127.0.0.1:{PORT}'
CODE = 'browser-code-42'

# a fixture PDF with a picture, same recipe as the API tests
FIX = TMP / 'fixtures'
FIX.mkdir(parents=True, exist_ok=True)
pdf = FIX / 'browser.pdf'
if not pdf.exists():
    subprocess.run(['convert', '-size', '2000x1500', 'plasma:fractal', '-quality', '98', str(FIX / 'b.jpg')], check=True)
    subprocess.run(['img2pdf', str(FIX / 'b.jpg'), str(FIX / 'b.jpg'), str(FIX / 'b.jpg'), '-o', str(pdf)], check=True)

env = dict(os.environ, PORT=str(PORT), JOBS_DIR=str(TMP / 'jobs-browser'), ACCESS_CODE=CODE, TRUST_PROXY='0')
server = subprocess.Popen([sys.executable.replace('python3', 'node') if False else 'node', 'src/server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for _ in range(50):
    try:
        urllib.request.urlopen(BASE + '/healthz', timeout=1); break
    except Exception:
        time.sleep(0.2)
else:
    print(server.stdout.read()); sys.exit('server did not start')

CHECK = r'''() => {
  const out={scrollW:document.documentElement.scrollWidth, innerW:innerWidth, clipped:[], overlap:[]};
  for(const el of document.querySelectorAll('section.on *, header *')){
    const cs=getComputedStyle(el); if(cs.display==='none'||el.offsetParent===null)continue;
    if(cs.whiteSpace==='nowrap'&&cs.overflow!=='hidden'&&cs.textOverflow!=='ellipsis'&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+1)out.clipped.push(el.tagName+'.'+[...el.classList].join('.')+' "'+(el.textContent||'').trim().slice(0,24)+'"');
  }
  for(const grp of document.querySelectorAll('section.on .tiles, section.on .seg, section.on .sizes')){
    const items=[...grp.querySelectorAll(':scope > * b, :scope > button')].filter(e=>e.offsetParent!==null);
    const rs=items.map(e=>{const r=document.createRange();r.selectNodeContents(e);return {e,r:r.getBoundingClientRect()}}).filter(x=>x.r.width>0);
    for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i].r,b=rs[j].r;if(a.left<b.right-.5&&b.left<a.right-.5&&a.top<b.bottom-.5&&b.top<a.bottom-.5)out.overlap.push(rs[i].e.textContent.trim().slice(0,14)+' x '+rs[j].e.textContent.trim().slice(0,14));}
  }
  return out;
}'''
issues = []
def check(pg, tag):
    r = pg.evaluate(CHECK)
    if r['scrollW'] > r['innerW']: issues.append(f'{tag}: sideways scroll {r["scrollW"]}>{r["innerW"]}')
    issues.extend(f'{tag}: clipped {c}' for c in r['clipped'])
    issues.extend(f'{tag}: overlap {c}' for c in r['overlap'])

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h in [(1440, 900), (390, 844), (360, 780)]:
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, accept_downloads=True)
            pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '401' not in m.text else None)  # the deliberate wrong-code try logs a 401
            pg.goto(BASE + '/'); pg.wait_for_function('document.fonts.ready.then(()=>true)'); pg.wait_for_timeout(600)
            # gate
            assert pg.is_visible('#gate'), 'gate should show when ACCESS_CODE is set'
            pg.fill('#gateCode', 'wrong'); pg.click('#gateForm button'); pg.wait_for_timeout(400)
            assert pg.is_visible('#gateErr'), 'wrong code should show an error'
            pg.fill('#gateCode', CODE); pg.click('#gateForm button'); pg.wait_for_selector('#gate', state='hidden')
            pg.screenshot(path=str(SHOTS / f'start-{w}.png'), full_page=True); check(pg, f'start@{w}')
            # upload through the real file input, pick compress, run
            pg.set_input_files('#file0', str(pdf)); pg.wait_for_selector('section[data-view=work].on')
            pg.wait_for_timeout(500); pg.screenshot(path=str(SHOTS / f'work-{w}.png'), full_page=True); check(pg, f'work@{w}')
            assert pg.locator('#tiles1 .tile.sug').get_attribute('data-id') == 'compress', 'big PDF should suggest compress'
            pg.click('#tiles1 .tile[data-id="compress"]'); pg.wait_for_timeout(700)
            pg.screenshot(path=str(SHOTS / f'options-{w}.png'), full_page=True); check(pg, f'options@{w}')
            pg.click('#optin .seg button[data-v="smallest"]'); pg.wait_for_timeout(300)
            pg.click('#go2' if w <= 720 else '#go')
            pg.wait_for_selector('section[data-view=run].on'); pg.wait_for_timeout(400)
            pg.screenshot(path=str(SHOTS / f'run-{w}.png'), full_page=True)
            pg.wait_for_selector('section[data-view=done].on', timeout=120_000); pg.wait_for_timeout(1600)
            pg.screenshot(path=str(SHOTS / f'done-{w}.png'), full_page=True); check(pg, f'done@{w}')
            before = pg.text_content('#dBefore'); after = pg.text_content('#dAfter')
            assert before != after, f'sizes should differ ({before} vs {after})'
            with pg.expect_download() as dl:
                pg.click('#dl')
            path = dl.value.path(); assert os.path.getsize(path) > 1000 and dl.value.suggested_filename.endswith('-compressed.pdf'), 'download'
            # chain into rotate, then delete
            pg.click('#tiles2 .tile[data-id="rotate"]'); pg.wait_for_selector('section[data-view=work].on'); pg.wait_for_timeout(500)
            assert 'result of the last job' in pg.text_content('#files'), 'chained file should be listed'
            pg.click('#go2' if w <= 720 else '#go'); pg.wait_for_selector('section[data-view=done].on', timeout=120_000); pg.wait_for_timeout(800)
            pg.click('#del'); pg.wait_for_timeout(1600)
            assert pg.is_visible('section[data-view=start].on'), 'delete should return to start'
            if errs: issues.extend(f'@{w}: JS error {e}' for e in errs)
            ctx.close()
        b.close()
finally:
    server.terminate()
print('ISSUES:', len(issues))
for i in issues: print(' -', i)
sys.exit(1 if issues else 0)
