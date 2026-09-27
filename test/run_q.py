import json, subprocess, time
from playwright.sync_api import sync_playwright
ROOT='/home/claude/pereplet'
exec(open('run.py').read().split("srv = subprocess")[0].split("mock = open")[0])
mock = open(ROOT + '/test/mock.js').read().replace('__GUIDE__', json.dumps(guide)).replace('__META__', json.dumps(meta))
mock = mock.replace("window.claude = {", "store.set('lib/quotes', " + open(ROOT+'/seed/quotes.json').read() + ");\n  window.claude = {")
page_html = open(ROOT + '/dist/aynobook.html').read()
skel = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
open(ROOT + '/test/index.html', 'w').write(skel + page_html + '</body></html>')
srv = subprocess.Popen(['python3','-m','http.server','8765','--bind','127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
logs=[]
try:
  with sync_playwright() as p:
    br=p.chromium.launch(); pg=br.new_page(viewport={'width':1360,'height':860})
    pg.on('pageerror', lambda e: logs.append('PAGEERROR '+str(e)))
    pg.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
    pg.add_init_script(mock); pg.goto('http://127.0.0.1:8765/test/index.html')
    pg.wait_for_selector('#regForm'); pg.click('#regGo'); pg.wait_for_selector('#app:not([hidden])'); time.sleep(1.8)
    pg.click('.tabs [data-go=quotes]'); time.sleep(1.8)
    pg.screenshot(path=OUT+'/20_quotes.png', full_page=True)
    seen=[pg.inner_text('.qtext')]
    for i in range(8):
      pg.click('[data-qnext]'); time.sleep(0.7); seen.append(pg.inner_text('.qtext'))
    print('shown', len(seen), 'unique', len(set(seen)), '| count', pg.inner_text('#qCount'), '|', pg.inner_text('.qleft'))
    st = pg.evaluate("JSON.stringify(window.__mock.store.get('data/users/u_test123/quotes'))")
    print('stored seen:', len(json.loads(st)['seen']))
    pg.click('.tabs [data-go=library]'); time.sleep(0.6); pg.click('.tabs [data-go=quotes]'); time.sleep(1.2)
    print('revisit keeps current:', pg.inner_text('.qtext') == seen[-1], '| count', pg.inner_text('#qCount'))
    pg.set_viewport_size({'width':390,'height':844}); time.sleep(0.6); pg.screenshot(path=OUT+'/21_quotes_mobile.png')
    br.close()
finally: srv.terminate()
print('\n'.join(logs) or 'no page errors')
