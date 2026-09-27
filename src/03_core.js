<script>
(() => {
'use strict';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escT = s => String(s).replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
const escA = s => escT(s).replace(/"/g, '&quot;');
const ic = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const noMotion = () => reduced.matches;
function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const plural = (n, one, few, many) => { n = Math.abs(n); const a = n % 10, b = n % 100; if (a === 1 && b !== 11) return one; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few; return many; };
const fmtN = n => Math.round(n).toLocaleString('ru-RU');
const fmtDate = t => { try { return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
const fmtShort = t => { try { return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const fmtDur = min => { min = Math.round(min); if (min < 1) return 'меньше минуты'; if (min < 60) return `${min} мин`; const h = Math.floor(min / 60), m = min % 60; return m && h < 10 ? `${h} ч ${m} мин` : `${h} ч`; };
const fmtBytes = b => b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} КБ` : b < 1073741824 ? `${(b / 1048576).toFixed(1).replace('.', ',')} МБ` : `${(b / 1073741824).toFixed(1).replace('.', ',').replace(',0', '')} ГБ`;
const CPM = 1200;          // символов в минуту — средняя скорость чтения
const CPP = 1800;          // символов на печатной странице
const AL = 40000;          // авторский лист
const plainOf = h => String(h).replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m]);
const textLen = h => plainOf(h).length;

const LS = {
  k: k => 'pereplet:' + k,
  get(k) { try { const v = localStorage.getItem(this.k(k)); return v == null ? null : JSON.parse(v); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(this.k(k), JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(this.k(k)); } catch {} },
  keys(prefix) { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('pereplet:' + prefix)) out.push(k.slice(9)); } } catch {} return out; }
};

function toast(msg, ms = 3200) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}
const scriptCache = {};
function loadScript(src) {
  return scriptCache[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { delete scriptCache[src]; rej(new Error('Не удалось загрузить модуль для разбора файла. Проверьте интернет и попробуйте ещё раз.')); };
    document.head.append(s);
  });
}
async function needJSZip() { if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'); return window.JSZip; }
async function needPdf() {
  if (!window.pdfjsLib) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  return window.pdfjsLib;
}
function blobToDataURL(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); }); }
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = src; }); }
async function shrinkImage(src, maxW, q = .84, maxH = 0) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const im = await loadImg(url);
    const w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) throw new Error('img');
    const k = Math.min(1, maxW / w, maxH ? maxH / h : 1);
    const cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas'); c.width = cw; c.height = chh;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, chh); x.drawImage(im, 0, 0, cw, chh);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', q));
  } finally { if (src instanceof Blob) URL.revokeObjectURL(url); }
}

/* ================= chess study (gate animation) ================= */
const Board = (() => {
  const G = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const RU = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К', P: '' };
  const START = 'wKg1 wQd2 wRa1 wRf1 wBc4 wNf3 wPa2 wPb2 wPc3 wPe4 wPf2 wPg2 wPh3 bKg8 bQd8 bRa8 bRe8 bBe7 bNc6 bPa7 bPb7 bPc7 bPd6 bPf7 bPg7 bPh6';
  const fresh = () => START.split(' ').map(s => ({ w: s[0] === 'w', t: s[1], x: s.charCodeAt(2) - 97, y: 8 - +s[3], a: 1 }));
  const nm = (x, y) => String.fromCharCode(97 + x) + (8 - y);
  const FONT = '"Segoe UI Symbol","Apple Symbols","DejaVu Sans","Noto Sans Symbols 2","Noto Sans Symbols",serif';
  function targets(p, ps) {
    const occ = (x, y) => ps.find(q => q.a > 0 && q.x === x && q.y === y);
    const out = [];
    const add = (x, y) => { if (x < 0 || y < 0 || x > 7 || y > 7) return false; const o = occ(x, y); if (o && (o.w === p.w || o.t === 'K')) return false; out.push({ x, y, cap: o || null }); return !o; };
    const ray = (dx, dy, n) => { for (let i = 1; i <= n; i++) if (!add(p.x + dx * i, p.y + dy * i)) break; };
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    if (p.t === 'N') [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([dx, dy]) => add(p.x + dx, p.y + dy));
    else if (p.t === 'K') D.forEach(([dx, dy]) => ray(dx, dy, 1));
    else if (p.t === 'Q') D.forEach(([dx, dy]) => ray(dx, dy, 3));
    else if (p.t === 'R') D.slice(0, 4).forEach(([dx, dy]) => ray(dx, dy, 4));
    else if (p.t === 'B') D.slice(4).forEach(([dx, dy]) => ray(dx, dy, 3));
    else {
      const dy = p.w ? -1 : 1, y = p.y + dy;
      if (y >= 0 && y <= 7 && !occ(p.x, y)) out.push({ x: p.x, y, cap: null });
      [-1, 1].forEach(dx => { const o = occ(p.x + dx, y); if (o && o.w !== p.w && o.t !== 'K') out.push({ x: p.x + dx, y, cap: o }); });
    }
    return out;
  }
  let live = null;
  function start(canvas) {
    stop();
    const ctx = canvas?.getContext('2d'); if (!ctx) return;
    const capEl = $('#gateCap'), capL = $('#gateCapL');
    let ps = fresh(), white = true, moveNo = 18, plan = null, t0 = performance.now(), raf = 0, run = true, W = 0, H = 0, dpr = 1;
    const size = () => { const r = canvas.getBoundingClientRect(); dpr = Math.min(1.5, devicePixelRatio || 1); W = r.width; H = r.height; canvas.width = Math.max(2, Math.round(W * dpr)); canvas.height = Math.max(2, Math.round(H * dpr)); if (noMotion()) frame(t0 + 1300); };
    function choose() {
      if (ps.filter(p => p.a > 0).length < 14) { ps = fresh(); white = true; moveNo = 18; }
      const opts = [];
      for (const p of ps) if (p.a > 0 && p.w === white) for (const t of targets(p, ps)) opts.push({ p, ...t });
      if (!opts.length) { ps = fresh(); white = true; moveNo = 18; return choose(); }
      for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
      const pick = opts.find(o => o.cap && Math.random() < .55) || opts.find(o => o.p.t !== 'K') || opts[0];
      const alts = opts.filter(o => o !== pick && !(o.x === pick.x && o.y === pick.y)).slice(0, 2);
      const txt = `${moveNo}.${white ? '' : '..'} ${RU[pick.p.t]}${nm(pick.p.x, pick.p.y)}${pick.cap ? '×' : '–'}${nm(pick.x, pick.y)}`;
      return { ...pick, fx: pick.p.x, fy: pick.p.y, alts, txt };
    }
    const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function arrow(sq, x1, y1, x2, y2, col, w, dash, k) {
      const ax = (x1 + .5) * sq, ay = (y1 + .5) * sq; let bx = (x2 + .5) * sq, by = (y2 + .5) * sq;
      bx = ax + (bx - ax) * k; by = ay + (by - ay) * k;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash ? [sq * .09, sq * .09] : []);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      if (k > .98) { const an = Math.atan2(by - ay, bx - ax), h = sq * .16; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - h * Math.cos(an - .45), by - h * Math.sin(an - .45)); ctx.lineTo(bx - h * Math.cos(an + .45), by - h * Math.sin(an + .45)); ctx.closePath(); ctx.fill(); }
    }
    function frame(now) {
      const T = 2800;
      if (!plan) { plan = choose(); if (capEl) capEl.textContent = plan.txt; }
      let ph = (now - t0) / T;
      if (ph >= 1 && !noMotion()) {
        const p = plan.p; p.x = plan.x; p.y = plan.y; if (plan.cap) plan.cap.a = 0;
        if (p.t === 'P' && (p.y === 0 || p.y === 7)) p.t = 'Q';
        white = !white; if (white) moveNo++;
        plan = choose(); t0 = now; ph = 0;
        if (capEl) capEl.textContent = plan.txt;
      }
      ph = clamp(ph, 0, 1);
      if (capL) capL.textContent = ph < .36 ? 'расчёт' : 'ход';
      const aIn = clamp(ph / .3, 0, 1), mv = ease(clamp((ph - .36) / .28, 0, 1)), aOut = 1 - clamp((ph - .7) / .26, 0, 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0A0B0D'; ctx.fillRect(0, 0, W, H);
      const sq = Math.max(W, H) / 6.2;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-.13); ctx.translate(-4 * sq, -4 * sq);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#14171A' : '#22262C'; ctx.fillRect(x * sq, y * sq, sq + .5, sq + .5); }
      ctx.strokeStyle = 'rgba(232,235,238,.08)'; ctx.lineWidth = 1; ctx.strokeRect(0, 0, 8 * sq, 8 * sq);
      ctx.font = `500 ${Math.round(sq * .12)}px "IBM Plex Mono",monospace`; ctx.fillStyle = 'rgba(232,235,238,.26)'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      for (let i = 0; i < 8; i++) { ctx.fillText(String.fromCharCode(97 + i), i * sq + sq * .06, 8 * sq - sq * .06); ctx.fillText(String(8 - i), sq * .06, i * sq + sq * .17); }
      // target square
      ctx.strokeStyle = `rgba(143,176,207,${.55 * aIn * aOut})`; ctx.lineWidth = Math.max(1, sq * .025);
      ctx.strokeRect(plan.x * sq + sq * .06, plan.y * sq + sq * .06, sq * .88, sq * .88);
      for (const o of plan.alts) arrow(sq, plan.fx, plan.fy, o.x, o.y, `rgba(143,176,207,${.38 * aIn * (1 - mv)})`, sq * .03, true, aIn);
      arrow(sq, plan.fx, plan.fy, plan.x, plan.y, `rgba(232,235,238,${.7 * aIn * aOut})`, sq * .045, false, aIn);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(sq * .74)}px ${FONT}`;
      for (const p of ps) {
        if (p.a <= 0) continue;
        let x = p.x, y = p.y, al = 1;
        if (p === plan.p) { x = plan.fx + (plan.x - plan.fx) * mv; y = plan.fy + (plan.y - plan.fy) * mv; }
        if (p === plan.cap) al = 1 - clamp((mv - .7) / .3, 0, 1);
        const cx = (x + .5) * sq, cy = (y + .54) * sq, g = G[p.t] + '︎';
        ctx.globalAlpha = al;
        if (p.w) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = sq * .12; ctx.fillStyle = '#E8EBEE'; ctx.fillText(g, cx, cy); ctx.shadowBlur = 0; }
        else { ctx.fillStyle = '#050607'; ctx.fillText(g, cx, cy); ctx.lineWidth = Math.max(.8, sq * .012); ctx.strokeStyle = 'rgba(190,200,210,.55)'; ctx.strokeText(g, cx, cy); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .15, W / 2, H / 2, Math.max(W, H) * .78);
      gr.addColorStop(0, 'rgba(10,11,13,0)'); gr.addColorStop(1, 'rgba(10,11,13,.9)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    const loop = now => { if (!run) return; if (!document.hidden) frame(now); raf = requestAnimationFrame(loop); };
    size(); addEventListener('resize', size);
    if (noMotion()) frame(t0 + 1300); else raf = requestAnimationFrame(loop);
    live = { stop() { run = false; cancelAnimationFrame(raf); removeEventListener('resize', size); } };
  }
  function stop() { live?.stop(); live = null; }
  return { start, stop };
})();

/* ================= state ================= */
const S = {
  db: null, user: null, assets: null, uid: null, owner: false, me: null,
  profile: null, local: false, books: new Map(), booksLoaded: false, states: new Map(),
  quotes: [], quotesLoaded: false, qstate: { seen: [], cur: null, updatedAt: 0 },
  view: 'library', inApp: false, sheet: null
};
const RIBBONS = [
  { c: '#8E2B2F', n: 'Гранат' }, { c: '#23272D', n: 'Графит' }, { c: '#46678A', n: 'Сталь' },
  { c: '#9AA5B1', n: 'Серебро' }, { c: '#2F4A3F', n: 'Малахит' }, { c: '#4E3A63', n: 'Аметист' }
];
const DEF_SET = { theme: 'auto', font: 'Literata', size: 19, lh: 1.6, margin: 'm', align: 'justify', indent: true, mode: 'paged', cols: 'auto', anim: 'slide' };
const settings = () => ({ ...DEF_SET, ...(S.profile?.settings || {}) });
const ribbon = () => S.profile?.ribbon || RIBBONS[0].c;
const userBase = () => `data/users/${S.uid || 'guest'}`;
const CLOTH = ['#15181C', '#23303D', '#2E353F', '#4A1E23', '#1F2B27', '#353A42', '#1B2433', '#3A2A30', '#262A30', '#2F3A46'];
const safeId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(s);
const coverSrc = b => b._src || (safeId(b.cover) ? '/_blob/' + b.cover : (typeof b.coverData === 'string' && b.coverData.startsWith('data:image/') ? b.coverData : ''));
function coverHTML(b) {
  const src = coverSrc(b);
  if (src) return `<div class="cover"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></div>`;
  const c = CLOTH[hash((b.title || '') + (b.author || '')) % CLOTH.length];
  const t = String(b.title || 'Без названия'); const lw = Math.max(...t.split(/\s+/).map(w => w.length));
  const ts = lw > 12 ? 1.02 : lw > 10 ? 1.16 : lw > 8 ? 1.32 : t.length > 40 ? 1.3 : 1.55;
  return `<div class="cover gen" style="--cc:${c};--ts:${ts}em"><div class="frame"></div><div class="ca">${esc(b.author || '')}</div><div class="ct">${esc(b.title || 'Без названия')}</div><div class="orn">▪</div></div>`;
}
const visibleBooks = () => [...S.books.values()].filter(b => S.owner || !b.hidden);
const cardNo = () => { const h = hash(S.uid || 'guest'); return `${String(h % 89 + 10)}-${String(Math.floor(h / 89) % 9000 + 1000)}`; };

/* ================= persistence ================= */
const W = new Map();
function save(path, data, delay = 1000) {
  let w = W.get(path); if (!w) { w = { t: 0, running: false, data: null }; W.set(path, w); }
  w.data = data; clearTimeout(w.t); w.t = setTimeout(() => flush(path), delay);
}
async function flush(path) {
  const w = W.get(path); if (!w || w.data == null) return;
  clearTimeout(w.t);
  if (w.running) return; // the running write picks up w.data when it finishes
  w.running = true;
  const data = w.data; w.data = null;
  try { await put(path, data); } catch (e) { await onWriteFail(e, path, data); }
  finally { w.running = false; if (w.data != null) flush(path); }
}
function flushAll() { for (const p of W.keys()) flush(p); }
async function put(path, data) {
  if (S.local || !S.db) { LS.set(path, data); return; }
  await S.db.doc(path).set(data);
}
async function onWriteFail(e, path, data) {
  const code = e?.code;
  if (code === 'unavailable' || code === 'resource_exhausted') {
    await sleep(900 + Math.random() * 1500);
    try { await S.db.doc(path).set(data); return; } catch {}
  }
  if (code === 'quota_exceeded') { toast('Хранилище библиотеки заполнено, изменения сохранены только на этом устройстве', 5200); LS.set(path, data); return; }
  goLocal(); LS.set(path, data);
}
function goLocal() {
  if (S.local) return;
  S.local = true;
  toast('С вашим доступом библиотека не принимает записи. Закладки будут храниться в этом браузере.', 6000);
  updateMe();
}
function ensureState(id) {
  let s = S.states.get(id);
  if (!s) { s = { book: id, pos: null, pct: 0, marks: [], hls: [], readMs: 0, startedAt: new Date().toISOString(), updatedAt: Date.now(), finished: false }; S.states.set(id, s); }
  s.marks ||= []; s.hls ||= [];
  return s;
}
function saveState(id, delay = 1500) {
  const s = S.states.get(id); if (!s) return;
  s.updatedAt = Date.now();
  save(`${userBase()}/b_${id}`, clone(s), delay);
}
function saveProfile(delay = 800) {
  if (!S.profile) return;
  S.profile.updatedAt = Date.now();
  save(`${userBase()}/profile`, clone(S.profile), delay);
}
function ingestUserDoc(id, data) {
  if (!data) return;
  if (id === 'quotes') {
    const q = S.qstate, seen = new Set([...(q.seen || []), ...(Array.isArray(data.seen) ? data.seen : [])]);
    const newer = (data.updatedAt || 0) > (q.updatedAt || 0);
    S.qstate = { seen: [...seen], cur: newer ? (data.cur ?? q.cur) : q.cur, updatedAt: Math.max(q.updatedAt || 0, data.updatedAt || 0) };
    return;
  }
  if (id === 'profile') {
    if (!S.profile || (data.updatedAt || 0) > (S.profile.updatedAt || 0)) S.profile = clone(data);
  } else if (id.startsWith('b_')) {
    const bid = id.slice(2), cur = S.states.get(bid);
    if (!cur || (data.updatedAt || 0) > (cur.updatedAt || 0)) S.states.set(bid, clone(data));
  }
}
function loadLocalStates() {
  for (const k of LS.keys(userBase() + '/')) ingestUserDoc(k.split('/').pop(), LS.get(k));
}
function subscribeBooks() {
  S.db.collection('books').onSnapshot(snap => {
    const m = new Map();
    for (const d of snap.docs) { const v = d.data(); if (v && typeof v.title === 'string') m.set(d.id, { ...clone(v), id: d.id }); }
    S.books = m; S.booksLoaded = true; onData();
  }, err => { console.warn('books', err); if (err?.code === 'unavailable') setTimeout(subscribeBooks, 4000); });
}
function subscribeQuotes() {
  S.db.doc('lib/quotes').onSnapshot(snap => {
    const d = snap.exists ? snap.data() : null;
    S.quotes = Array.isArray(d?.items) ? clone(d.items).filter(q => q && typeof q.id === 'string' && typeof q.text === 'string') : [];
    S.quotesLoaded = true; onData();
  }, err => { console.warn('quotes', err); if (err?.code === 'unavailable') setTimeout(subscribeQuotes, 4000); });
}
function subscribeUser() {
  S.db.collection(userBase()).onSnapshot(snap => {
    for (const d of snap.docs) ingestUserDoc(d.id, d.data());
    onData();
  }, err => { console.warn('user', err); if (err?.code === 'unavailable') setTimeout(subscribeUser, 4000); });
}
let dataRaf = 0;
function onData() {
  if (dataRaf) return;
  dataRaf = requestAnimationFrame(() => {
    dataRaf = 0;
    if (!S.inApp) return;
    if (S.view === 'library') updateLibrary();
    else if (S.view === 'marks') updateMarks();
    else if (S.view === 'quotes') { updateQuotes(); if (S.owner && !$('#qAdmin .confirm') && document.activeElement?.id !== 'qNew') renderQAdmin(); }
    else if (S.view === 'admin') updateAdmin();
    updateMe();
  });
}

/* ================= boot & gate ================= */
async function boot() {
  document.documentElement.lang = 'ru';
  Board.start($('#board'));
  const C = window.claude;
  let db = null, user = null, assets = null;
  if (C && typeof C.use === 'function') {
    [db, user, assets] = await Promise.all(['db', 'user', 'assets'].map(n => C.use(n).catch(() => null)));
  }
  S.db = db; S.user = user; S.assets = assets;
  if (!db) return gateNoDb();
  if (user) {
    try { const me = await user.me(); S.me = me; S.uid = me.id || null; S.owner = !!me.isOwner; } catch {}
  }
  subscribeBooks();
  subscribeQuotes();
  let prof = null;
  if (S.uid) { try { const snap = await db.doc(`${userBase()}/profile`).get(); if (snap.exists) prof = clone(snap.data()); } catch {} }
  const lsProf = LS.get(`${userBase()}/profile`);
  if (!S.uid) S.local = true;
  if (!prof && lsProf) { prof = lsProf; S.local = true; }
  S.profile = prof;
  loadLocalStates();
  if (!S.local) subscribeUser();
  if (!prof) return gateRegister();
  if (LS.get('signedOut')) return gateLogin();
  enterApp(false);
}
function showGate() { $('#gate').hidden = false; $('#app').hidden = true; }
function gateNoDb() {
  showGate();
  $('#gateBody').innerHTML = `<h2>Библиотека открывается внутри Claude</h2>
    <p>Откройте ссылку на эту страницу в Claude, войдя в свой аккаунт. Там появятся книги, а закладки начнут сохраняться.</p>`;
}
function statsOf() {
  let reading = 0, done = 0, marks = 0, ms = 0;
  for (const [id, s] of S.states) { if (!S.books.has(id)) continue; if (s.finished) done++; else if (s.pos) reading++; marks += (s.marks?.length || 0) + (s.hls?.length || 0); ms += s.readMs || 0; }
  return { reading, done, marks, ms };
}
function cardHTML(p, stamp = false) {
  const st = statsOf();
  const ava = S.me?.avatarUrl || '';
  return `<div class="lcard" style="--rib:${esc(p.ribbon || ribbon())}">
    <div class="lcard-top"><span class="eyebrow">Читательский билет</span><span class="lcard-no num">№ ${esc(p.cardNo || cardNo())}</span></div>
    <div class="lcard-name">${ava ? `<img src="${esc(ava)}" alt="">` : ''}<div><b>${esc(p.name || 'Читатель')}</b><small>${S.owner ? 'Библиотекарь · ' : ''}читатель с ${esc(fmtDate(p.createdAt || Date.now()))}</small></div></div>
    <div class="lcard-lines num"><div><b>${st.reading}</b><small>читаю</small></div><div><b>${st.done}</b><small>прочитано</small></div><div><b>${st.marks}</b><small>${plural(st.marks, 'пометка', 'пометки', 'пометок')}</small></div></div>
    <div class="stamp${stamp ? ' hit' : ''}">AynoBook<br>допуск<br>${new Date(p.createdAt || Date.now()).getFullYear()}</div>
  </div>`;
}
function gateRegister() {
  showGate();
  let pick = RIBBONS[hash(S.uid || 'g') % RIBBONS.length].c;
  const name = S.me?.name || '';
  $('#gateBody').innerHTML = `
    <h2>Оформите читательский билет</h2>
    <p>Один раз, без пароля. После этого библиотека помнит, где вы остановились, какие страницы заложили и что выделили.</p>
    <form id="regForm" style="display:grid;gap:18px" novalidate>
      <label class="field"><span>Имя в билете</span><input class="input" id="regName" maxlength="40" autocomplete="name" value="${esc(name)}" placeholder="Как к вам обращаться"></label>
      <div class="field"><span>Цвет ленты-закладки</span><div class="swatches" id="regRib">${RIBBONS.map(r => `<button type="button" class="swatch" style="--c:${r.c}" data-c="${r.c}" aria-label="${r.n}" aria-pressed="${r.c === pick}"></button>`).join('')}</div></div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn primary" type="submit" id="regGo" style="min-height:46px;padding:0 26px">Оформить билет</button></div>
      <p class="fineprint">Вход выполняется через ваш аккаунт Claude, поэтому пароль не нужен. Закладки, заметки и прогресс хранятся в вашем личном разделе библиотеки, и другие читатели их не видят.</p>
    </form>`;
  $('#regRib').onclick = e => { const b = e.target.closest('.swatch'); if (!b) return; pick = b.dataset.c; $$('#regRib .swatch').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
  $('#regForm').onsubmit = async e => {
    e.preventDefault();
    const nm = $('#regName').value.trim();
    if (!nm) { $('#regName').focus(); $('#regName').placeholder = 'Впишите имя, хотя бы короткое'; return; }
    $('#regGo').disabled = true;
    const p = { name: nm.slice(0, 40), ribbon: pick, cardNo: cardNo(), createdAt: new Date().toISOString(), updatedAt: Date.now(), settings: { ...DEF_SET } };
    S.profile = p;
    const path = `${userBase()}/profile`;
    if (S.local) LS.set(path, p);
    else { try { await S.db.doc(path).set(p); } catch (err) { S.local = true; LS.set(path, p); } }
    LS.del('signedOut');
    $('#gateBody').innerHTML = `<h2>Билет выдан</h2>${cardHTML(p, true)}<p class="fineprint">${S.local ? 'Ваш доступ к библиотеке только на чтение, поэтому закладки будут храниться в этом браузере.' : 'Добро пожаловать в библиотеку.'}</p>`;
    await sleep(noMotion() ? 300 : 1500);
    enterApp(true);
  };
  setTimeout(() => $('#regName')?.focus(), 400);
}
function gateLogin() {
  showGate();
  const p = S.profile;
  $('#gateBody').innerHTML = `<h2>С возвращением</h2>${cardHTML(p)}
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn primary" id="loginGo" style="min-height:46px;padding:0 26px">Войти в библиотеку</button></div>
    <p class="fineprint">Билет привязан к аккаунту Claude, в котором вы сейчас. Чтобы войти под другим билетом, смените аккаунт в Claude.</p>`;
  $('#loginGo').onclick = async () => {
    LS.del('signedOut');
    $('#gateBody .stamp')?.classList.add('hit');
    await sleep(noMotion() ? 100 : 650);
    enterApp(false);
  };
  setTimeout(() => $('#loginGo')?.focus(), 300);
}
function enterApp(fresh) {
  const gate = $('#gate');
  S.inApp = true;
  $('#app').hidden = false;
  $$('[data-admin]').forEach(el => el.hidden = !S.owner);
  updateMe();
  go(S.owner && !visibleBooks().length && S.booksLoaded ? 'admin' : 'library', true);
  if (!gate.hidden) {
    gate.style.transition = 'opacity .5s ease, transform .6s cubic-bezier(.65,0,.35,1)';
    gate.style.opacity = '0'; gate.style.transform = 'scale(1.02)';
    setTimeout(() => { gate.hidden = true; gate.style.cssText = ''; Board.stop(); }, noMotion() ? 0 : 560);
  }
  if (!fresh && S.profile?.name) toast(`${S.profile.name}, вход выполнен`);
}
function signOut() {
  flushAll(); closeSheet(true);
  LS.set('signedOut', true);
  S.inApp = false;
  gateLogin();
  Board.start($('#board'));
}
function updateMe() {
  if (!S.profile) return;
  const img = $('#meAva');
  const ava = S.me?.avatarUrl;
  if (ava) { img.src = ava; img.hidden = false; } else img.hidden = true;
  $('#meName').textContent = S.profile.name || 'Читатель';
  $('#meChip').title = S.local ? 'Закладки хранятся в этом браузере' : 'Читательский билет';
  $('#meChip').style.setProperty('--rib', ribbon());
}

/* ================= navigation ================= */
function go(view, instant) {
  if (view === 'card') { openCardSheet(); return; }
  if (view === 'admin' && !S.owner) view = 'library';
  S.view = view;
  $$('[data-go]').forEach(b => { if (b.classList.contains('brand')) return; if (b.dataset.go === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  moveTabInd(instant);
  const v = $('#view');
  v.classList.remove('view-enter'); void v.offsetWidth; v.classList.add('view-enter');
  if (view === 'library') renderLibrary();
  else if (view === 'marks') renderMarks();
  else if (view === 'quotes') renderQuotes();
  else if (view === 'admin') renderAdmin();
  window.scrollTo({ top: 0, behavior: instant || noMotion() ? 'auto' : 'smooth' });
}
function moveTabInd(instant) {
  const ind = $('#tabInd'); const cur = $('#tabs [aria-current="page"]');
  if (!cur) { ind.style.width = '0px'; return; }
  if (instant) ind.style.transition = 'none';
  ind.style.left = cur.offsetLeft + 'px'; ind.style.width = cur.offsetWidth + 'px';
  if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
}
addEventListener('resize', () => moveTabInd(true));
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g && !g.closest('.reader')) { e.preventDefault(); go(g.dataset.go); }
});
$('#meChip').onclick = () => openCardSheet();

/* ================= sheets ================= */
function openSheet({ head = '', body, foot = '', label = '', bind }) {
  closeSheet(true);
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', label || head);
  sh.innerHTML = `<div class="sheet-head"><span class="eyebrow">${esc(head)}</span><button class="icon-btn" data-close aria-label="Закрыть">${ic('close')}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  document.body.append(scrim, sh);
  scrim.onclick = () => closeSheet();
  sh.querySelector('[data-close]').onclick = () => closeSheet();
  S.sheet = { scrim, sh, prev: document.activeElement };
  bind?.(sh);
  setTimeout(() => sh.querySelector('[data-close]')?.focus({ preventScroll: true }), 60);
  return sh;
}
function closeSheet(instant) {
  const s = S.sheet; if (!s) return;
  S.sheet = null;
  if (instant === true || noMotion()) { s.scrim.remove(); s.sh.remove(); return; }
  s.scrim.classList.add('out'); s.sh.classList.add('out');
  setTimeout(() => { s.scrim.remove(); s.sh.remove(); }, 320);
  try { s.prev?.focus?.({ preventScroll: true }); } catch {}
}
function openCardSheet() {
  const p = S.profile; if (!p) return;
  let pick = p.ribbon || ribbon();
  const st = statsOf();
  openSheet({
    head: 'Читательский билет',
    body: `${cardHTML(p)}
      <div class="facts num"><div><b>${fmtDur(st.ms / 60000)}</b><small>за чтением</small></div><div><b>${st.done}</b><small>${plural(st.done, 'книга дочитана', 'книги дочитаны', 'книг дочитано')}</small></div><div><b>${visibleBooks().length}</b><small>на полке</small></div></div>
      <label class="field"><span>Имя в билете</span><input class="input" id="cName" maxlength="40" value="${esc(p.name || '')}"></label>
      <div class="field"><span>Цвет ленты-закладки</span><div class="swatches" id="cRib">${RIBBONS.map(r => `<button type="button" class="swatch" style="--c:${r.c}" data-c="${r.c}" aria-label="${r.n}" aria-pressed="${r.c === pick}"></button>`).join('')}</div></div>
      ${S.local ? `<div class="hint">${ic('info')}<div>Закладки и прогресс сейчас хранятся <b>только в этом браузере</b>: ваш доступ к библиотеке не позволяет сохранять их на сервере. Попросите библиотекаря выдать доступ с правом изменений.</div></div>` : `<div class="hint">${ic('check')}<div>Закладки, выделения и прогресс сохраняются в вашем профиле и доступны на любом устройстве, где вы вошли в Claude.</div></div>`}`,
    foot: `<button class="btn ghost" id="cOut">${ic('logout')} Выйти</button><button class="btn primary" id="cSave">Сохранить</button>`,
    bind(sh) {
      $('#cRib', sh).onclick = e => { const b = e.target.closest('.swatch'); if (!b) return; pick = b.dataset.c; $$('#cRib .swatch', sh).forEach(x => x.setAttribute('aria-pressed', String(x === b))); sh.querySelector('.lcard').style.setProperty('--rib', pick); };
      $('#cSave', sh).onclick = () => { const nm = $('#cName', sh).value.trim(); if (nm) p.name = nm.slice(0, 40); p.ribbon = pick; saveProfile(100); updateMe(); closeSheet(); toast('Билет обновлён'); onData(); };
      $('#cOut', sh).onclick = signOut;
    }
  });
}
