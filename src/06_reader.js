
/* ================= book content ================= */
const Content = (() => {
  const cache = new Map();
  function prep(c) {
    c.chapters = (Array.isArray(c.chapters) ? c.chapters : []).filter(x => x && Array.isArray(x.b) && x.b.length).map(x => ({ t: String(x.t || ''), l: x.l || 1, part: !!x.part, b: x.b.map(String) }));
    if (!c.chapters.length) throw new Error('В книге нет текста.');
    c._lens = c.chapters.map(x => x.b.map(textLen));
    c._pre = c._lens.map(ls => { const a = [0]; for (const l of ls) a.push(a[a.length - 1] + l); return a; });
    c._starts = []; let acc = 0;
    c._pre.forEach(a => { c._starts.push(acc); acc += a[a.length - 1]; });
    c._total = Math.max(1, acc);
    c._plain = [];
    return c;
  }
  async function load(b) {
    if (cache.has(b.id)) return cache.get(b.id);
    let text;
    const ref = b.content || {};
    if (ref.kind === 'asset' && safeId(ref.id)) {
      const res = await fetch('/_blob/' + ref.id);
      if (!res.ok) throw new Error(res.status === 404 ? 'Файл книги не найден: возможно, его удалили.' : `Не удалось загрузить книгу (код ${res.status}).`);
      text = await res.text();
    } else if (ref.kind === 'db' && ref.parts > 0) {
      const parts = new Array(ref.parts); let i = 0;
      const worker = async () => { while (i < ref.parts) { const k = i++; const snap = await S.db.doc(`books/${b.id}/parts/${k}`).get(); if (!snap.exists) throw new Error('Часть книги не найдена.'); parts[k] = snap.data().d; } };
      await Promise.all([worker(), worker(), worker()]);
      text = parts.join('');
    } else throw new Error('У этой книги нет текста.');
    let c;
    try { c = JSON.parse(text); } catch { throw new Error('Файл книги повреждён.'); }
    prep(c);
    cache.set(b.id, c);
    if (cache.size > 3) cache.delete(cache.keys().next().value);
    return c;
  }
  return { load, drop: id => cache.delete(id) };
})();

/* ================= sanitizer ================= */
const OK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'EM', 'STRONG', 'U', 'S', 'SUB', 'SUP', 'SMALL', 'CODE', 'BR', 'IMG', 'FIGURE', 'HR', 'PRE', 'DIV', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'SPAN', 'B', 'I']);
const KILL = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TEMPLATE', 'VIDEO', 'AUDIO', 'SOURCE', 'BASE', 'FRAME', 'FRAMESET', 'NOSCRIPT', 'TITLE']);
function sanitize(root) {
  for (const el of [...root.querySelectorAll('*')]) {
    const tg = el.tagName.toUpperCase();
    if (!OK_TAGS.has(tg)) { if (KILL.has(tg)) el.remove(); else el.replaceWith(...el.childNodes); continue; }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value;
      if (n === 'class' && /^[a-z0-9 -]{0,40}$/.test(v)) continue;
      if (tg === 'IMG' && n === 'src' && (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(v) || /^\/_blob\/[A-Za-z0-9_-]+$/.test(v))) continue;
      if (tg === 'IMG' && n === 'alt') continue;
      if ((n === 'colspan' || n === 'rowspan') && /^\d{1,2}$/.test(v)) continue;
      el.removeAttribute(a.name);
    }
  }
}

/* ================= reader ================= */
const FONTS = { 'Literata': '"Literata", Georgia, serif', 'PT Serif': '"PT Serif", Georgia, serif', 'Lora': '"Lora", Georgia, serif', 'Plex Sans': '"IBM Plex Sans", system-ui, sans-serif' };
const THEMES = [
  { id: 'auto', n: 'Как в Claude', bg: 'var(--surface)', fg: 'var(--ink)' }, { id: 'paper', n: 'Бумага', bg: '#F7F5EF', fg: '#1F1E1A' },
  { id: 'sepia', n: 'Сепия', bg: '#EFE3CA', fg: '#3B2E1F' }, { id: 'mist', n: 'Туман', bg: '#DCE3DE', fg: '#1A2622' },
  { id: 'night', n: 'Ночь', bg: '#131915', fg: '#C9D2CC' }, { id: 'ink', n: 'Чернила', bg: '#000', fg: '#A9B1AC' }
];
const HLD = { y: '#E2B840', g: '#5FAE7F', b: '#5B93DA', r: '#DC6680' };
const rd = $('#reader'), stage = $('#rdStage'), vp = $('#rdViewport'), flow = $('#rdFlow');
const R = { open: false, id: null, book: null, c: null, ci: 0, page: 0, pages: 1, pageW: 1, cols: 1, blocks: [], pos: { c: 0, p: 0, o: 0 }, range: null, ptab: 'toc', lastInput: Date.now(), busy: false, pop: null, popHl: null, sel: null, noteOpen: false, drag: null, dragEnd: 0, wheelLock: 0 };
const isPaged = () => settings().mode !== 'scroll';
const cmpPos = (a, b) => (a.c - b.c) || (a.p - b.p) || ((a.o || 0) - (b.o || 0));
const interact = () => { R.lastInput = Date.now(); };

function applySettings() {
  const s = settings();
  rd.dataset.rtheme = s.theme; rd.dataset.mode = s.mode;
  flow.style.setProperty('--rf', FONTS[s.font] || FONTS.Literata);
  flow.style.setProperty('--rfs', s.size + 'px');
  flow.style.setProperty('--rlh', s.lh);
  flow.style.setProperty('--ralign', s.align);
  flow.classList.toggle('spaced', !s.indent);
  flow.lang = R.c?.lang || R.book?.lang || 'ru';
  rd.style.setProperty('--rib', ribbon());
}
function fontsReady() {
  const s = settings(); const fam = (FONTS[s.font] || FONTS.Literata).split(',')[0];
  if (!document.fonts?.load) return Promise.resolve();
  return Promise.race([Promise.all([document.fonts.load(`${s.size}px ${fam}`), document.fonts.load(`italic ${s.size}px ${fam}`), document.fonts.load('30px "Tenor Sans"')]).catch(() => {}), sleep(1800)]);
}
function showLoading(on, text) {
  const el = $('#rdLoading'); el.hidden = !on;
  if (on) el.innerHTML = `<span class="loading-dots"><i></i><i></i><i></i></span><span>${esc(text || 'Открываю книгу…')}</span>`;
}
function showReaderError(e) {
  const el = $('#rdLoading'); el.hidden = false;
  el.innerHTML = `<div class="rd-err"><h3 style="font-family:var(--f-display);font-weight:400;font-size:24px;margin:0">Книга не открылась</h3><p style="margin:0;color:var(--r-muted)">${esc(errText(e))}</p><button class="btn" id="rdErrBack">Вернуться к полке</button></div>`;
  $('#rdErrBack').onclick = () => closeReader();
}
function playOpening(fromEl, b) {
  const r = fromEl.getBoundingClientRect(); if (!r.width || !r.height) return null;
  const W = Math.round(Math.min(innerWidth * .34, innerHeight * .46, 300)), H = Math.round(W * 1.5);
  const Lx = Math.round(innerWidth / 2), Ty = Math.round(innerHeight / 2 - H / 2);
  const ov = document.createElement('div'); ov.className = 'opening';
  ov.style.cssText = `left:${Lx}px;top:${Ty}px;width:${W}px;height:${H}px;transform-origin:0 0;transform:translate(${r.left - Lx}px,${r.top - Ty}px) scale(${r.width / W},${r.height / H})`;
  ov.innerHTML = `<div class="ob"><div class="ob-end"><div class="ob-tp"><small>${esc(b.author || '')}</small><b>${esc(b.title)}</b><i></i><span>Открываю…</span></div></div><div class="ob-cover"><div class="cq">${coverHTML(b)}</div><div class="ob-back"></div></div></div>`;
  document.body.append(ov);
  void ov.offsetWidth;
  ov.style.transition = 'transform .62s cubic-bezier(.65,0,.35,1)';
  ov.style.transform = 'none';
  const t1 = setTimeout(() => ov.classList.add('open'), 420);
  const t2 = setTimeout(() => ov.classList.add('slow'), 1700);
  return {
    opened: sleep(1250),
    finish() { clearTimeout(t1); clearTimeout(t2); ov.style.transition = 'opacity .45s ease, transform .6s ease'; ov.style.opacity = '0'; ov.style.transform = 'scale(1.08)'; setTimeout(() => ov.remove(), 480); }
  };
}
async function openReader(id, opts = {}) {
  const b = S.books.get(id); if (!b) { toast('Этой книги больше нет на полке'); return; }
  if (R.open) closeReader(true);
  closeSheet(true);
  Object.assign(R, { open: true, id, book: b, c: null, ci: 0, page: 0, pages: 1, pop: null, busy: false });
  $('#rdBook').textContent = b.title; $('#rdChap').textContent = b.author || '';
  $('#rdFolio').textContent = ''; $('#rdLeft').textContent = ''; $('#rdRight').textContent = '';
  flow.replaceChildren();
  applySettings(); closePanel(); closeSet(); hidePop(); hideEnd();
  rd.classList.remove('immersive');
  const op = opts.fromEl && !noMotion() ? playOpening(opts.fromEl, b) : null;
  rd.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  showLoading(true);
  let content;
  try { [content] = await Promise.all([Content.load(b), op ? op.opened : null, fontsReady()]); }
  catch (e) { op?.finish(); if (R.open && R.id === id) showReaderError(e); return; }
  if (!R.open || R.id !== id) { op?.finish(); return; }
  R.c = content; applySettings();
  const st = ensureState(id);
  if (opts.restart) st.finished = false;
  let pos = opts.pos || (opts.restart ? null : st.pos) || { c: 0, p: 0, o: 0 };
  pos = clampPos(pos);
  showLoading(false);
  renderChapter(pos.c); layout(); gotoInChapter(pos);
  R.pos = pos; R.range = computeRange(); commitPos(true); updateChrome();
  if (opts.flash) setTimeout(() => flashAt(pos, opts.flash), 350);
  op?.finish();
  if (!op) { rd.classList.remove('enter'); void rd.offsetWidth; rd.classList.add('enter'); }
  clearInterval(R.tick);
  R.tick = setInterval(() => { if (R.open && document.visibilityState === 'visible' && Date.now() - R.lastInput < 240000) { const s = ensureState(R.id); s.readMs = (s.readMs || 0) + 15000; } }, 15000);
  interact(); wake();
}
async function wake() { try { if (R.open && navigator.wakeLock && document.visibilityState === 'visible') R.wake = await navigator.wakeLock.request('screen'); } catch {} }
function closeReader(quick) {
  if (!R.open) return;
  if (R.c && R.pos) commitPos(true);
  flushAll();
  R.open = false;
  closePanel(); closeSet(); hidePop(); closeNote(); hideEnd();
  clearInterval(R.tick);
  try { R.wake?.release(); } catch {} R.wake = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const done = () => { if (R.open) return; rd.hidden = true; flow.replaceChildren(); document.documentElement.style.overflow = ''; rd.style.opacity = ''; rd.style.transition = ''; };
  if (quick === true || noMotion()) done();
  else { rd.style.transition = 'opacity .3s ease'; rd.style.opacity = '0'; setTimeout(done, 300); }
  R.c = null;
  onData();
}
function clampPos(pos) {
  const c = R.c; const ci = clamp(pos.c | 0, 0, c.chapters.length - 1);
  const p = clamp(pos.p | 0, 0, c.chapters[ci].b.length - 1);
  return { c: ci, p, o: clamp(pos.o | 0, 0, c._lens[ci][p]) };
}
const pctOf = pos => { const c = R.c; if (!c) return 0; const pre = c._pre[pos.c]; return clamp((c._starts[pos.c] + pre[Math.min(pos.p, pre.length - 1)] + (pos.o || 0)) / c._total, 0, 1); };
function posOfPct(v) {
  const c = R.c; const target = clamp(v, 0, 1) * c._total;
  let ci = 0; while (ci + 1 < c.chapters.length && c._starts[ci + 1] <= target) ci++;
  const rem = target - c._starts[ci]; const pre = c._pre[ci];
  let p = 0; while (p + 1 < pre.length - 1 && pre[p + 1] <= rem) p++;
  return clampPos({ c: ci, p, o: Math.floor(rem - pre[p]) });
}
function commitPos(soon) {
  if (!R.c || !R.pos) return;
  const st = ensureState(R.id);
  st.pos = { c: R.pos.c, p: R.pos.p, o: R.pos.o || 0 };
  st.pct = pctOf(R.pos);
  saveState(R.id, soon ? 300 : 2200);
}

/* ---------- rendering ---------- */
function renderChapter(ci) {
  const c = R.c; ci = clamp(ci, 0, c.chapters.length - 1); R.ci = ci;
  const ch = c.chapters[ci];
  const frag = document.createDocumentFragment();
  if (!isPaged() && ci > 0) { const top = document.createElement('div'); top.className = 'ch-end'; top.style.margin = '0 0 2em'; top.innerHTML = `<button class="btn sm ghost" data-prevch>${ic('back')} ${esc(c.chapters[ci - 1].t)}</button>`; frag.append(top); }
  ch.b.forEach((html, i) => {
    const t = document.createElement('template'); t.innerHTML = html; sanitize(t.content);
    let el = t.content.firstElementChild;
    if (!el || t.content.childNodes.length !== 1) { el = document.createElement('div'); el.append(t.content); }
    el.classList.add('blk'); el.dataset.i = i; frag.append(el);
  });
  if (!isPaged()) {
    const nav = document.createElement('div'); nav.className = 'ch-end';
    nav.innerHTML = ci < c.chapters.length - 1 ? `<span>Конец главы</span><button class="btn" data-nextch>Дальше: ${esc(c.chapters[ci + 1].t)} ${ic('chev')}</button>` : `<span>Конец книги</span><button class="btn" data-finish>Закончить чтение</button>`;
    frag.append(nav);
  }
  flow.classList.remove('slide');
  flow.replaceChildren(frag);
  flow.classList.toggle('part', !!ch.part);
  R.blocks = [...flow.children].filter(e => e.classList.contains('blk'));
  paintHighlights();
  $('#rdChap').textContent = ch.t;
}
function layout() {
  const s = settings();
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const fs = s.size;
  const M = Math.round(Math.max(16, Math.min({ s: 20, m: 48, l: 96 }[s.margin] || 48, sw * .08)));
  flow.style.setProperty('--vh', Math.max(120, sh - fs * 4) + 'px');
  if (!isPaged()) {
    R.cols = 1; rd.classList.remove('two');
    vp.style.cssText = ''; flow.style.transform = 'none';
    flow.style.width = Math.min(sw - 2 * M, Math.round(fs * 36)) + 'px';
    flow.style.height = ''; flow.style.columnCount = ''; flow.style.columnGap = '';
    return;
  }
  let cols = s.cols === 'auto' ? ((sw >= 1000 && sw / sh > 1.2) ? 2 : 1) : +s.cols;
  if (sw < 640) cols = 1;
  const gap = cols === 2 ? Math.round(Math.max(64, fs * 3.4)) : Math.round(Math.max(40, M * 2));
  const maxCol = Math.round(fs * (cols === 2 ? 31 : 35));
  const colW = Math.max(120, Math.floor(Math.min((sw - 2 * M - (cols - 1) * gap) / cols, maxCol)));
  const vw = cols * colW + (cols - 1) * gap;
  const padT = Math.round(clamp(sh * .03, 6, 26));
  const vh = Math.max(120, Math.floor(sh - padT * 2));
  vp.style.cssText = `width:${vw}px;height:${vh}px;margin-top:${padT}px`;
  flow.style.width = vw + 'px'; flow.style.height = vh + 'px';
  flow.style.columnCount = cols; flow.style.columnGap = gap + 'px'; flow.style.columnFill = 'auto';
  flow.style.setProperty('--vh', (vh - fs) + 'px');
  R.cols = cols; R.pageW = vw + gap;
  rd.classList.toggle('two', cols === 2);
  const rib = $('#rdRibbon'); const spaceR = sw - (vp.offsetLeft + vw);
  rib.style.left = (spaceR >= 34 ? vp.offsetLeft + vw + Math.min(14, Math.round((spaceR - 22) / 2)) : vp.offsetLeft + vw - 26) + 'px';
  countPages();
}
function countPages() {
  const fr = flow.getBoundingClientRect();
  let right = 0;
  const last = R.blocks[R.blocks.length - 1];
  if (last) { const rs = last.getClientRects(); if (rs.length) right = rs[rs.length - 1].right - fr.left; }
  right = Math.max(right, 1);
  R.pages = Math.max(1, Math.ceil((right + 1) / R.pageW));
  R.page = clamp(R.page, 0, R.pages - 1);
}
function applyPage(animate, dir) {
  const x = -R.page * R.pageW;
  const a = animate && !noMotion() ? settings().anim : 'none';
  clearTimeout(R.fadeT);
  if (a === 'slide') { flow.classList.remove('fading'); flow.classList.add('slide'); flow.style.transform = `translate3d(${x}px,0,0)`; sweep(dir); }
  else if (a === 'fade') { flow.classList.remove('slide'); flow.classList.add('fading'); R.fadeT = setTimeout(() => { flow.style.transform = `translate3d(${x}px,0,0)`; flow.classList.remove('fading'); }, 170); }
  else { flow.classList.remove('slide', 'fading'); flow.style.transform = `translate3d(${x}px,0,0)`; }
}
function sweep(dir) {
  const el = $('#rdSweep'); el.className = 'sweep'; void el.offsetWidth;
  el.className = 'sweep ' + (dir < 0 ? 'go-prev' : 'go-next');
}
function gotoInChapter(pos) {
  if (isPaged()) { R.page = pageOfPos(pos); applyPage(false); }
  else scrollToPos(pos);
}
function relayoutKeep() {
  if (!R.open || !R.c) return;
  const pos = R.pos;
  layout(); gotoInChapter(pos);
  R.range = computeRange(); updateChrome();
}

/* ---------- geometry ---------- */
function textNodes(el) {
  const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, acc = 0;
  while ((n = w.nextNode())) { const l = n.nodeValue.length; if (!l) continue; out.push({ n, s: acc }); acc += l; }
  out.total = acc; return out;
}
function locate(nodes, k) {
  if (!nodes.length) return null;
  let lo = 0, hi = nodes.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].s <= k) lo = mid; else hi = mid - 1; }
  const t = nodes[lo]; return { node: t.n, off: clamp(k - t.s, 0, t.n.nodeValue.length) };
}
const RNG = document.createRange();
function charRect(nodes, k) {
  const a = locate(nodes, k); if (!a) return null;
  const len = a.node.nodeValue.length; const o = Math.min(a.off, len - 1);
  RNG.setStart(a.node, o); RNG.setEnd(a.node, o + 1);
  const rs = RNG.getClientRects(); return rs[0] || null;
}
function pageOfX(x) { return clamp(Math.floor((x + 2) / R.pageW), 0, R.pages - 1); }
function pageOfPos(pos) {
  const el = R.blocks[Math.min(pos.p, R.blocks.length - 1)]; if (!el) return 0;
  const fr = flow.getBoundingClientRect();
  if (pos.o > 0) { const nodes = textNodes(el); if (pos.o < nodes.total) { const r = charRect(nodes, pos.o); if (r) return pageOfX(r.left - fr.left); } }
  const rs = el.getClientRects(); return rs.length ? pageOfX(rs[0].left - fr.left) : 0;
}
function posAtPage(pg) {
  const bl = R.blocks; if (!bl.length) return { c: R.ci, p: 0, o: 0 };
  const fr = flow.getBoundingClientRect(); const x0 = pg * R.pageW;
  const endX = el => { const rs = el.getClientRects(); return rs.length ? rs[rs.length - 1].right - fr.left : -1; };
  let lo = 0, hi = bl.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (endX(bl[mid]) > x0 + 1) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
  if (ans < 0) return { c: R.ci, p: bl.length, o: 0 };
  const el = bl[ans]; const rs = el.getClientRects(); const sx = rs.length ? rs[0].left - fr.left : x0;
  let o = 0;
  if (sx < x0 - 1) {
    const nodes = textNodes(el); let l2 = 0, h2 = nodes.total - 1, a2 = -1;
    while (l2 <= h2) { const mid = (l2 + h2) >> 1; const r = charRect(nodes, mid); if (r && Math.floor((r.left - fr.left + 2) / R.pageW) >= pg) { a2 = mid; h2 = mid - 1; } else l2 = mid + 1; }
    o = a2 < 0 ? 0 : a2;
  }
  return { c: R.ci, p: ans, o };
}
function posAtY(y) {
  const bl = R.blocks; if (!bl.length) return { c: R.ci, p: 0, o: 0 };
  let lo = 0, hi = bl.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; const r = bl[mid].getBoundingClientRect(); if (r.bottom > y + 1) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
  if (ans < 0) return { c: R.ci, p: bl.length, o: 0 };
  const el = bl[ans]; let o = 0;
  if (el.getBoundingClientRect().top < y - 2) {
    const nodes = textNodes(el); let l2 = 0, h2 = nodes.total - 1, a2 = -1;
    while (l2 <= h2) { const mid = (l2 + h2) >> 1; const r = charRect(nodes, mid); if (r && r.top >= y - 2) { a2 = mid; h2 = mid - 1; } else l2 = mid + 1; }
    o = a2 < 0 ? 0 : a2;
  }
  return { c: R.ci, p: ans, o };
}
function computePos() {
  let p = isPaged() ? posAtPage(R.page) : posAtY(vp.getBoundingClientRect().top + 8);
  if (p.p >= R.blocks.length) p = { c: R.ci, p: Math.max(0, R.blocks.length - 1), o: 0 };
  return p;
}
function computeRange() {
  const start = R.pos;
  let end;
  if (isPaged()) end = R.page + 1 < R.pages ? posAtPage(R.page + 1) : { c: R.ci, p: Infinity, o: 0 };
  else end = posAtY(vp.getBoundingClientRect().bottom - 4);
  return { start, end };
}
function scrollToPos(pos, smooth) {
  const el = R.blocks[Math.min(pos.p, R.blocks.length - 1)]; if (!el) return;
  let top = el.getBoundingClientRect().top;
  if (pos.o > 0) { const nodes = textNodes(el); const r = pos.o < nodes.total ? charRect(nodes, pos.o) : null; if (r) top = r.top; }
  const y = vp.scrollTop + top - vp.getBoundingClientRect().top - 8;
  vp.scrollTo({ top: Math.max(0, y), behavior: smooth && !noMotion() ? 'smooth' : 'auto' });
}

/* ---------- movement ---------- */
function afterMove() {
  R.pos = computePos(); R.range = computeRange();
  commitPos(); updateChrome();
}
function next() {
  if (!R.c || R.busy) return; interact(); hidePop();
  if (!isPaged()) { vp.scrollBy({ top: vp.clientHeight * .88, behavior: noMotion() ? 'auto' : 'smooth' }); return; }
  rd.classList.add('immersive');
  if (R.page < R.pages - 1) { R.page++; applyPage(true, 1); afterMove(); }
  else if (R.ci < R.c.chapters.length - 1) switchChapter(R.ci + 1, 'start', 1);
  else showEnd();
}
function prev() {
  if (!R.c || R.busy) return; interact(); hidePop();
  if (!isPaged()) { vp.scrollBy({ top: -vp.clientHeight * .88, behavior: noMotion() ? 'auto' : 'smooth' }); return; }
  rd.classList.add('immersive');
  if (R.page > 0) { R.page--; applyPage(true, -1); afterMove(); }
  else if (R.ci > 0) switchChapter(R.ci - 1, 'end', -1);
  else { applyPage(false); if (!noMotion()) flow.animate([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(18px,0,0)' }, { transform: 'translate3d(0,0,0)' }], { duration: 320, easing: 'ease-out' }); }
}
async function switchChapter(ci, where, dir) {
  R.busy = true;
  const anim = !!dir && !noMotion() && settings().anim !== 'none';
  try {
    if (anim) { flow.classList.remove('slide'); flow.classList.add('fading'); await sleep(170); }
    if (!R.open || !R.c) return;
    renderChapter(ci);
    if (!isPaged()) {
      layout();
      if (where === 'end') vp.scrollTop = vp.scrollHeight; else if (where === 'start') vp.scrollTop = 0; else scrollToPos(where);
      flow.classList.remove('fading');
    } else {
      countPages();
      R.page = where === 'end' ? R.pages - 1 : where === 'start' ? 0 : pageOfPos(where);
      const x = -R.page * R.pageW;
      if (anim) { flow.style.transform = `translate3d(${x + dir * 60}px,0,0)`; void flow.offsetWidth; flow.classList.add('slide'); flow.classList.remove('fading'); flow.style.transform = `translate3d(${x}px,0,0)`; }
      else { flow.style.transform = `translate3d(${x}px,0,0)`; flow.classList.remove('fading'); }
    }
  } finally { R.busy = false; }
  if (typeof where === 'object') { R.pos = clampPos(where); R.range = computeRange(); commitPos(); updateChrome(); }
  else afterMove();
}
function gotoPos(pos, flashLen) {
  if (!R.c) return;
  pos = clampPos(pos); interact();
  const dir = cmpPos(pos, R.pos || pos) >= 0 ? 1 : -1;
  hideEnd();
  if (pos.c !== R.ci) { switchChapter(pos.c, pos, dir).then(() => { if (flashLen) setTimeout(() => flashAt(pos, flashLen), 250); }); return; }
  if (isPaged()) { R.page = pageOfPos(pos); applyPage(true, dir); } else scrollToPos(pos, true);
  R.pos = pos; R.range = computeRange(); commitPos(); updateChrome();
  if (flashLen) setTimeout(() => flashAt(pos, flashLen), 200);
}
function flashAt(pos, len) {
  if (!R.open || pos.c !== R.ci) return;
  const el = R.blocks[pos.p]; if (!el) return;
  wrapChars(textNodes(el), pos.o, pos.o + Math.max(1, len), m => { m.className = 'find'; });
  setTimeout(() => unwrap('mark.find'), 2800);
}

/* ---------- chrome ---------- */
function updateChrome() {
  const c = R.c; if (!c || !R.pos) return;
  const pct = pctOf(R.pos);
  const sc = $('#rdScrub'); sc.value = Math.round(pct * 1000); sc.style.setProperty('--p', (pct * 100).toFixed(2) + '%');
  const pre = c._pre[R.ci];
  const leftCh = (pre[pre.length - 1] - pre[Math.min(R.pos.p, pre.length - 1)] - (R.pos.o || 0)) / CPM;
  $('#rdLeft').textContent = `Глава ${R.ci + 1} из ${c.chapters.length} · ${leftCh < 1 ? 'до конца главы меньше минуты' : `до конца главы ≈ ${fmtDur(leftCh)}`}`;
  $('#rdFolio').textContent = isPaged() ? `${R.page + 1} / ${R.pages}` : `§ ${R.ci + 1}`;
  $('#rdRight').textContent = `${Math.round(pct * 100)}%`;
  $('#rdChap').textContent = c.chapters[R.ci].t;
  updateRibbon();
  if ($('#rdPanel').classList.contains('on') && R.ptab === 'toc') renderPanel(true);
}
function marksOnPage() {
  const st = S.states.get(R.id); if (!st?.marks || !R.range) return [];
  return st.marks.filter(m => m.c === R.ci && cmpPos(m, R.range.start) >= 0 && cmpPos(m, R.range.end) < 0);
}
function updateRibbon() {
  const on = marksOnPage().length > 0;
  $('#rdRibbon').classList.toggle('on', on && isPaged());
  const b = $('#rdMarkBtn'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Снять закладку' : 'Заложить страницу');
}
function excerpt(pos, n = 180) {
  const ch = R.c.chapters[pos.c]; let out = ''; let p = pos.p, o = pos.o || 0;
  while (p < ch.b.length && out.length < n) { const t = plainOf(ch.b[p]).slice(o).replace(/\s+/g, ' ').trim(); if (t) out += (out ? ' ' : '') + t; p++; o = 0; }
  if (out.length > n) out = out.slice(0, n).replace(/\s+\S*$/, '') + '…';
  return out || ch.t;
}
function toggleMark() {
  if (!R.c) return; interact();
  const st = ensureState(R.id); const on = marksOnPage();
  if (on.length) { st.marks = st.marks.filter(m => !on.includes(m)); toast('Закладка снята', 1800); }
  else {
    const pos = R.pos;
    st.marks.push({ id: rid(), c: pos.c, p: pos.p, o: pos.o || 0, pct: pctOf(pos), text: excerpt(pos), note: '', at: Date.now() });
    st.marks.sort(cmpPos);
    toast(isPaged() ? 'Страница заложена' : 'Место заложено', 1800);
  }
  saveState(R.id, 400); updateRibbon(); refreshPanel();
}
function toggleFull() {
  const p = document.fullscreenElement ? document.exitFullscreen() : rd.requestFullscreen?.();
  Promise.resolve(p).catch(() => toast('Полноэкранный режим здесь недоступен'));
}

/* ---------- highlights ---------- */
function wrapChars(nodes, a, b, deco) {
  for (const t of nodes) {
    const len = t.n.nodeValue.length, ns = t.s, ne = ns + len;
    if (ne <= a || ns >= b) continue;
    let node = t.n; const s0 = Math.max(a, ns) - ns, e0 = Math.min(b, ne) - ns;
    if (e0 < len) node.splitText(e0);
    if (s0 > 0) node = node.splitText(s0);
    const m = document.createElement('mark'); deco(m);
    node.parentNode.insertBefore(m, node); m.appendChild(node);
  }
}
function unwrap(sel) { for (const m of flow.querySelectorAll(sel)) { const p = m.parentNode; m.replaceWith(...m.childNodes); p?.normalize(); } }
function decoHl(h) { return m => { m.className = 'hl' + (h.note ? ' note' : ''); m.dataset.h = h.id; m.style.setProperty('--hlc', HLC[h.color] || HLC.y); }; }
function wrapHl(h) {
  for (let p = h.p1; p <= h.p2; p++) {
    const el = R.blocks[p]; if (!el) continue;
    const nodes = textNodes(el); const a = p === h.p1 ? h.o1 : 0, b = p === h.p2 ? h.o2 : nodes.total;
    if (b > a) wrapChars(nodes, a, b, decoHl(h));
  }
}
function paintHighlights() { const st = S.states.get(R.id); for (const h of st?.hls || []) if (h.c === R.ci) wrapHl(h); }
function blockOf(n) { while (n && n !== flow) { if (n.parentNode === flow) return n.classList?.contains('blk') ? n : null; n = n.parentNode; } return null; }
function edgeOf(node, off, isStart) {
  if (node === flow) { const el = isStart ? flow.childNodes[off] : flow.childNodes[off - 1]; if (!el?.classList?.contains('blk')) return null; return { el, o: isStart ? 0 : el.textContent.length }; }
  const el = blockOf(node); if (!el) return null;
  const rr = document.createRange(); rr.setStart(el, 0);
  try { rr.setEnd(node, off); } catch { return null; }
  return { el, o: rr.toString().length };
}
function selRange() {
  const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0); if (!flow.contains(r.commonAncestorContainer)) return null;
  const s = edgeOf(r.startContainer, r.startOffset, true), e = edgeOf(r.endContainer, r.endOffset, false);
  if (!s || !e) return null;
  let p1 = +s.el.dataset.i, o1 = s.o, p2 = +e.el.dataset.i, o2 = e.o;
  if (p2 > p1 && o2 === 0) { p2--; o2 = R.c._lens[R.ci][p2]; }
  if (p1 > p2 || (p1 === p2 && o2 <= o1)) return null;
  const text = r.toString().replace(/\s+/g, ' ').trim(); if (!text) return null;
  const rects = r.getClientRects();
  return { c: R.ci, p1, o1, p2, o2, text: text.slice(0, 800), rect: rects[0] || r.getBoundingClientRect() };
}
function showPop(kind, rect, hl) {
  const pop = $('#rdPop'); R.pop = kind; R.popHl = hl || null;
  const cur = hl?.color;
  pop.innerHTML = Object.keys(HLD).map(k => `<button class="dot" data-hlc="${k}" aria-label="${HLN[k]} маркер" aria-pressed="${cur === k}" style="--hlc:${HLD[k]}"><i></i></button>`).join('') + '<span class="sep"></span>' +
    (kind === 'sel'
      ? `<button class="pb" data-pa="note">${ic('note')}Заметка</button><button class="pb" data-pa="copy">${ic('copy')}Копировать</button>`
      : `<button class="pb" data-pa="note">${ic('note')}${hl.note ? 'Заметка' : 'Добавить заметку'}</button><button class="pb" data-pa="del" aria-label="Убрать выделение">${ic('trash')}</button>`);
  const rr = rd.getBoundingClientRect();
  let x = rect.left + rect.width / 2 - rr.left, y = rect.top - rr.top - 10, below = false;
  if (y < 76) { y = rect.bottom - rr.top + 10; below = true; }
  x = clamp(x, 160, Math.max(160, rr.width - 160));
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  pop.classList.toggle('below', below);
  requestAnimationFrame(() => pop.classList.add('on'));
}
function hidePop() { R.pop = null; R.popHl = null; $('#rdPop').classList.remove('on'); }
function addHl(sel, color) {
  const st = ensureState(R.id);
  const h = { id: rid(), c: sel.c, p1: sel.p1, o1: sel.o1, p2: sel.p2, o2: sel.o2, text: sel.text, color, note: '', at: Date.now(), pct: pctOf({ c: sel.c, p: sel.p1, o: sel.o1 }) };
  st.hls.push(h); st.hls.sort((a, b) => a.c - b.c || a.p1 - b.p1 || a.o1 - b.o1);
  getSelection()?.removeAllRanges();
  wrapHl(h); saveState(R.id, 500); refreshPanel();
  return h;
}
function setHlColor(h, color) { h.color = color; for (const m of flow.querySelectorAll(`mark.hl[data-h="${h.id}"]`)) m.style.setProperty('--hlc', HLC[color]); saveState(R.id, 500); refreshPanel(); }
function delHl(id) { const st = ensureState(R.id); st.hls = st.hls.filter(h => h.id !== id); unwrap(`mark.hl[data-h="${id}"]`); saveState(R.id, 500); refreshPanel(); }
function openNote(item, rect, kind) {
  closeNote(); R.noteOpen = true;
  const el = document.createElement('div'); el.className = 'rd-note'; el.id = 'rdNote';
  el.style.setProperty('--hlc', kind === 'mark' ? ribbon() : (HLD[item.color] || HLD.y));
  el.innerHTML = `<blockquote>${esc(item.text)}</blockquote><label class="sr" for="rdNoteTa">Заметка</label><textarea class="input" id="rdNoteTa" rows="4" maxlength="2000" placeholder="Ваша мысль об этом месте">${esc(item.note || '')}</textarea><div><button class="btn sm" data-n="cancel">Отмена</button><button class="btn sm primary" data-n="save">Сохранить</button></div>`;
  rd.append(el);
  const rr = rd.getBoundingClientRect(); const w = el.offsetWidth, h = el.offsetHeight;
  let x = (rect ? rect.left + rect.width / 2 - rr.left : rr.width / 2) - w / 2, y = rect ? rect.bottom - rr.top + 12 : rr.height / 2 - h / 2;
  if (y + h > rr.height - 12) y = Math.max(12, (rect ? rect.top - rr.top - h - 12 : 12));
  el.style.left = clamp(x, 12, rr.width - w - 12) + 'px'; el.style.top = clamp(y, 12, rr.height - h - 12) + 'px';
  const ta = $('#rdNoteTa'); setTimeout(() => ta.focus(), 30);
  el.onclick = e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    if (b.dataset.n === 'save') {
      item.note = ta.value.trim().slice(0, 2000);
      if (kind === 'hl') for (const m of flow.querySelectorAll(`mark.hl[data-h="${item.id}"]`)) m.classList.toggle('note', !!item.note);
      saveState(R.id, 400); refreshPanel(); toast(item.note ? 'Заметка сохранена' : 'Заметка удалена', 1800);
    }
    closeNote();
  };
  ta.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) el.querySelector('[data-n="save"]').click(); };
}
function closeNote() { R.noteOpen = false; $('#rdNote')?.remove(); }
$('#rdPop').addEventListener('click', e => {
  const d = e.target.closest('[data-hlc]'), a = e.target.closest('[data-pa]');
  if (!d && !a) return;
  const kind = R.pop, hl = R.popHl;
  if (d) {
    if (kind === 'sel' && R.sel) addHl(R.sel, d.dataset.hlc);
    else if (hl) setHlColor(hl, d.dataset.hlc);
    hidePop(); return;
  }
  const act = a.dataset.pa;
  if (act === 'copy' && R.sel) {
    const t = `«${R.sel.text}»\n— ${R.book.author ? R.book.author + ', ' : ''}${R.book.title}`;
    const p = navigator.clipboard?.writeText(t);
    Promise.resolve(p).then(() => toast('Цитата скопирована', 1800), () => toast('Браузер не дал скопировать. Нажмите Ctrl+C или ⌘C'));
    hidePop(); return;
  }
  if (act === 'note') {
    const rect = kind === 'sel' ? R.sel?.rect : flow.querySelector(`mark.hl[data-h="${hl?.id}"]`)?.getBoundingClientRect();
    const target = kind === 'sel' && R.sel ? addHl(R.sel, 'y') : hl;
    hidePop(); if (target) openNote(target, rect, 'hl'); return;
  }
  if (act === 'del' && hl) { delHl(hl.id); hidePop(); }
});
document.addEventListener('selectionchange', () => {
  if (!R.open || R.noteOpen) return;
  clearTimeout(R.selT);
  R.selT = setTimeout(() => {
    const s = selRange();
    if (s) { R.sel = s; showPop('sel', s.rect); }
    else if (R.pop === 'sel') hidePop();
  }, 240);
});

/* ---------- panel ---------- */
function openPanel(tab) {
  R.ptab = tab || R.ptab; closeSet(); hidePop();
  $('#rdPanel').classList.add('on'); renderPanel();
  if (R.ptab === 'search') setTimeout(() => $('#psQ')?.focus(), 360);
}
function closePanel() { $('#rdPanel').classList.remove('on'); }
function togglePanel(tab) { const on = $('#rdPanel').classList.contains('on'); if (on && R.ptab === tab) closePanel(); else openPanel(tab); }
function refreshPanel() { if ($('#rdPanel').classList.contains('on') && R.ptab !== 'search') renderPanel(); onData(); }
function renderPanel(soft) {
  const body = $('#rdPanelBody'); const c = R.c; if (!c) return;
  $$('#rdPanel [data-ptab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ptab === R.ptab)));
  $('#rdPanelTitle').textContent = R.book?.title || 'Книга';
  const st = S.states.get(R.id) || { marks: [], hls: [] };
  const where = m => `${esc(c.chapters[m.c]?.t || '').slice(0, 48)} · ${Math.round(pctOf({ c: m.c, p: m.p ?? m.p1, o: m.o ?? m.o1 }) * 100)}%`;
  if (R.ptab === 'toc') {
    body.innerHTML = `<div class="ptoc">${c.chapters.map((ch, i) => `<button data-goch="${i}" class="lv${ch.l || 1}${i === R.ci ? ' cur' : ''}${i < R.ci ? ' done' : ''}"><span>${esc(ch.t)}</span><small class="num">${Math.round(c._starts[i] / c._total * 100)}%</small></button>`).join('')}</div>`;
    if (!soft) setTimeout(() => body.querySelector('.cur')?.scrollIntoView({ block: 'center' }), 30);
  } else if (R.ptab === 'marks') {
    body.innerHTML = st.marks?.length ? st.marks.map(m => `<div class="pitem" role="button" tabindex="0" data-gopos="${m.c},${m.p},${m.o || 0}"><div class="q">${esc(m.text)}</div>${m.note ? `<div class="nt">${esc(m.note)}</div>` : ''}<div class="m"><span>${where(m)}</span><span>${fmtShort(m.at)}</span></div><div class="x"><button class="icon-btn" data-notemark="${m.id}" aria-label="Заметка к закладке">${ic('note')}</button><button class="icon-btn" data-delmark="${m.id}" aria-label="Удалить закладку">${ic('trash')}</button></div></div>`).join('')
      : `<div class="pempty">Закладок пока нет.<br>Нажмите на ленточку в правом верхнем углу или клавишу B, чтобы заложить страницу.</div>`;
  } else if (R.ptab === 'notes') {
    body.innerHTML = st.hls?.length ? st.hls.map(h => `<div class="pitem" role="button" tabindex="0" data-gopos="${h.c},${h.p1},${h.o1}" data-len="${h.p1 === h.p2 ? h.o2 - h.o1 : 0}"><div class="q hlq" style="--hlc:${HLD[h.color] || HLD.y}">${esc(h.text)}</div>${h.note ? `<div class="nt">${esc(h.note)}</div>` : ''}<div class="m"><span>${where(h)}</span><span>${fmtShort(h.at)}</span></div><div class="x"><button class="icon-btn" data-notehl="${h.id}" aria-label="Заметка">${ic('note')}</button><button class="icon-btn" data-delhl="${h.id}" aria-label="Удалить выделение">${ic('trash')}</button></div></div>`).join('')
      : `<div class="pempty">Выделений пока нет.<br>Выделите фрагмент текста мышью или пальцем, выберите цвет маркера и при желании добавьте заметку.</div>`;
  } else {
    body.innerHTML = `<div class="psearch"><label class="sr" for="psQ">Искать в книге</label><input class="input" id="psQ" type="search" placeholder="Слово или фраза" value="${esc(R.searchQ || '')}"><small id="psInfo"></small></div><div id="psRes"></div>`;
    $('#psQ').oninput = e => { R.searchQ = e.target.value; clearTimeout(R.sT); R.sT = setTimeout(runSearch, 280); };
    runSearch();
  }
}
function runSearch() {
  const q = (R.searchQ || '').trim(); const out = $('#psRes'), info = $('#psInfo'); if (!out) return;
  if (q.length < 2) { out.innerHTML = ''; info.textContent = 'Введите хотя бы две буквы'; return; }
  const norm = s => s.toLowerCase().replace(/ё/g, 'е');
  const nq = norm(q); const c = R.c; const res = [];
  outer: for (let ci = 0; ci < c.chapters.length; ci++) {
    const pl = c._plain[ci] ||= c.chapters[ci].b.map(plainOf);
    for (let p = 0; p < pl.length; p++) {
      const t = pl[p]; const nt = norm(t); let i = nt.indexOf(nq);
      while (i >= 0) { res.push({ c: ci, p, o: i, t }); if (res.length >= 300) break outer; i = nt.indexOf(nq, i + nq.length); }
    }
  }
  info.textContent = res.length ? `${res.length >= 300 ? 'Больше 300' : res.length} ${plural(res.length, 'совпадение', 'совпадения', 'совпадений')}` : 'Ничего не найдено';
  out.innerHTML = res.map(r => { const a = Math.max(0, r.o - 60), b = Math.min(r.t.length, r.o + q.length + 90); return `<div class="pitem pres" role="button" tabindex="0" data-gopos="${r.c},${r.p},${r.o}" data-len="${q.length}"><div class="q">${a > 0 ? '…' : ''}${esc(r.t.slice(a, r.o))}<mark>${esc(r.t.slice(r.o, r.o + q.length))}</mark>${esc(r.t.slice(r.o + q.length, b))}${b < r.t.length ? '…' : ''}</div><div class="m"><span>${esc(c.chapters[r.c].t).slice(0, 60)}</span></div></div>`; }).join('');
}
$('#rdPanel').addEventListener('click', e => {
  const tab = e.target.closest('[data-ptab]'); if (tab) { R.ptab = tab.dataset.ptab; renderPanel(); if (R.ptab === 'search') setTimeout(() => $('#psQ')?.focus(), 30); return; }
  if (e.target.closest('#rdPanelClose')) { closePanel(); return; }
  const st = ensureState(R.id);
  const dm = e.target.closest('[data-delmark]'); if (dm) { st.marks = st.marks.filter(m => m.id !== dm.dataset.delmark); saveState(R.id, 400); updateRibbon(); refreshPanel(); return; }
  const dh = e.target.closest('[data-delhl]'); if (dh) { delHl(dh.dataset.delhl); return; }
  const nm = e.target.closest('[data-notemark]'); if (nm) { const m = st.marks.find(x => x.id === nm.dataset.notemark); if (m) openNote(m, nm.getBoundingClientRect(), 'mark'); return; }
  const nh = e.target.closest('[data-notehl]'); if (nh) { const h = st.hls.find(x => x.id === nh.dataset.notehl); if (h) openNote(h, nh.getBoundingClientRect(), 'hl'); return; }
  const g = e.target.closest('[data-goch]'); if (g) { gotoPos({ c: +g.dataset.goch, p: 0, o: 0 }); if (innerWidth < 760) closePanel(); return; }
  const gp = e.target.closest('[data-gopos]'); if (gp) { const [c, p, o] = gp.dataset.gopos.split(',').map(Number); gotoPos({ c, p, o }, +gp.dataset.len || 0); if (innerWidth < 760) closePanel(); }
});
$('#rdPanel').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.pitem')) { e.preventDefault(); e.target.click(); } });

/* ---------- settings ---------- */
function renderSet() {
  const s = settings();
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button data-set="${key}" data-v="${v}" aria-pressed="${String(s[key]) === String(v)}">${t}</button>`).join('')}</div>`;
  $('#rdSet').innerHTML = `
    <div class="sg"><span>Тема страницы</span><div class="themes">${THEMES.map(t => `<button data-set="theme" data-v="${t.id}" style="--tb:${t.bg};--tf:${t.fg}" aria-pressed="${s.theme === t.id}" aria-label="${t.n}" title="${t.n}">Аа</button>`).join('')}</div></div>
    <div class="sg"><span>Шрифт</span><div class="fonts">${Object.keys(FONTS).map(f => `<button data-set="font" data-v="${f}" style="font-family:${FONTS[f].replace(/"/g, '&quot;')}" aria-pressed="${s.font === f}">${f}</button>`).join('')}</div></div>
    <div class="sg"><span>Кегль</span><div class="stepper"><button class="icon-btn" data-step="size" data-d="-1" aria-label="Мельче">A</button><input type="range" id="setSize" min="14" max="30" step="1" value="${s.size}" aria-label="Размер шрифта"><button class="icon-btn" data-step="size" data-d="1" aria-label="Крупнее" style="font-size:20px">A</button><output class="num">${s.size}</output></div></div>
    <div class="sg"><span>Интерлиньяж</span><div class="stepper"><input type="range" id="setLh" min="1.3" max="2.1" step="0.05" value="${s.lh}" aria-label="Межстрочный интервал"><output class="num">${Number(s.lh).toFixed(2).replace('.', ',')}</output></div></div>
    <div class="sg"><span>Поля</span>${seg('margin', [['s', 'Узкие'], ['m', 'Средние'], ['l', 'Широкие']])}</div>
    <div class="sg"><span>Выключка и абзацы</span>${seg('align', [['justify', 'По ширине'], ['left', 'По левому краю']])}${seg('indent', [['true', 'Красная строка'], ['false', 'Отбивка']])}</div>
    <div class="sg"><span>Режим чтения</span>${seg('mode', [['paged', 'Страницы'], ['scroll', 'Лента']])}</div>
    ${isPaged() ? `<div class="sg"><span>Разворот</span>${seg('cols', [['auto', 'Авто'], ['1', 'Одна полоса'], ['2', 'Две']])}</div>
    <div class="sg"><span>Перелистывание</span>${seg('anim', [['slide', 'Сдвиг'], ['fade', 'Плавно'], ['none', 'Сразу']])}</div>` : ''}`;
}
function openSet() { closePanel(); hidePop(); renderSet(); $('#rdSet').classList.add('on'); }
function closeSet() { $('#rdSet').classList.remove('on'); }
function setOpt(key, val) {
  if (!S.profile) return;
  if (key === 'indent') val = val === true || val === 'true';
  if (key === 'size') val = clamp(+val, 14, 30);
  if (key === 'lh') val = clamp(+val, 1.3, 2.1);
  const before = settings();
  if (before[key] === val) return;
  S.profile.settings = { ...before, [key]: val };
  saveProfile(1500); applySettings();
  const pos = R.pos;
  if (key === 'mode') { renderChapter(R.ci); layout(); gotoInChapter(pos); R.range = computeRange(); updateChrome(); renderSet(); return; }
  if (key === 'theme' || key === 'anim') { renderSet(); return; }
  clearTimeout(R.lyT);
  R.lyT = setTimeout(async () => { if (key === 'font') await fontsReady(); relayoutKeep(); }, key === 'size' || key === 'lh' ? 90 : 0);
  if (key !== 'size' && key !== 'lh') renderSet();
}
$('#rdSet').addEventListener('click', e => {
  const b = e.target.closest('[data-set]'); if (b) { setOpt(b.dataset.set, b.dataset.v); return; }
  const st = e.target.closest('[data-step]'); if (st) { const v = settings().size + (+st.dataset.d); setOpt('size', v); const r = $('#setSize'); if (r) { r.value = clamp(v, 14, 30); r.nextElementSibling.nextElementSibling.textContent = clamp(v, 14, 30); } }
});
$('#rdSet').addEventListener('input', e => {
  if (e.target.id === 'setSize') { setOpt('size', e.target.value); e.target.parentElement.querySelector('output').textContent = e.target.value; }
  if (e.target.id === 'setLh') { setOpt('lh', e.target.value); e.target.parentElement.querySelector('output').textContent = Number(e.target.value).toFixed(2).replace('.', ','); }
});

/* ---------- end of book ---------- */
function showEnd() {
  const st = ensureState(R.id);
  if (!st.finished) { st.finished = true; st.finishedAt = new Date().toISOString(); st.pct = 1; saveState(R.id, 300); }
  hideEnd();
  const mins = (st.readMs || 0) / 60000;
  const el = document.createElement('div'); el.className = 'rd-end';
  el.innerHTML = `<div class="rd-end-card"><div class="fin">Конец</div><h3>${esc(R.book.title)}</h3>${R.book.author ? `<p>${esc(R.book.author)}</p>` : ''}
    <p class="num">${mins >= 1 ? `За чтением ${fmtDur(mins)} · ` : ''}${st.marks.length} ${plural(st.marks.length, 'закладка', 'закладки', 'закладок')} · ${st.hls.length} ${plural(st.hls.length, 'выделение', 'выделения', 'выделений')}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px"><button class="btn" data-endstay>Остаться на странице</button><button class="btn primary" data-endclose>Вернуться к полке</button></div></div>`;
  stage.append(el);
  el.querySelector('[data-endclose]').onclick = () => closeReader();
  el.querySelector('[data-endstay]').onclick = hideEnd;
  setTimeout(() => el.querySelector('[data-endclose]')?.focus(), 100);
}
function hideEnd() { $$('.rd-end').forEach(e => e.remove()); }

/* ---------- input ---------- */
$('#rdBack').onclick = () => closeReader();
$('#rdTocBtn').onclick = () => togglePanel('toc');
$('#rdSearchBtn').onclick = () => togglePanel('search');
$('#rdSetBtn').onclick = () => $('#rdSet').classList.contains('on') ? closeSet() : openSet();
$('#rdFullBtn').onclick = toggleFull;
$('#rdMarkBtn').onclick = toggleMark;
$('#rdRibbon').onclick = e => { e.stopPropagation(); toggleMark(); };
$$('.rd-top, .rd-bottom').forEach(el => el.addEventListener('click', e => { if (rd.classList.contains('immersive') && !e.target.closest('input')) rd.classList.remove('immersive'); }));
stage.addEventListener('click', e => {
  if (Date.now() - R.dragEnd < 350) return;
  if (e.target.closest('.rd-end, .rd-note, .rd-loading')) return;
  const nx = e.target.closest('[data-nextch]'); if (nx) { switchChapter(R.ci + 1, 'start', 1); return; }
  const pv = e.target.closest('[data-prevch]'); if (pv) { switchChapter(R.ci - 1, 'end', -1); return; }
  if (e.target.closest('[data-finish]')) { showEnd(); return; }
  if (e.target.closest('button, a, input')) return;
  if ($('#rdSet').classList.contains('on')) { closeSet(); return; }
  if ($('#rdPanel').classList.contains('on')) { closePanel(); return; }
  if (R.noteOpen) { closeNote(); return; }
  const sel = getSelection(); if (sel && !sel.isCollapsed && flow.contains(sel.anchorNode)) return;
  const m = e.target.closest('mark.hl');
  if (m) { const h = ensureState(R.id).hls.find(x => x.id === m.dataset.h); if (h) { showPop('hl', m.getBoundingClientRect(), h); return; } }
  if (R.pop) { hidePop(); return; }
  if (!isPaged()) { rd.classList.toggle('immersive'); return; }
  const r = stage.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width;
  if (x < .28) prev(); else if (x > .72) next(); else rd.classList.toggle('immersive');
});
stage.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !isPaged() || R.busy || !R.c) return;
  R.drag = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, id: e.pointerId };
});
stage.addEventListener('pointermove', e => {
  const d = R.drag; if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  if (!d.moved) {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) { d.moved = true; flow.classList.remove('slide', 'fading'); hidePop(); }
    else { if (Math.abs(dy) > 14) R.drag = null; return; }
  }
  const edge = (dx > 0 && R.page === 0) || (dx < 0 && R.page === R.pages - 1);
  flow.style.transform = `translate3d(${-R.page * R.pageW + (edge ? dx * .35 : dx)}px,0,0)`;
});
const endDrag = e => {
  const d = R.drag; R.drag = null; if (!d || !d.moved) return;
  R.dragEnd = Date.now();
  const dx = e.clientX - d.x, v = Math.abs(dx) / Math.max(1, Date.now() - d.t);
  if (e.type !== 'pointercancel' && (Math.abs(dx) > 60 || v > .45)) { dx < 0 ? next() : prev(); }
  else { flow.classList.add('slide'); flow.style.transform = `translate3d(${-R.page * R.pageW}px,0,0)`; }
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('wheel', e => {
  if (!R.c || !isPaged() || e.ctrlKey) return;
  if (e.target.closest('.rd-panel, .rd-set')) return;
  e.preventDefault();
  const now = Date.now(); if (now < R.wheelLock) return;
  const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (Math.abs(d) < 6) return;
  R.wheelLock = now + 450; d > 0 ? next() : prev();
}, { passive: false });
vp.addEventListener('scroll', () => {
  if (!R.c || isPaged()) return;
  clearTimeout(R.scT);
  R.scT = setTimeout(() => { interact(); afterMove(); }, 160);
}, { passive: true });
rd.addEventListener('mousemove', e => {
  if (!rd.classList.contains('immersive')) return;
  const r = rd.getBoundingClientRect();
  if (e.clientY - r.top < 64 || r.bottom - e.clientY < 64) rd.classList.remove('immersive');
});
const scrub = $('#rdScrub'), tip = $('#rdTip');
scrub.addEventListener('input', () => {
  if (!R.c) return;
  const v = scrub.value / 1000; scrub.style.setProperty('--p', v * 100 + '%');
  const pos = posOfPct(v);
  tip.textContent = `${R.c.chapters[pos.c].t} · ${Math.round(v * 100)}%`;
  const w = scrub.getBoundingClientRect().width;
  tip.style.left = clamp(v * w, 70, Math.max(70, w - 70)) + 'px';
  tip.classList.add('on');
});
scrub.addEventListener('change', () => { tip.classList.remove('on'); if (R.c) gotoPos(posOfPct(scrub.value / 1000)); });
scrub.addEventListener('blur', () => tip.classList.remove('on'));
document.addEventListener('keydown', e => {
  if (!R.open) { if (e.key === 'Escape' && S.sheet) closeSheet(); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (R.noteOpen) closeNote();
    else if (R.pop) { hidePop(); getSelection()?.removeAllRanges(); }
    else if ($('#rdSet').classList.contains('on')) closeSet();
    else if ($('#rdPanel').classList.contains('on')) closePanel();
    else if ($('.rd-end')) hideEnd();
    else closeReader();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !R.c) return;
  const paged = isPaged();
  switch (e.code) {
    case 'ArrowRight': case 'PageDown': next(); break;
    case 'ArrowLeft': case 'PageUp': prev(); break;
    case 'Space': e.shiftKey ? prev() : next(); break;
    case 'ArrowDown': if (paged) next(); else vp.scrollBy({ top: 80 }); break;
    case 'ArrowUp': if (paged) prev(); else vp.scrollBy({ top: -80 }); break;
    case 'Home': gotoPos({ c: R.ci, p: 0, o: 0 }); break;
    case 'End': gotoPos({ c: R.ci, p: R.blocks.length - 1, o: 0 }); break;
    case 'KeyB': toggleMark(); break;
    case 'KeyT': togglePanel('toc'); break;
    case 'KeyF': toggleFull(); break;
    case 'Slash': openPanel('search'); break;
    default: return;
  }
  e.preventDefault();
});
new ResizeObserver(() => { if (R.open && R.c) { clearTimeout(R.rzT); R.rzT = setTimeout(relayoutKeep, 140); } }).observe(stage);
document.fonts?.addEventListener?.('loadingdone', () => { if (R.open && R.c) { clearTimeout(R.rzT); R.rzT = setTimeout(relayoutKeep, 60); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (R.open && R.c) commitPos(true); flushAll(); } else if (R.open) wake(); });
addEventListener('pagehide', () => { if (R.open && R.c) commitPos(true); flushAll(); });
