import subprocess, time
from playwright.sync_api import sync_playwright
ROOT='/home/claude/pereplet'
srv=subprocess.Popen(['python3','-m','http.server','8766','--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
logs=[]
try:
  with sync_playwright() as p:
    br=p.chromium.launch(); pg=br.new_page(viewport={'width':1360,'height':860})
    pg.on('pageerror', lambda e: logs.append('PAGEERROR '+str(e)))
    pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
    pg.goto('http://127.0.0.1:8766/index.html')
    pg.wait_for_selector('#app:not([hidden])', timeout=8000); time.sleep(1.5)
    print('tiles:', pg.evaluate("document.querySelectorAll('.tile').length"), '| admin tab hidden:', pg.evaluate("document.querySelector('.tabs [data-go=admin]').hidden"))
    pg.screenshot(path=ROOT+'/test/shots/30_public.png')
    pg.click('.tile >> nth=0'); time.sleep(0.6); pg.click('#bsRead')
    pg.wait_for_function("document.querySelector('#rdFolio').textContent.length>0", timeout=10000); time.sleep(1)
    pg.keyboard.press('ArrowRight'); time.sleep(0.6); pg.keyboard.press('b'); time.sleep(0.5)
    print('reader folio:', pg.inner_text('#rdFolio'), '| ribbon:', pg.evaluate("document.querySelector('#rdRibbon').classList.contains('on')"))
    pg.keyboard.press('Escape'); time.sleep(2.5)
    print('saved locally:', pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('pereplet:data/users/guest')).length"))
    pg.click('.tabs [data-go=quotes]'); time.sleep(1.2)
    print('quote shown:', bool(pg.inner_text('.qtext')), pg.inner_text('#qCount'))
    br.close()
finally: srv.terminate()
print('\n'.join(logs) or 'no page errors')
