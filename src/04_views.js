
/* ================= library ================= */
const L = Object.assign({ q: '', filter: 'all', sort: 'recent' }, LS.get('lib') || {});
const FILTERS = [['all', 'Все'], ['reading', 'Читаю'], ['new', 'Не начаты'], ['done', 'Прочитаны']];
const SORTS = [['recent', 'Недавно читал'], ['added', 'Новые на полке'], ['title', 'По названию'], ['author', 'По автору']];
let libFirst = true;
const pctOfState = s => Math.round(clamp((s?.pct || 0) * 100, 0, 100));
const isNew = b => b.addedAt && Date.now() - new Date(b.addedAt).getTime() < 14 * 864e5;
function chapterTitle(b, c) { return b?.chapters?.[c]?.t || ''; }

function renderLibrary() {
  libFirst = true;
  $('#view').innerHTML = `
    <section id="heroSlot"></section>
    <section class="shelf" aria-labelledby="shelfH">
      <div class="shelf-head">
        <h2 id="shelfH">Полка <small id="shelfCount" class="num"></small></h2>
        <div class="shelf-tools">
          <label class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="libQ" type="search" placeholder="Название или автор" value="${esc(L.q)}" aria-label="Поиск по полке"></label>
          <div class="chips" id="libF">${FILTERS.map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${L.filter === k}">${t}</button>`).join('')}</div>
          <select class="input" id="libS" aria-label="Порядок">${SORTS.map(([k, t]) => `<option value="${k}"${L.sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div>
      </div>
      <div id="gridSlot"></div>
    </section>${S.public ? `<p class="fineprint" style="text-align:center">Читать можно без входа, закладки хранятся в этом браузере. Библиотекарь? <a href="${CLAUDE_URL}" rel="noopener" style="color:var(--brass)">Войти через Claude</a></p>` : ''}`;
  const persist = () => LS.set('lib', L);
  $('#libQ').oninput = e => { L.q = e.target.value; persist(); updateLibrary(); };
  $('#libF').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; L.filter = b.dataset.f; persist(); $$('#libF .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); updateLibrary(); };
  $('#libS').onchange = e => { L.sort = e.target.value; persist(); updateLibrary(); };
  $('#view').onclick = libClick;
  updateLibrary();
}
function libClick(e) {
  const r = e.target.closest('[data-read]');
  if (r) { const id = r.dataset.read; openReader(id, { fromEl: r.closest('.hero')?.querySelector('.book') || r }); return; }
  const i = e.target.closest('[data-info]');
  if (i) { openBookSheet(i.dataset.info); return; }
  const a = e.target.closest('[data-goadmin]');
  if (a) go('admin');
}
function updateLibrary() {
  if (S.view !== 'library' || !$('#gridSlot')) return;
  const all = visibleBooks();
  // hero
  const hero = $('#heroSlot');
  const cont = all.map(b => ({ b, s: S.states.get(b.id) })).filter(x => x.s?.pos && !x.s.finished).sort((a, b) => (b.s.updatedAt || 0) - (a.s.updatedAt || 0))[0];
  const fresh = !cont && all.slice().sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))[0];
  const hb = cont?.b || fresh;
  if (hb) {
    const s = cont?.s; const pct = pctOfState(s);
    const left = s ? (hb.chars || 0) * (1 - (s.pct || 0)) / CPM : (hb.chars || 0) / CPM;
    const key = hb.id + ':' + pct + ':' + (s?.marks?.length || 0) + ':' + (hb.updatedAt || 0);
    if (hero.dataset.key !== key) {
      hero.dataset.key = key;
      hero.innerHTML = `<div class="hero">
        <div class="hero-end"><button class="book" data-read="${hb.id}" aria-label="Открыть «${esc(hb.title)}»">${coverHTML(hb)}</button></div>
        <div class="hero-text">
          <span class="eyebrow">${s ? 'Продолжить чтение' : 'Новое на полке'}</span>
          <h1 class="hero-title">${esc(hb.title)}</h1>
          <p class="hero-author">${esc(hb.author || 'Автор не указан')}</p>
          ${s ? `<p class="hero-where">${esc(chapterTitle(hb, s.pos?.c || 0))}</p><div class="progress"><i data-w="${pct}"></i></div>` : (hb.description ? `<p class="hero-where" style="max-width:60ch;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(hb.description)}</p>` : '')}
          <div class="hero-stats num">${s ? `<span><b>${pct}%</b> прочитано</span>` : `<span><b>≈ ${fmtN(Math.max(1, (hb.chars || 0) / CPP))}</b> стр.</span>`}<span>${s ? 'осталось' : 'на чтение'} <b>≈ ${fmtDur(left)}</b></span>${s?.marks?.length ? `<span><b>${s.marks.length}</b> ${plural(s.marks.length, 'закладка', 'закладки', 'закладок')}</span>` : ''}</div>
          <div class="hero-actions"><button class="btn primary" data-read="${hb.id}">${s ? 'Продолжить' : 'Начать читать'}</button><button class="btn ghost" data-info="${hb.id}">О книге</button></div>
        </div></div>`;
      requestAnimationFrame(() => requestAnimationFrame(() => { const i = hero.querySelector('.progress i'); if (i) i.style.width = i.dataset.w + '%'; }));
    }
  } else { hero.innerHTML = ''; hero.dataset.key = ''; }

  // shelf
  const q = L.q.trim().toLowerCase().replace(/ё/g, 'е');
  let list = all.filter(b => {
    const s = S.states.get(b.id);
    if (L.filter === 'reading' && !(s?.pos && !s.finished)) return false;
    if (L.filter === 'new' && s?.pos) return false;
    if (L.filter === 'done' && !s?.finished) return false;
    if (q && !(`${b.title} ${b.author} ${b.genre || ''}`.toLowerCase().replace(/ё/g, 'е').includes(q))) return false;
    return true;
  });
  const cmp = {
    recent: (a, b) => ((S.states.get(b.id)?.updatedAt || 0) - (S.states.get(a.id)?.updatedAt || 0)) || String(b.addedAt).localeCompare(String(a.addedAt)),
    added: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
    title: (a, b) => a.title.localeCompare(b.title, 'ru'),
    author: (a, b) => (a.author || 'яя').localeCompare(b.author || 'яя', 'ru') || a.title.localeCompare(b.title, 'ru')
  }[L.sort] || (() => 0);
  list.sort(cmp);
  $('#shelfCount').textContent = all.length ? `${all.length} ${plural(all.length, 'книга', 'книги', 'книг')}` : '';
  const slot = $('#gridSlot');
  if (!S.booksLoaded) { slot.innerHTML = `<div class="empty"><span class="loading-dots"><i></i><i></i><i></i></span><p>Снимаю книги с полки…</p></div>`; return; }
  if (!all.length) {
    slot.innerHTML = S.owner
      ? `<div class="empty">${shelfArt()}<h3>Полка пока пуста</h3><p>Загрузите первые книги: FB2, EPUB, TXT или PDF. Читатели увидят их сразу после добавления.</p><button class="btn primary" data-goadmin>${ic('upload')} Добавить книги</button></div>`
      : `<div class="empty">${shelfArt()}<h3>Библиотекарь ещё расставляет книги</h3><p>Как только книги появятся, они будут здесь. Страницу можно не обновлять.</p></div>`;
    return;
  }
  if (!list.length) { slot.innerHTML = `<div class="empty"><h3>Ничего не нашлось</h3><p>Попробуйте другой запрос или снимите фильтр.</p></div>`; return; }
  slot.innerHTML = `<div class="grid${libFirst ? '' : ' static'}">${list.map(tileHTML).join('')}</div>`;
  libFirst = false;
}
function tileHTML(b, i) {
  const s = S.states.get(b.id); const pct = pctOfState(s);
  let st = '';
  if (s?.finished) st = `<span class="badge gilt">${ic('check')} Прочитана</span>`;
  else if (s?.pos) st = `<div class="progress"><i style="width:${pct}%"></i></div><span class="num">${pct}%</span>`;
  else if (isNew(b)) st = `<span class="badge">Новинка</span>`;
  if (b.hidden) st += `<span class="badge muted">Скрыта</span>`;
  const rib = s?.marks?.length ? `<i class="mini-rib" style="--rib:${esc(ribbon())}"></i>` : '';
  return `<button class="tile" data-info="${b.id}" style="--i:${Math.min(i, 18)}" aria-label="${esc(b.title)}${b.author ? ', ' + esc(b.author) : ''}">
    <div class="book">${coverHTML(b)}${rib}</div>
    <div class="tile-meta"><div class="t-title">${esc(b.title)}</div><div class="t-author">${esc(b.author || 'Автор не указан')}</div>${st ? `<div class="t-state">${st}</div>` : ''}</div>
  </button>`;
}
function shelfArt() {
  const cs = ['var(--ink)', 'var(--muted)', 'var(--ribbon)', 'var(--ink-2)', 'var(--line-2)', 'var(--brass)', 'var(--ink)'];
  return `<div class="drop-books" aria-hidden="true">${cs.map((c, i) => `<i style="--c:${c};--d:${i * .18}s;height:${38 + (hash(c + i) % 26)}px"></i>`).join('')}</div>`;
}
const FORMAT = { epub: 'EPUB', fb2: 'FB2', txt: 'TXT', pdf: 'PDF', html: 'HTML', md: 'Markdown' };

function openBookSheet(id) {
  const b = S.books.get(id); if (!b) return;
  const s = S.states.get(id); const started = !!s?.pos; const pct = pctOfState(s);
  const pages = Math.max(1, Math.round((b.chars || 0) / CPP));
  const nCh = b.chapters?.length || 0;
  const curC = s?.pos?.c ?? -1;
  const toc = (b.chapters || []).map((c, i) => `<button data-ch="${i}" class="lv${c.l || 1}${i === curC ? ' cur' : ''}"><span>${esc(c.t)}</span><small class="num" style="color:var(--muted)">${fmtN(Math.max(1, (c.n || 0) / CPP))} с.</small></button>`).join('');
  const marks = [...(s?.marks || []).map(m => ({ ...m, k: 'm' })), ...(s?.hls || []).map(h => ({ ...h, k: 'h', p: h.p1, o: h.o1 }))].sort((a, b) => a.c - b.c || a.p - b.p || a.o - b.o);
  openSheet({
    head: FORMAT[b.format] ? `Книга · ${FORMAT[b.format]}` : 'Книга',
    label: b.title,
    body: `<div class="detail-top"><div class="book">${coverHTML(b)}</div><div>${b.genre ? `<span class="eyebrow">${esc(b.genre)}</span>` : ''}<h2>${esc(b.title)}</h2><p>${esc(b.author || 'Автор не указан')}</p></div></div>
      <div class="facts num"><div><b>≈ ${fmtN(pages)}</b><small>${plural(pages, 'страница', 'страницы', 'страниц')}</small></div><div><b>${nCh}</b><small>${plural(nCh, 'глава', 'главы', 'глав')}</small></div><div><b>${fmtDur((b.chars || 0) / CPM)}</b><small>на чтение</small></div></div>
      ${started ? `<div style="display:grid;gap:8px"><div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>${s.finished ? 'Прочитана' : esc(chapterTitle(b, s.pos.c))}</span><span class="num">${pct}%</span></div><div class="progress" style="max-width:none"><i style="width:${pct}%"></i></div></div>` : ''}
      ${b.description ? `<div><p class="section-t">Аннотация</p><p class="desc">${esc(b.description)}</p></div>` : ''}
      ${nCh ? `<div><p class="section-t">Оглавление</p><div class="toc-list">${toc}</div></div>` : ''}
      ${marks.length ? `<div><p class="section-t">Ваши пометки · ${marks.length}</p><div style="display:grid;gap:10px">${marks.slice(0, 30).map((m, i) => markCard(b, m, i)).join('')}</div></div>` : ''}`,
    foot: `${started ? `<button class="btn ghost" id="bsRestart">С начала</button>` : ''}<button class="btn primary" id="bsRead">${started ? (s.finished ? 'Открыть снова' : 'Продолжить чтение') : 'Читать'}</button>`,
    bind(sh) {
      $('#bsRead', sh).onclick = () => openReader(id, { fromEl: sh.querySelector('.detail-top .book') });
      $('#bsRestart', sh) && ($('#bsRestart', sh).onclick = () => openReader(id, { restart: true, fromEl: sh.querySelector('.detail-top .book') }));
      sh.querySelector('.sheet-body').addEventListener('click', e => {
        const ch = e.target.closest('[data-ch]'); if (ch) { openReader(id, { pos: { c: +ch.dataset.ch, p: 0, o: 0 } }); return; }
        const m = e.target.closest('[data-pos]'); if (m) { const [c, p, o] = m.dataset.pos.split(',').map(Number); openReader(id, { pos: { c, p, o }, flash: +m.dataset.len || 0 }); }
      });
    }
  });
}
const HLC = { y: 'rgba(226,184,64,.42)', g: 'rgba(96,176,128,.40)', b: 'rgba(96,150,220,.38)', r: 'rgba(222,106,128,.38)' };
const HLN = { y: 'Жёлтый', g: 'Зелёный', b: 'Голубой', r: 'Розовый' };
function markCard(b, m, i) {
  const pctTxt = b.chars && m.pct != null ? ` · ${Math.round(m.pct * 100)}%` : '';
  const kind = m.k === 'm' ? `<span class="kind"><i style="--rib:${esc(ribbon())}"></i>Закладка</span>` : `<span class="kind"><i class="sw" style="--hlc:${HLC[m.color] || HLC.y}"></i>Выделение</span>`;
  return `<button class="mark" style="--i:${Math.min(i, 16)};--hlc:${HLC[m.color] || HLC.y}" data-pos="${m.c},${m.p},${m.o || 0}" data-len="${m.k === 'h' ? (m.p2 === m.p1 ? m.o2 - m.o1 : 0) : 0}">
    <p class="mark-q${m.k === 'h' ? ' hl' : ''}">${esc(m.text || '…')}</p>
    ${m.note ? `<p class="mark-note">${esc(m.note)}</p>` : ''}
    <div class="mark-meta">${kind}<span>${esc(chapterTitle(b, m.c)).slice(0, 40)}${pctTxt} · ${fmtShort(m.at)}</span></div>
  </button>`;
}

/* ================= marks view ================= */
const M = { filter: 'all', q: '' };
function renderMarks() {
  $('#view').innerHTML = `<section>
    <div class="shelf-head"><h2>Закладки и заметки <small id="marksCount" class="num"></small></h2>
      <div class="shelf-tools"><label class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="mQ" type="search" placeholder="Искать в цитатах и заметках" value="${esc(M.q)}" aria-label="Поиск по заметкам"></label>
      <div class="chips" id="mF">${[['all', 'Все'], ['m', 'Закладки'], ['h', 'Выделения'], ['n', 'С заметками']].map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${M.filter === k}">${t}</button>`).join('')}</div></div></div>
    <div id="marksSlot" style="display:grid;gap:40px"></div></section>`;
  $('#mQ').oninput = e => { M.q = e.target.value; updateMarks(); };
  $('#mF').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; M.filter = b.dataset.f; $$('#mF .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); updateMarks(); };
  $('#marksSlot').onclick = e => {
    const m = e.target.closest('[data-pos]'); if (!m) return;
    const id = m.closest('[data-book]').dataset.book; const [c, p, o] = m.dataset.pos.split(',').map(Number);
    openReader(id, { pos: { c, p, o }, flash: +m.dataset.len || 0, fromEl: m.closest('[data-book]').querySelector('.book') });
  };
  updateMarks();
}
function updateMarks() {
  const slot = $('#marksSlot'); if (!slot || S.view !== 'marks') return;
  const q = M.q.trim().toLowerCase();
  const groups = []; let total = 0;
  for (const [id, s] of S.states) {
    const b = S.books.get(id); if (!b || (b.hidden && !S.owner)) continue;
    let items = [...(s.marks || []).map(m => ({ ...m, k: 'm' })), ...(s.hls || []).map(h => ({ ...h, k: 'h', p: h.p1, o: h.o1 }))];
    total += items.length;
    items = items.filter(m => (M.filter === 'all' || (M.filter === 'n' ? !!m.note : m.k === M.filter)) && (!q || `${m.text} ${m.note || ''}`.toLowerCase().includes(q)));
    if (items.length) groups.push({ b, s, items: items.sort((a, c) => a.c - c.c || a.p - c.p || a.o - c.o) });
  }
  groups.sort((a, b) => (b.s.updatedAt || 0) - (a.s.updatedAt || 0));
  $('#marksCount').textContent = total ? `${total}` : '';
  if (!groups.length) {
    slot.innerHTML = total ? `<div class="empty"><h3>Ничего не нашлось</h3><p>Попробуйте другое слово или снимите фильтр.</p></div>`
      : `<div class="empty"><h3>Здесь соберутся ваши пометки</h3><p>Во время чтения нажмите на ленточку, чтобы заложить страницу, или выделите фрагмент текста, чтобы подсветить его и добавить заметку.</p></div>`;
    return;
  }
  slot.innerHTML = groups.map(g => `<div class="marks-group" data-book="${g.b.id}">
      <div class="marks-book"><div class="book">${coverHTML(g.b)}</div><div><h3>${esc(g.b.title)}</h3><p>${esc(g.b.author || '')} · ${g.items.length} ${plural(g.items.length, 'пометка', 'пометки', 'пометок')}</p></div></div>
      <div class="mark-list">${g.items.map((m, i) => markCard(g.b, m, i)).join('')}</div></div>`).join('');
}

/* ================= quotes ================= */
function saveQState() { S.qstate.updatedAt = Date.now(); save(`${userBase()}/quotes`, clone(S.qstate), 300); }
function renderQuotes() {
  $('#view').innerHTML = `<section style="display:grid;gap:28px">
      <div class="shelf-head" style="margin:0"><h2>Цитаты <small id="qCount" class="num"></small></h2></div>
      <div id="qSlot"></div>
      <div id="qHist"></div>
    </section>
    ${S.owner ? `<section class="qadmin" id="qAdmin"></section>` : ''}`;
  $('#view').onclick = quotesClick;
  $('#view').oninput = null;
  updateQuotes(true);
  if (S.owner) renderQAdmin();
}
function quoteParts() {
  const byId = new Map(S.quotes.map(q => [q.id, q]));
  const seenSet = new Set(S.qstate.seen);
  const seen = S.qstate.seen.map(id => byId.get(id)).filter(Boolean);
  const unseen = S.quotes.filter(q => !seenSet.has(q.id));
  return { byId, seen, unseen };
}
function pickQuote() {
  const { unseen } = quoteParts();
  if (!unseen.length) return null;
  const q = unseen[Math.floor(Math.random() * unseen.length)];
  S.qstate.seen = [...S.qstate.seen.filter(x => x !== q.id), q.id];
  S.qstate.cur = q.id;
  saveQState();
  return q;
}
function updateQuotes(first) {
  const slot = $('#qSlot'); if (!slot || S.view !== 'quotes') return;
  if (!S.quotesLoaded) { slot.innerHTML = `<div class="empty"><span class="loading-dots"><i></i><i></i><i></i></span></div>`; return; }
  let { byId, seen, unseen } = quoteParts();
  $('#qCount').textContent = S.quotes.length ? `${seen.length} из ${S.quotes.length}` : '';
  if (!S.quotes.length) {
    slot.innerHTML = `<div class="empty"><h3>Цитат пока нет</h3><p>${S.owner ? 'Добавьте их в блоке ниже: по одной на строку.' : 'Библиотекарь ещё не добавил цитаты. Когда они появятся, здесь будет новая при каждом нажатии.'}</p></div>`;
    $('#qHist').innerHTML = ''; return;
  }
  let cur = byId.get(S.qstate.cur);
  let fresh = false;
  if (!cur) { cur = pickQuote(); fresh = true; ({ seen, unseen } = quoteParts()); }
  const key = (cur?.id || 'none') + ':' + unseen.length + ':' + S.quotes.length;
  if (slot.dataset.key !== key || first) {
    const animate = first || fresh || slot.dataset.cur !== (cur?.id || '');
    slot.dataset.key = key; slot.dataset.cur = cur?.id || '';
    slot.innerHTML = cur ? quoteCard(cur, seen.length, unseen.length, animate) : `<div class="empty"><h3>Все цитаты прочитаны</h3><p>Новые появятся, когда библиотекарь их добавит.</p></div>`;
  }
  $('#qCount').textContent = `${seen.length} из ${S.quotes.length}`;
  const hist = seen.filter(q => q.id !== cur?.id).reverse();
  $('#qHist').innerHTML = hist.length ? `<details class="qhist"><summary>Уже прочитанные · ${hist.length}</summary><ol>${hist.map(q => `<li><p>${esc(q.text)}</p>${q.src ? `<small>${esc(q.src)}</small>` : ''}</li>`).join('')}</ol></details>` : '';
}
function quoteCard(q, n, left, animate) {
  let i = 0;
  const words = esc(q.text).split(/(\s+)/).map(w => /^\s+$/.test(w) || !w ? w : `<span class="w" style="--d:${Math.min(i++ * 32, 1400)}ms">${w}</span>`).join('');
  return `<article class="qcard${animate ? ' anim' : ''}" aria-live="polite">
    <div class="qmeta num"><span>№ ${String(n).padStart(2, '0')}</span><span class="qsq" aria-hidden="true"></span></div>
    <blockquote class="qtext">${words}</blockquote>
    ${q.src ? `<p class="qsrc">${esc(q.src)}</p>` : ''}
    <div class="qact">
      ${left ? `<button class="btn primary" data-qnext>Следующая цитата</button>` : `<span class="qdone">Вы прочли все цитаты. Новые появятся, когда библиотекарь их добавит.</span>`}
      <button class="btn ghost" data-qcopy>${ic('copy')} Копировать</button>
      <span class="qleft num">${left ? `новых осталось: ${left}` : ''}</span>
    </div>
  </article>`;
}
async function quotesClick(e) {
  if (e.target.closest('[data-qnext]')) {
    const t = $('.qtext'); if (t && !noMotion()) { t.classList.add('out'); await sleep(260); }
    if (!pickQuote()) { toast('Новых цитат нет'); }
    updateQuotes(); return;
  }
  if (e.target.closest('[data-qcopy]')) {
    const q = S.quotes.find(x => x.id === S.qstate.cur); if (!q) return;
    const p = navigator.clipboard?.writeText(q.src ? `${q.text}\n— ${q.src}` : q.text);
    Promise.resolve(p).then(() => toast('Цитата скопирована', 1800), () => toast('Браузер не дал скопировать. Выделите текст и нажмите Ctrl+C'));
    return;
  }
  if (e.target.closest('#qAdd')) { addQuotes(); return; }
  const d = e.target.closest('[data-qdel]');
  if (d) {
    if (d.dataset.sure !== '1') { d.dataset.sure = '1'; d.textContent = 'Точно удалить?'; setTimeout(() => { if (d.isConnected) { d.dataset.sure = ''; d.innerHTML = ic('trash'); } }, 3000); return; }
    await writeQuotes(S.quotes.filter(q => q.id !== d.dataset.qdel)); toast('Цитата удалена', 1800);
  }
}
async function writeQuotes(items) {
  const doc = { items, updatedAt: Date.now() };
  if (JSON.stringify(doc).length > 240000) { toast('Слишком много цитат в одном списке. Удалите часть старых.'); return false; }
  try { await S.db.doc('lib/quotes').set(doc); return true; } catch (e) { toast(errText(e)); return false; }
}
async function addQuotes() {
  const ta = $('#qNew'); const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { ta.focus(); return; }
  const have = new Set(S.quotes.map(q => q.text.toLowerCase()));
  const add = [];
  for (const l of lines) {
    const m = /^(.*\S)\s+[—–]\s+([^—–]{1,120})$/.exec(l);
    const text = (m ? m[1] : l).replace(/^[«"“]+|[»"”]+$/g, '').trim().slice(0, 600), src = m ? m[2].trim() : '';
    if (!text || have.has(text.toLowerCase())) continue;
    have.add(text.toLowerCase()); add.push({ id: 'q' + rid(), text, src, at: Date.now() });
  }
  if (!add.length) { toast('Эти цитаты уже есть'); return; }
  $('#qAdd').disabled = true;
  if (await writeQuotes([...S.quotes, ...add])) { ta.value = ''; toast(`Добавлено: ${add.length}`); }
  $('#qAdd').disabled = false;
}
function renderQAdmin() {
  const host = $('#qAdmin'); if (!host) return;
  host.innerHTML = `<div class="shelf-head"><h2>Управление цитатами <small class="num">${S.quotes.length}</small></h2></div>
    <div class="qadd">
      <label class="field"><span>Новые цитаты</span><textarea class="input" id="qNew" rows="5" placeholder="Каждая цитата с новой строки. Источник можно указать через тире в конце: Текст — Источник"></textarea></label>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn primary" id="qAdd">${ic('plus')} Добавить</button><span class="fineprint">Повторы пропускаются. Читатель никогда не увидит одну цитату дважды: каждая показывается ему один раз.</span></div>
    </div>
    ${S.quotes.length ? `<div class="qrows">${S.quotes.map((q, i) => `<div class="qrow2"><span class="num">${String(i + 1).padStart(2, '0')}</span><p>${esc(q.text)}${q.src ? ` <small>— ${esc(q.src)}</small>` : ''}</p><button class="icon-btn" data-qdel="${q.id}" aria-label="Удалить цитату">${ic('trash')}</button></div>`).join('')}</div>` : ''}`;
}

/* ================= admin ================= */
const Q = [];
let adminBound = false;
function renderAdmin() {
  if (!S.owner) return go('library');
  $('#view').innerHTML = `
    <section class="drop" id="drop">
      ${shelfArt()}
      <h3>Добавить книги на полку</h3>
      <p>Перетащите файлы сюда или выберите их на компьютере. Можно сразу несколько.</p>
      <div class="formats"><span>FB2</span><span>FB2.ZIP</span><span>EPUB</span><span>TXT</span><span>PDF</span><span>HTML</span><span>MD</span></div>
      <label class="btn primary" style="margin-top:6px">${ic('upload')} Выбрать файлы<input type="file" id="fileIn" multiple accept=".fb2,.zip,.fbz,.epub,.txt,.pdf,.html,.htm,.xhtml,.md,.markdown" class="sr"></label>
    </section>
    <section class="queue" id="queue" aria-live="polite"></section>
    <section>
      <div class="shelf-head"><h2>Фонд <small id="fundCount" class="num"></small></h2><div class="meter num" id="meter"></div></div>
      <div id="fundSlot"></div>
    </section>
    <div class="hint">${ic('info')}<div><b>Открытый сайт.</b> На aynobook.vercel.app книги читаются без входа. Новые и изменённые книги появляются там после синхронизации с GitHub. Скрытые книги на открытый сайт не попадают.</div></div>
    <div class="hint">${ic('info')}<div><b>Как пригласить читателей.</b> Нажмите «Поделиться» в Claude и добавьте людей. Чтобы закладки и прогресс читателя сохранялись на сервере, ему нужен доступ с правом изменений. С доступом только на просмотр книги читаются, а закладки остаются в браузере читателя. Добавлять и удалять книги можете только вы.</div></div>`;
  const drop = $('#drop');
  $('#fileIn').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); };
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...(e.dataTransfer?.files || [])]); };
  $('#view').onclick = adminClick;
  $('#view').oninput = adminInput;
  Q.forEach(renderQItem);
  updateAdmin();
  refreshMeter();
}
async function refreshMeter() {
  const el = $('#meter'); if (!el) return;
  if (!S.assets) { el.textContent = ''; return; }
  try { const { usage } = await S.assets.list(); if (usage?.maxBytes) el.innerHTML = `<span>Файлы книг: ${fmtBytes(usage.bytes)} из ${fmtBytes(usage.maxBytes)}</span><div class="bar"><i style="--p:${Math.min(100, usage.bytes / usage.maxBytes * 100).toFixed(1)}%"></i></div>`; } catch { el.textContent = ''; }
}
function updateAdmin() {
  const slot = $('#fundSlot'); if (!slot || S.view !== 'admin') return;
  if (slot.querySelector('.confirm')) return; // don't wipe an open confirmation
  const list = [...S.books.values()].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  $('#fundCount').textContent = list.length ? `${list.length} ${plural(list.length, 'книга', 'книги', 'книг')}` : '';
  if (!list.length) { slot.innerHTML = `<div class="empty" style="padding:36px 20px"><p>Пока ни одной книги. Добавленные книги появятся здесь.</p></div>`; return; }
  slot.innerHTML = `<div class="tbl-wrap"><table class="books"><thead><tr><th>Книга</th><th>Формат</th><th>Объём</th><th>Добавлена</th><th><span class="sr">Действия</span></th></tr></thead><tbody>
    ${list.map(b => `<tr data-id="${b.id}">
      <td><div class="bk"><div class="book">${coverHTML(b)}</div><div><b>${esc(b.title)}</b><small>${esc(b.author || 'Автор не указан')}</small>${b.hidden ? ' <span class="badge muted">Скрыта</span>' : ''}</div></div></td>
      <td>${FORMAT[b.format] || '—'}</td>
      <td class="num">≈ ${fmtN(Math.max(1, (b.chars || 0) / CPP))} стр. · ${((b.chars || 0) / AL).toFixed(1).replace('.', ',')} а. л.</td>
      <td>${esc(fmtShort(b.addedAt))}</td>
      <td><div class="acts">
        <button class="icon-btn" data-act="edit" aria-label="Изменить" title="Изменить">${ic('edit')}</button>
        <button class="icon-btn" data-act="hide" aria-label="${b.hidden ? 'Показать читателям' : 'Скрыть от читателей'}" title="${b.hidden ? 'Показать читателям' : 'Скрыть от читателей'}">${ic(b.hidden ? 'eyeoff' : 'eye')}</button>
        <button class="icon-btn" data-act="del" aria-label="Удалить" title="Удалить">${ic('trash')}</button>
      </div></td></tr>`).join('')}
    </tbody></table></div>`;
}
async function adminClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  const row = t.closest('tr[data-id]');
  const qi = t.closest('[data-q]') ? Q.find(x => x.id === t.closest('[data-q]').dataset.q) : null;
  if (qi) {
    if (act === 'publish') publishItem(qi);
    else if (act === 'drop') { Q.splice(Q.indexOf(qi), 1); if (qi.coverURL) URL.revokeObjectURL(qi.coverURL); t.closest('[data-q]').remove(); }
    else if (act === 'open' && qi.bookId) openReader(qi.bookId, {});
    else if (act === 'qnocover') { if (qi.coverURL) URL.revokeObjectURL(qi.coverURL); qi.cover = null; qi.coverURL = null; renderQItem(qi); }
    else if (act === 'qcover') pickImage(async f => { try { const b = await shrinkImage(f, 480, .85); if (qi.coverURL) URL.revokeObjectURL(qi.coverURL); qi.cover = b; qi.coverURL = URL.createObjectURL(b); renderQItem(qi); } catch { toast('Не удалось открыть картинку'); } });
    return;
  }
  if (!row) { if (act === 'publishAll') Q.filter(x => x.status === 'ready').forEach(publishItem); return; }
  const id = row.dataset.id; const b = S.books.get(id); if (!b) return;
  if (act === 'edit') openEditSheet(b);
  else if (act === 'hide') { try { await S.db.doc('books/' + id).update({ hidden: !b.hidden, updatedAt: Date.now() }); toast(b.hidden ? 'Книга снова видна читателям' : 'Книга скрыта от читателей'); } catch (err) { toast(errText(err)); } }
  else if (act === 'del') {
    const cell = t.closest('td');
    cell.innerHTML = `<div class="confirm"><span>Удалить навсегда?</span><button class="btn sm danger solid" data-act="delyes">Удалить</button><button class="btn sm ghost" data-act="delno">Отмена</button></div>`;
  }
  else if (act === 'delno') { t.closest('.confirm').remove(); updateAdmin(); }
  else if (act === 'delyes') { t.disabled = true; await deleteBook(b); t.closest('.confirm')?.remove(); updateAdmin(); }
}
function adminInput(e) {
  const f = e.target.closest('[data-field]'); if (!f) return;
  const qi = Q.find(x => x.id === f.closest('[data-q]')?.dataset.q); if (!qi) return;
  qi.meta[f.dataset.field] = f.value;
  if (f.dataset.field === 'title' || f.dataset.field === 'author') { const bk = f.closest('[data-q]').querySelector('.book'); if (bk && !qi.coverURL) bk.innerHTML = coverHTML({ title: qi.meta.title, author: qi.meta.author }); }
}
function pickImage(cb) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files?.[0]; if (f) cb(f); };
  inp.click();
}
const errText = e => (e && (e.message || e.code)) ? (e.message || e.code) : 'Что-то пошло не так. Попробуйте ещё раз.';

async function handleFiles(files) {
  files = files.filter(f => f && f.size);
  if (!files.length) return;
  for (const f of files) { const it = { id: rid(), file: f, status: 'parsing', note: 'Читаю файл…', meta: {} }; Q.unshift(it); renderQItem(it); }
  for (const it of Q.filter(x => x.status === 'parsing' && !x.started)) {
    it.started = true;
    try {
      const p = await Parse.file(it.file, note => { it.note = note; paintQNote(it); });
      it.parsed = p;
      it.meta = { title: p.title || '', author: p.author || '', genre: p.genre || '', description: p.description || '' };
      if (p.cover) { it.cover = p.cover; it.coverURL = URL.createObjectURL(p.cover); }
      it.status = 'ready';
    } catch (e) { console.warn(e); it.status = 'error'; it.error = errText(e); }
    renderQItem(it);
  }
}
function paintQNote(it) { const el = document.querySelector(`[data-q="${it.id}"] .qnote`); if (el) el.textContent = it.note; }
function renderQItem(it) {
  const host = $('#queue'); if (!host) return;
  let el = host.querySelector(`[data-q="${it.id}"]`);
  if (!el) { el = document.createElement('div'); el.className = 'qitem'; el.dataset.q = it.id; const i = Q.indexOf(it); const next = Q.slice(i + 1).map(x => host.querySelector(`[data-q="${x.id}"]`)).find(Boolean); host.insertBefore(el, next || null); }
  const p = it.parsed; const m = it.meta;
  const cov = coverHTML({ title: m.title || it.file.name, author: m.author, _src: it.coverURL });
  const size = fmtBytes(it.file.size);
  let body = '';
  if (it.status === 'parsing') body = `<div class="qform"><b style="overflow-wrap:anywhere">${esc(it.file.name)}</b><div class="qstat"><span class="qnote">${esc(it.note || '')}</span><span>${size}</span></div><div class="bar ind"><i></i></div></div>`;
  else if (it.status === 'error') body = `<div class="qform"><b style="overflow-wrap:anywhere">${esc(it.file.name)}</b><p class="qerr" style="margin:0">${esc(it.error)}</p><div class="qactions"><button class="btn sm ghost" data-act="drop">Убрать</button></div></div>`;
  else {
    const pages = Math.max(1, Math.round(p.chars / CPP));
    const busy = it.status === 'uploading', done = it.status === 'done';
    const dis = busy || done ? ' disabled' : '';
    body = `<div class="qform">
      <div class="qrow"><label class="field"><span>Название</span><input class="input" data-field="title" value="${esc(m.title)}"${dis}></label><label class="field"><span>Автор</span><input class="input" data-field="author" value="${esc(m.author)}"${dis}></label></div>
      <div class="qrow"><label class="field"><span>Жанр</span><input class="input" data-field="genre" value="${esc(m.genre)}" placeholder="Например, роман"${dis}></label><div class="field"><span>Файл</span><div class="qstat" style="min-height:42px"><b>${FORMAT[p.format] || ''}</b><span>${size}</span><span>${p.chapters.length} ${plural(p.chapters.length, 'глава', 'главы', 'глав')}</span><span>≈ ${fmtN(pages)} стр.</span></div></div></div>
      <label class="field"><span>Аннотация</span><textarea class="input" data-field="description" rows="3" placeholder="Пара предложений о книге"${dis}>${esc(m.description)}</textarea></label>
      ${p.warnings?.length ? `<p class="qwarn" style="margin:0">${esc(p.warnings.join(' '))}</p>` : ''}
      ${it.error ? `<p class="qerr" style="margin:0">${esc(it.error)}</p>` : ''}
      ${busy ? `<div class="bar"><i style="--p:${it.progress || 5}%"></i></div>` : ''}
      <div class="qactions">${done
        ? `<span class="badge">${ic('check')} На полке</span><button class="btn sm ghost" data-act="open">Открыть</button><button class="btn sm ghost" data-act="drop">Скрыть из списка</button>`
        : `<button class="btn primary" data-act="publish"${busy ? ' disabled' : ''}>${busy ? 'Загружаю…' : 'Поставить на полку'}</button><button class="btn sm ghost" data-act="qcover"${dis}>${ic('image')} Обложка</button>${it.cover ? `<button class="btn sm ghost" data-act="qnocover"${dis}>${ic('close')} Убрать обложку</button>` : ''}<button class="btn sm ghost" data-act="drop"${dis}>Отменить</button>`}</div>
    </div>`;
  }
  el.innerHTML = `<div class="book">${cov}</div>${body}`;
}
function chunkStr(s, n) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; }
async function publishItem(it) {
  if (it.status !== 'ready') return;
  it.status = 'uploading'; it.progress = 6; it.error = ''; renderQItem(it);
  const setP = v => { it.progress = v; const bar = document.querySelector(`[data-q="${it.id}"] .bar i`); if (bar) bar.style.setProperty('--p', v + '%'); };
  try {
    const p = it.parsed, m = it.meta;
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const json = JSON.stringify({ v: 1, lang: p.lang || 'ru', chapters: p.chapters.map(c => ({ t: c.t, l: c.l || 1, b: c.b, ...(c.part ? { part: true } : {}) })) });
    let content = null;
    if (S.assets) {
      try { const r = await S.assets.upload(new Blob([json], { type: 'application/json' }), { type: 'application/json' }); content = { kind: 'asset', id: r.id }; }
      catch (e) { console.warn('asset upload', e); if (e?.code === 'rate_limited') throw new Error('Слишком много загрузок подряд. Подождите минуту и нажмите ещё раз.'); }
    }
    setP(55);
    if (!content) {
      const parts = chunkStr(json, 60000);
      if (parts.length > 600) throw new Error('Книга слишком большая: уберите иллюстрации или разделите файл на тома.');
      for (let i = 0; i < parts.length; i++) { await S.db.doc(`books/${id}/parts/${i}`).set({ i, d: parts[i] }); setP(55 + Math.round(35 * (i + 1) / parts.length)); }
      content = { kind: 'db', parts: parts.length };
    }
    let cover = null, coverData = null;
    if (it.cover) {
      if (S.assets) { try { cover = (await S.assets.upload(it.cover, { type: 'image/jpeg' })).id; } catch (e) { console.warn('cover', e); } }
      if (!cover) { try { coverData = await blobToDataURL(await shrinkImage(it.cover, 240, .72)); } catch {} }
    }
    setP(94);
    const doc = {
      title: (m.title || '').trim().slice(0, 300) || it.file.name.replace(/\.[^.]+$/, ''),
      author: (m.author || '').trim().slice(0, 200), genre: (m.genre || '').trim().slice(0, 80),
      description: (m.description || '').trim().slice(0, 4000), lang: p.lang || 'ru', format: p.format,
      fileName: it.file.name.slice(0, 200), fileSize: it.file.size, chars: p.chars, words: p.words || 0,
      chapters: p.chapters.slice(0, 1500).map(c => ({ t: String(c.t).slice(0, 140), l: c.l || 1, n: c.n })),
      content, cover, coverData, hidden: false, addedAt: new Date().toISOString(), updatedAt: Date.now()
    };
    await S.db.doc('books/' + id).set(doc);
    it.status = 'done'; it.bookId = id;
    toast(`«${doc.title}» стоит на полке`);
    refreshMeter();
  } catch (e) { console.warn(e); it.status = 'ready'; it.error = errText(e); }
  renderQItem(it);
}
async function deleteBook(b) {
  try {
    await S.db.doc('books/' + b.id).delete();
    if (b.content?.kind === 'db') for (let i = 0; i < b.content.parts; i++) { try { await S.db.doc(`books/${b.id}/parts/${i}`).delete(); } catch {} }
    if (S.assets) {
      if (safeId(b.content?.id)) { try { await S.assets.delete(b.content.id); } catch {} }
      if (safeId(b.cover)) { try { await S.assets.delete(b.cover); } catch {} }
    }
    Content.drop(b.id);
    toast(`«${b.title}» снята с полки`);
    refreshMeter();
  } catch (e) { toast(errText(e)); }
}
function openEditSheet(b) {
  let newCover = null;
  openSheet({
    head: 'Карточка книги', label: 'Изменить книгу',
    body: `<div class="detail-top"><div class="book" id="edCov">${coverHTML(b)}</div><div style="display:grid;gap:8px;justify-items:start"><button class="btn sm" id="edPick">${ic('image')} Сменить обложку</button><button class="btn sm ghost" id="edNoCov"${b.cover || b.coverData ? '' : ' hidden'}>${ic('close')} Убрать обложку</button></div></div>
      <label class="field"><span>Название</span><input class="input" id="edT" value="${esc(b.title)}"></label>
      <label class="field"><span>Автор</span><input class="input" id="edA" value="${esc(b.author || '')}"></label>
      <label class="field"><span>Жанр</span><input class="input" id="edG" value="${esc(b.genre || '')}"></label>
      <label class="field"><span>Аннотация</span><textarea class="input" id="edD" rows="6">${esc(b.description || '')}</textarea></label>`,
    foot: `<button class="btn ghost" data-close2>Отмена</button><button class="btn primary" id="edSave">Сохранить</button>`,
    bind(sh) {
      let clear = false;
      $('[data-close2]', sh).onclick = () => closeSheet();
      $('#edPick', sh).onclick = () => pickImage(async f => { try { newCover = await shrinkImage(f, 480, .85); clear = false; $('#edCov', sh).innerHTML = coverHTML({ _src: URL.createObjectURL(newCover) }); $('#edNoCov', sh).hidden = false; } catch { toast('Не удалось открыть картинку'); } });
      $('#edNoCov', sh) && ($('#edNoCov', sh).onclick = () => { clear = true; newCover = null; $('#edCov', sh).innerHTML = coverHTML({ title: $('#edT', sh).value, author: $('#edA', sh).value }); $('#edNoCov', sh).hidden = true; toast('Обложка будет убрана после сохранения', 2200); });
      $('#edSave', sh).onclick = async () => {
        const btn = $('#edSave', sh); btn.disabled = true;
        const patch = { title: $('#edT', sh).value.trim().slice(0, 300) || b.title, author: $('#edA', sh).value.trim().slice(0, 200), genre: $('#edG', sh).value.trim().slice(0, 80), description: $('#edD', sh).value.trim().slice(0, 4000), updatedAt: Date.now() };
        const old = b.cover;
        try {
          if (newCover) {
            let id = null;
            if (S.assets) { try { id = (await S.assets.upload(newCover, { type: 'image/jpeg' })).id; } catch {} }
            if (id) { patch.cover = id; patch.coverData = null; } else { patch.cover = null; patch.coverData = await blobToDataURL(await shrinkImage(newCover, 240, .72)); }
          } else if (clear) { patch.cover = null; patch.coverData = null; }
          await S.db.doc('books/' + b.id).update(patch);
          if ((newCover || clear) && safeId(old) && S.assets) { try { await S.assets.delete(old); } catch {} }
          closeSheet(); toast('Карточка книги сохранена');
        } catch (e) { btn.disabled = false; toast(errText(e)); }
      };
    }
  });
}
