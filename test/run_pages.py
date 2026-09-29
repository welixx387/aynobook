import subprocess, time
from playwright.sync_api import sync_playwright
ROOT='/home/claude/pereplet'
srv=subprocess.Popen(['python3','-m','http.server','8767','--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]
try:
  with sync_playwright() as p:
    br=p.chromium.launch()
    for vw,vh in [(390,844),(1360,860)]:
      pg=br.new_page(viewport={'width':vw,'height':vh}); pg.on('pageerror', lambda e: errs.append(str(e)))
      pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
      pg.goto('http://127.0.0.1:8767/index.html'); pg.wait_for_selector('#app:not([hidden])'); time.sleep(1)
      pg.click('.tile:has-text("Хладнокровие")'); time.sleep(0.6); pg.click('#bsRead')
      pg.wait_for_function("document.querySelector('#rdFolio').textContent.length>0", timeout=15000); time.sleep(1)
      cw = pg.evaluate("getComputedStyle(document.querySelector('#rdFlow')).columnWidth")
      seq=[]
      for i in range(6):
        seq.append(pg.inner_text('#rdFolio') + ' ' + pg.inner_text('#rdChap')[:14]); pg.keyboard.press('ArrowRight'); time.sleep(0.7)
      print(vw, 'column-width', cw, '|', ' → '.join(seq))
      pg.close()
    br.close()
finally: srv.terminate()
print(errs or 'no page errors')
