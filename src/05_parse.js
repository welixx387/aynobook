
/* ================= book parsers ================= */
const Parse = (() => {
  const WS = /[\t\n\r\f ]+/g;
  const clean = h => h.replace(/ {2,}/g, ' ').replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
  const T = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
  function resolvePath(dir, rel) {
    if (rel.startsWith('/')) { dir = ''; rel = rel.slice(1); }
    const out = [];
    for (const p of (dir + rel).split('/')) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    return out.join('/');
  }
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
  const mimeByExt = p => MIME[(p.split('.').pop() || '').toLowerCase()] || 'image/jpeg';

  /* ---------- text decoding ---------- */
  function sniffEnc(u8) {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 1024));
    const m = /encoding\s*=\s*["']([\w\-:]+)["']/i.exec(head) || /charset\s*=\s*["']?([\w\-:]+)/i.exec(head);
    return m ? m[1].toLowerCase() : null;
  }
  function decodeBytes(u8, hint) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    if (hint && !/^utf-?8$/.test(hint)) { try { return new TextDecoder(hint).decode(u8); } catch {} }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch {}
    const a = new TextDecoder('windows-1251').decode(u8), b = new TextDecoder('koi8-r').decode(u8);
    const score = s => { let lo = 0, up = 0; const n = Math.min(s.length, 30000); for (let i = 0; i < n; i++) { const c = s.charCodeAt(i); if (c >= 0x430 && c <= 0x44F) lo++; else if (c >= 0x410 && c <= 0x42F) up++; } return lo - up * 2; };
    return score(b) > score(a) ? b : a;
  }
  function guessLang(s) {
    const x = s.slice(0, 8000); let cy = 0, la = 0;
    for (let i = 0; i < x.length; i++) { const c = x.charCodeAt(i); if (c >= 0x400 && c <= 0x4FF) cy++; else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) la++; }
    return cy >= la ? 'ru' : 'en';
  }
  function xmlParse(str, type = 'application/xml') {
    const d = new DOMParser().parseFromString(str, type);
    return d.getElementsByTagName('parsererror').length ? null : d;
  }
  let entBox = null;
  function fixEntities(str) {
    entBox ||= document.createElement('textarea');
    return str.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => {
        if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(n)) return m;
        entBox.innerHTML = m; const v = entBox.value;
        return v === m ? '' : '&#' + v.codePointAt(0) + ';';
      });
  }
  function xhtml(str) {
    return xmlParse(str, 'application/xhtml+xml') || xmlParse(fixEntities(str), 'application/xhtml+xml') || new DOMParser().parseFromString(str, 'text/html');
  }

  /* ---------- images ---------- */
  async function prepImage(data, mime, ctx) {
    mime = (mime || '').toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') return null;
    let url;
    try {
      url = typeof data === 'string' ? `data:${mime};base64,${data.replace(/\s+/g, '')}` : await blobToDataURL(new Blob([data], { type: mime }));
      if (url.length > 420000 || !/^image\/(jpeg|png|gif|webp)$/.test(mime)) url = await blobToDataURL(await shrinkImage(url, 1100, .8));
    } catch { return null; }
    if (ctx.imgBytes + url.length > 12e6) { ctx.imgSkipped++; return null; }
    ctx.imgBytes += url.length;
    return url;
  }

  /* ---------- HTML → blocks ---------- */
  const LEAF = new Set(['p', 'li', 'dt', 'dd', 'caption', 'figcaption', 'address', 'summary']);
  const CONT = new Set(['div', 'section', 'article', 'main', 'body', 'ul', 'ol', 'dl', 'figure', 'aside', 'header', 'footer', 'nav', 'center', 'hgroup', 'details', 'fieldset', 'html', 'blockquote']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'canvas', 'map', 'template', 'math']);
  const INL = { em: 'em', i: 'em', cite: 'em', dfn: 'em', var: 'em', strong: 'strong', b: 'strong', u: 'u', ins: 'u', s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup', small: 'small', code: 'code', kbd: 'code', tt: 'code', samp: 'code' };
  const isBlockTag = t => LEAF.has(t) || CONT.has(t) || /^h[1-6]$/.test(t) || t === 'table' || t === 'hr' || t === 'pre';
  const lname = el => (el.localName || '').toLowerCase();

  function HtmlConv(ctx) {
    const out = ctx.out; let buf = '', btxt = '';
    function hasBlock(el) { for (const c of el.children) { if (isBlockTag(lname(c)) || (c.children.length && hasBlock(c))) return true; } return false; }
    function anchor(el) {
      const id = el.getAttribute && (el.getAttribute('id') || (lname(el) === 'a' && el.getAttribute('name')));
      if (id && !(id in ctx.anchors)) ctx.anchors[id] = out.length;
    }
    function anchorsIn(el) { anchor(el); for (const d of el.querySelectorAll('[id],a[name]')) anchor(d); }
    const refOf = el => el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('href');
    const imgTag = el => { const s = ctx.img(el, refOf(el)); return s ? `<img src="${escA(s)}" alt="">` : ''; };
    function flush(cls) {
      if (btxt.replace(/\s+/g, '').length || buf.includes('<img ')) out.push(`<p${cls ? ` class="${cls}"` : ''}>${clean(buf)}</p>`);
      buf = ''; btxt = '';
    }
    function inl(node) {
      let html = '', text = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { const t = c.nodeValue.replace(WS, ' '); html += escT(t); text += t; continue; }
        if (c.nodeType !== 1) continue;
        const tag = lname(c);
        if (SKIP.has(tag)) continue;
        if (tag === 'br') { html += '<br>'; continue; }
        if (tag === 'img' || tag === 'image') { html += imgTag(c); continue; }
        if (tag === 'svg') { const im = c.getElementsByTagNameNS('*', 'image')[0]; if (im) html += imgTag(im); continue; }
        const r = inl(c); text += r.text;
        const et = `${c.getAttribute('epub:type') || ''} ${c.getAttribute('role') || ''} ${c.getAttribute('class') || ''}`;
        if (tag === 'a' && /noteref|footnote|endnote|note/i.test(et) && r.text.trim().length <= 8) { html += `<sup class="nr">${escT(r.text.trim())}</sup>`; continue; }
        const m = INL[tag];
        html += m && r.text.trim() ? `<${m}>${r.html}</${m}>` : r.html;
      }
      return { html, text };
    }
    function table(t) {
      const rows = [...t.getElementsByTagNameNS('*', 'tr')].slice(0, 400); if (!rows.length) return null;
      let h = '<div class="tbl"><table>';
      for (const r of rows) {
        h += '<tr>';
        for (const c of r.children) {
          const tg = lname(c); if (tg !== 'td' && tg !== 'th') continue;
          const cs = +c.getAttribute('colspan') || 0, rs = +c.getAttribute('rowspan') || 0;
          h += `<${tg}${cs > 1 ? ` colspan="${Math.min(cs, 20)}"` : ''}${rs > 1 ? ` rowspan="${Math.min(rs, 60)}"` : ''}>${clean(inl(c).html)}</${tg}>`;
        }
        h += '</tr>';
      }
      return h + '</table></div>';
    }
    function walk(el, cls) {
      for (const n of [...el.childNodes]) {
        if (n.nodeType === 3) { const t = n.nodeValue; if (!t) continue; const nt = t.replace(WS, ' '); buf += escT(nt); btxt += nt; continue; }
        if (n.nodeType !== 1) continue;
        const tag = lname(n);
        if (SKIP.has(tag)) continue;
        anchor(n);
        if (tag === 'br') { if (/<br>\s*$/.test(buf)) { buf = buf.replace(/<br>\s*$/, ''); flush(cls); } else if (btxt.trim()) buf += '<br>'; continue; }
        if (tag === 'hr') { flush(cls); out.push('<hr>'); continue; }
        if (tag === 'img' || tag === 'image' || tag === 'svg') {
          const im = tag === 'svg' ? n.getElementsByTagNameNS('*', 'image')[0] : n;
          const h = im ? imgTag(im) : '';
          if (h) { if (btxt.trim()) buf += h; else { flush(cls); out.push(`<figure>${h}</figure>`); } }
          continue;
        }
        if (tag === 'table') { flush(cls); const t = table(n); if (t) out.push(t); continue; }
        if (/^h[1-6]$/.test(tag)) {
          flush(cls); anchorsIn(n); const r = inl(n);
          if (r.text.trim()) out.push(`<${tag}>${clean(r.html)}</${tag}>`);
          else { const imgs = r.html.match(/<img [^>]*>/g); if (imgs) out.push(`<figure>${imgs.join('')}</figure>`); }
          continue;
        }
        if (tag === 'pre') { flush(cls); anchorsIn(n); const t = n.textContent.replace(/^\n/, '').replace(/\s+$/, ''); if (t.trim()) out.push(`<pre>${escT(t)}</pre>`); continue; }
        if (tag === 'ul' || tag === 'ol') {
          flush(cls); let k = +(n.getAttribute('start') || 1) || 1;
          for (const li of n.children) {
            if (lname(li) !== 'li') { walk(li, cls); flush(cls); continue; }
            const lead = tag === 'ol' ? `<p class="li ol"><span class="n">${k}.</span> ` : '<p class="li">';
            if (hasBlock(li)) {
              anchor(li); const before = out.length; walk(li, cls); flush(cls);
              if (out.length > before && out[before].startsWith('<p')) out[before] = out[before].replace(/^<p(?: class="[^"]*")?>/, lead);
            } else {
              anchorsIn(li); const r = inl(li);
              if (r.text.trim() || r.html.includes('<img ')) out.push(`${lead}${clean(r.html)}</p>`);
            }
            k++;
          }
          continue;
        }
        if (tag === 'blockquote') { flush(cls); walk(n, 'q'); flush('q'); continue; }
        if (LEAF.has(tag)) {
          flush(cls);
          if (n.children.length && hasBlock(n)) { walk(n, cls); flush(cls); continue; }
          anchorsIn(n); const r = inl(n);
          if (r.text.trim() || r.html.includes('<img ')) {
            const c = tag === 'li' ? 'li' : (tag === 'figcaption' || tag === 'caption') ? 'sub' : cls;
            out.push(`<p${c ? ` class="${c}"` : ''}>${clean(r.html)}</p>`);
          }
          continue;
        }
        if (CONT.has(tag)) { flush(cls); walk(n, cls); flush(cls); continue; }
        if (n.children.length && hasBlock(n)) { flush(cls); walk(n, cls); flush(cls); continue; }
        for (const d of n.querySelectorAll('[id],a[name]')) anchor(d);
        const r = inl(n); const m = INL[tag];
        buf += m && r.text.trim() ? `<${m}>${r.html}</${m}>` : r.html; btxt += r.text;
      }
    }
    return { walk, flush };
  }
  function normHeadings(chapters) {
    let min = 7;
    for (const c of chapters) for (const b of c.b) { const m = /^<h([1-6])>/.exec(b); if (m) min = Math.min(min, +m[1]); }
    if (min === 7) return;
    for (const c of chapters) c.b = c.b.map(b => b.replace(/^<h([1-6])>([\s\S]*)<\/h\1>$/, (_, l, inner) => { const n = Math.min(5, Math.max(2, +l - min + 2)); return `<h${n}>${inner}</h${n}>`; }));
  }
  const firstHeading = blocks => { const h = blocks.find(b => /^<h[1-6]>/.test(b)); return h ? plainOf(h).replace(/\s+/g, ' ').trim().slice(0, 140) : ''; };

  /* ---------- EPUB ---------- */
  async function parseEpub(buf, report, zipIn) {
    const JSZip = await needJSZip();
    const zip = zipIn || await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files); const lower = new Map(names.map(n => [n.toLowerCase(), n]));
    const getFile = p => p ? (zip.file(p) || zip.file(lower.get(p.toLowerCase()) || '\u0000') || zip.file(encodeURI(p)) || null) : null;
    const readText = async p => { const f = getFile(p); if (!f) return null; const u8 = await f.async('uint8array'); return decodeBytes(u8, sniffEnc(u8)); };
    const cont = await readText('META-INF/container.xml');
    let opfPath = cont && xmlParse(cont)?.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
    if (!opfPath || !getFile(opfPath)) opfPath = names.find(n => n.toLowerCase().endsWith('.opf'));
    if (!opfPath) throw new Error('Не найдено описание книги внутри EPUB (content.opf). Возможно, файл повреждён.');
    const opfDir = dirOf(opfPath);
    const opfStr = await readText(opfPath);
    const opf = xmlParse(opfStr) || xmlParse(fixEntities(opfStr));
    if (!opf) throw new Error('Не удалось прочитать описание EPUB.');
    const md = name => [...opf.getElementsByTagNameNS('*', name)];
    const title = T(md('title')[0]);
    const authors = [...new Set(md('creator').filter(c => { const r = c.getAttribute('opf:role') || c.getAttribute('role'); return !r || r === 'aut'; }).map(T).filter(Boolean))].slice(0, 3);
    const descRaw = T(md('description')[0]);
    const description = descRaw ? T(new DOMParser().parseFromString(descRaw, 'text/html').body) : '';
    const lang = (T(md('language')[0]) || '').slice(0, 2).toLowerCase();
    const subject = T(md('subject')[0]);
    const manifest = new Map(), byPath = new Map();
    for (const it of md('item')) {
      const href = it.getAttribute('href'); if (!href) continue;
      const o = { id: it.getAttribute('id'), path: resolvePath(opfDir, safeDecode(href.split('#')[0])), type: (it.getAttribute('media-type') || '').toLowerCase(), props: it.getAttribute('properties') || '' };
      manifest.set(o.id, o); byPath.set(o.path, o);
    }
    const spineEl = md('spine')[0];
    const spine = md('itemref').map(r => manifest.get(r.getAttribute('idref'))).filter(o => o && (/html|xml/.test(o.type) || /\.(x?html?|xml)$/i.test(o.path)) && !/ncx/.test(o.type));
    if (!spine.length) throw new Error('В EPUB нет текста для чтения.');
    let coverItem = [...manifest.values()].find(o => /cover-image/.test(o.props));
    if (!coverItem) { const meta = md('meta').find(m => m.getAttribute('name') === 'cover'); if (meta) coverItem = manifest.get(meta.getAttribute('content')) || [...manifest.values()].find(o => o.path.endsWith(meta.getAttribute('content') || '\u0000')); }
    if (!coverItem) coverItem = [...manifest.values()].find(o => o.type.startsWith('image/') && /cover|obloj|oblozh/i.test(o.id + ' ' + o.path));
    if (coverItem && !coverItem.type.startsWith('image/')) coverItem = null;

    let toc = [];
    const navItem = [...manifest.values()].find(o => /(^|\s)nav(\s|$)/.test(o.props));
    if (navItem) { const s = await readText(navItem.path); if (s) toc = parseNav(xhtml(s), dirOf(navItem.path)); }
    if (!toc.length) {
      const ncxId = spineEl?.getAttribute('toc');
      const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find(o => o.type === 'application/x-dtbncx+xml' || o.path.toLowerCase().endsWith('.ncx'));
      if (ncx) { const s = await readText(ncx.path); const d = s && (xmlParse(s) || xmlParse(fixEntities(s))); if (d) toc = parseNcx(d, dirOf(ncx.path)); }
    }
    const tocBy = new Map();
    toc.forEach((e, i) => { e.order = i; if (!tocBy.has(e.path)) tocBy.set(e.path, []); tocBy.get(e.path).push(e); });
    const spinePaths = new Set(spine.map(s => s.path));
    const tocUsable = toc.some(e => spinePaths.has(e.path));

    const ctx = { imgBytes: 0, imgSkipped: 0 };
    const chapters = [];
    for (let si = 0; si < spine.length; si++) {
      report?.(`Разбираю главы: ${si + 1} из ${spine.length}`);
      const item = spine[si];
      const s = await readText(item.path); if (!s) continue;
      const doc = xhtml(s);
      const body = doc.getElementsByTagNameNS('*', 'body')[0] || doc.body || doc.documentElement;
      if (!body) continue;
      const dir = dirOf(item.path);
      const imgMap = new Map();
      const refs = [...body.getElementsByTagNameNS('*', 'img'), ...body.getElementsByTagNameNS('*', 'image')];
      for (const el of refs) {
        const ref = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('href');
        if (!ref || /^(https?:|data:)/i.test(ref)) continue;
        const p = resolvePath(dir, safeDecode(ref.split('#')[0]));
        if (imgMap.has(p)) continue;
        const f = getFile(p);
        imgMap.set(p, f ? await prepImage(await f.async('uint8array'), byPath.get(p)?.type || mimeByExt(p), ctx) : null);
      }
      const out = [], anchors = {};
      const conv = HtmlConv({ out, anchors, img: (el, ref) => { if (!ref || /^(https?:|data:)/i.test(ref)) return null; return imgMap.get(resolvePath(dir, safeDecode(ref.split('#')[0]))) || null; } });
      conv.walk(body, ''); conv.flush('');
      if (!out.length) continue;
      const entries = tocUsable ? (tocBy.get(item.path) || []) : [];
      if (!entries.length) {
        if (chapters.length && tocUsable) chapters[chapters.length - 1].b.push(...out);
        else chapters.push({ t: firstHeading(out) || (chapters.length ? `Глава ${chapters.length + 1}` : 'Начало'), l: 1, b: out });
        continue;
      }
      const cuts = entries.map(e => ({ ...e, idx: e.frag ? (anchors[e.frag] ?? 0) : 0 })).sort((a, b) => a.idx - b.idx || a.order - b.order);
      if (cuts[0].idx > 0) {
        const pre = out.slice(0, cuts[0].idx);
        if (chapters.length) chapters[chapters.length - 1].b.push(...pre); else chapters.push({ t: firstHeading(pre) || 'Начало', l: 1, b: pre });
      }
      for (let k = 0; k < cuts.length; k++) {
        const a = cuts[k].idx, b = k + 1 < cuts.length ? cuts[k + 1].idx : out.length;
        if (b <= a) continue;
        chapters.push({ t: cuts[k].title, l: cuts[k].level, b: out.slice(a, b) });
      }
    }
    normHeadings(chapters);
    let cover = null;
    if (coverItem) { const f = getFile(coverItem.path); if (f) { try { cover = await shrinkImage(new Blob([await f.async('uint8array')], { type: coverItem.type }), 480, .85); } catch {} } }
    if (!cover && chapters[0]) { const m = /<img src="(data:image\/[^"]+)"/.exec(chapters[0].b.slice(0, 4).join('')); if (m) { try { cover = await shrinkImage(m[1], 480, .85); } catch {} } }
    return { title, author: authors.join(', '), description, lang: lang || 'ru', genre: subject, format: 'epub', chapters, cover, warnings: ctx.imgSkipped ? [`Пропущено иллюстраций: ${ctx.imgSkipped} — книга получилась бы слишком тяжёлой.`] : [] };
  }
  function parseNav(doc, dir) {
    const navs = [...doc.getElementsByTagNameNS('*', 'nav')];
    const nav = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('role') || '')) || navs[0];
    if (!nav) return [];
    const out = [];
    const walkOl = (ol, lvl) => {
      for (const li of ol.children) {
        if (lname(li) !== 'li') continue;
        const a = [...li.children].find(c => /^(a|span)$/.test(lname(c)));
        if (a) {
          const href = a.getAttribute('href'); const t = T(a);
          if (href && t && !href.startsWith('#')) { const [p, f] = href.split('#'); out.push({ title: t, path: resolvePath(dir, safeDecode(p)), frag: f ? safeDecode(f) : null, level: Math.min(lvl, 3) }); }
        }
        const sub = [...li.children].find(c => /^(ol|ul)$/.test(lname(c)));
        if (sub) walkOl(sub, lvl + 1);
      }
    };
    const top = nav.getElementsByTagNameNS('*', 'ol')[0] || nav.getElementsByTagNameNS('*', 'ul')[0];
    if (top) walkOl(top, 1);
    return out;
  }
  function parseNcx(doc, dir) {
    const out = [];
    const map = doc.getElementsByTagNameNS('*', 'navMap')[0]; if (!map) return out;
    const walkNp = (el, lvl) => {
      for (const np of el.children) {
        if (np.localName !== 'navPoint') continue;
        const label = np.getElementsByTagNameNS('*', 'text')[0];
        const content = [...np.children].find(c => c.localName === 'content');
        const src = content?.getAttribute('src'); const t = T(label);
        if (src && t) { const [p, f] = src.split('#'); out.push({ title: t, path: resolvePath(dir, safeDecode(p)), frag: f ? safeDecode(f) : null, level: Math.min(lvl, 3) }); }
        walkNp(np, lvl + 1);
      }
    };
    walkNp(map, 1);
    return out;
  }

  /* ---------- FB2 ---------- */
  const GENRES = { sf: 'Фантастика', sf_fantasy: 'Фэнтези', fantasy: 'Фэнтези', sf_history: 'Альтернативная история', sf_action: 'Боевая фантастика', sf_social: 'Социальная фантастика', sf_space: 'Космическая фантастика', sf_humor: 'Юмористическая фантастика', sf_horror: 'Ужасы', det_classic: 'Классический детектив', detective: 'Детектив', det_police: 'Полицейский детектив', det_irony: 'Иронический детектив', det_history: 'Исторический детектив', thriller: 'Триллер', prose_classic: 'Классическая проза', prose_contemporary: 'Современная проза', prose_rus_classic: 'Русская классика', prose_su_classics: 'Советская классика', prose_history: 'Историческая проза', prose_military: 'Военная проза', love_contemporary: 'Любовный роман', love: 'Любовный роман', love_history: 'Исторический любовный роман', adventure: 'Приключения', adv_history: 'Исторические приключения', adv_animal: 'Природа и животные', child_tale: 'Сказки', children: 'Детская литература', child_prose: 'Детская проза', poetry: 'Поэзия', dramaturgy: 'Драматургия', sci_history: 'История', sci_psychology: 'Психология', sci_philosophy: 'Философия', science: 'Научная литература', sci_popular: 'Научно-популярное', nonf_biography: 'Биографии и мемуары', nonf_publicism: 'Публицистика', nonfiction: 'Документальное', humor: 'Юмор', humor_prose: 'Юмористическая проза', religion: 'Религия', reference: 'Справочники', comp_programming: 'Программирование', computers: 'Компьютеры', business: 'Бизнес', antique: 'Старинная литература', foreign_prose: 'Зарубежная проза', foreign_classic: 'Зарубежная классика', horror: 'Ужасы', home: 'Дом и семья', cooking: 'Кулинария' };
  const fbName = el => (el.localName || '').toLowerCase().replace(/^fbx-/, '');
  const hrefOf = el => { for (const a of el.attributes) if (a.name === 'href' || a.name.endsWith(':href')) return a.value; return ''; };
  function fb2Doc(str) {
    let d = xmlParse(str); if (d) return d;
    d = xmlParse(fixEntities(str)); if (d) return d;
    const s2 = str.replace(/<\?xml[^>]*\?>/, '').replace(/<(\/?)(title|image|body|a|table|tr|td|th|style|p|section|subtitle|binary|description|poem|stanza|v|cite|epigraph|annotation|emphasis|strong|code|sub|sup)(?=[\s>\/])/gi, '<$1fbx-$2');
    return new DOMParser().parseFromString(s2, 'text/html');
  }
  async function parseFb2(u8, report) {
    report?.('Читаю FB2…');
    const str = decodeBytes(u8, sniffEnc(u8));
    const d = fb2Doc(str);
    const all = [...d.getElementsByTagName('*')];
    const findIn = (root, name) => { if (!root) return null; for (const e of root.getElementsByTagName('*')) if (fbName(e) === name) return e; return null; };
    const kids = (el, name) => el ? [...el.children].filter(c => fbName(c) === name) : [];
    const desc = all.find(e => fbName(e) === 'description');
    const ti = findIn(desc, 'title-info');
    const title = T(findIn(ti, 'book-title'));
    const authors = kids(ti, 'author').map(a => ['first-name', 'middle-name', 'last-name'].map(k => T(kids(a, k)[0])).filter(Boolean).join(' ') || T(kids(a, 'nickname')[0])).filter(Boolean);
    const ann = findIn(ti, 'annotation');
    const description = ann ? ([...ann.children].map(T).filter(Boolean).join('\n\n') || T(ann)) : '';
    const genres = kids(ti, 'genre').map(T).filter(Boolean);
    const lang = (T(findIn(ti, 'lang')) || '').slice(0, 2).toLowerCase();
    const coverEl = findIn(findIn(ti, 'coverpage'), 'image');
    const coverId = coverEl ? hrefOf(coverEl).replace(/^#/, '') : '';
    const bins = new Map();
    for (const e of all) if (fbName(e) === 'binary') bins.set(e.getAttribute('id'), { type: (e.getAttribute('content-type') || '').toLowerCase(), data: e.textContent });
    const bodies = all.filter(e => fbName(e) === 'body' && e !== d.body && !(e.parentElement && fbName(e.parentElement) === 'body' && e.parentElement !== d.body));
    if (!bodies.length) throw new Error('В FB2 не нашлось текста книги.');
    const main = bodies.find(b => !b.getAttribute('name')) || bodies[0];

    // images
    const ctx = { imgBytes: 0, imgSkipped: 0 };
    const imgs = new Map();
    const wanted = new Set();
    for (const b of bodies) for (const e of b.getElementsByTagName('*')) if (fbName(e) === 'image') wanted.add(hrefOf(e).replace(/^#/, ''));
    let k = 0;
    for (const id of wanted) { const bin = bins.get(id); k++; if (k % 5 === 0) report?.(`Иллюстрации: ${k} из ${wanted.size}`); if (bin) imgs.set(id, await prepImage(bin.data, bin.type || mimeByExt(id), ctx)); }
    const img = el => imgs.get(hrefOf(el).replace(/^#/, '')) || null;

    const wrap = (t, x) => plainOf(x).trim() ? `<${t}>${x}</${t}>` : x;
    function inl(el) {
      let h = '';
      for (const c of el.childNodes) {
        if (c.nodeType === 3) { h += escT(c.nodeValue.replace(WS, ' ')); continue; }
        if (c.nodeType !== 1) continue;
        const n = fbName(c);
        if (n === 'emphasis') h += wrap('em', inl(c));
        else if (n === 'strong') h += wrap('strong', inl(c));
        else if (n === 'strikethrough') h += wrap('s', inl(c));
        else if (n === 'sub' || n === 'sup' || n === 'code') h += wrap(n, inl(c));
        else if (n === 'a') { const inner = inl(c); const tx = plainOf(inner).trim(); if ((c.getAttribute('type') === 'note' || hrefOf(c).startsWith('#')) && tx.length <= 8) h += `<sup class="nr">${escT(tx)}</sup>`; else h += inner; }
        else if (n === 'image') { const s = img(c); if (s) h += `<img src="${escA(s)}" alt="">`; }
        else h += inl(c);
      }
      return h;
    }
    const P = (el, cls, out) => { const h = clean(inl(el)); if (plainOf(h).trim() || h.includes('<img ')) out.push(`<p${cls ? ` class="${cls}"` : ''}>${h}</p>`); };
    const titleHTML = el => { const ps = kids(el, 'p').map(p => clean(inl(p))).filter(Boolean); return ps.length ? ps.join('<br>') : escT(T(el)); };
    function poem(el, out, extra) {
      for (const c of el.children) {
        const m = fbName(c);
        if (m === 'title') out.push(`<p class="pt">${titleHTML(c)}</p>`);
        else if (m === 'epigraph') epigraph(c, out);
        else if (m === 'stanza') {
          const lines = [];
          const push = () => { if (lines.length) { out.push(`<p class="v${extra ? ' ' + extra : ''}">${lines.join('<br>')}</p>`); lines.length = 0; } };
          for (const v of c.children) { const x = fbName(v); if (x === 'v') lines.push(clean(inl(v))); else if (x === 'title' || x === 'subtitle') { push(); out.push(`<p class="pt">${x === 'title' ? titleHTML(v) : clean(inl(v))}</p>`); } }
          push();
        }
        else if (m === 'text-author' || m === 'date') P(c, 'ta', out);
        else block(c, out, extra || '');
      }
    }
    function epigraph(el, out) {
      for (const c of el.children) {
        const m = fbName(c);
        if (m === 'p') P(c, 'epi', out);
        else if (m === 'text-author') P(c, 'ta', out);
        else if (m === 'poem') poem(c, out, 'epi');
        else if (m !== 'empty-line') block(c, out, 'epi');
      }
    }
    function fbTable(el) {
      let h = '<div class="tbl"><table>';
      for (const tr of kids(el, 'tr')) { h += '<tr>'; for (const c of tr.children) { const t = fbName(c) === 'th' ? 'th' : 'td'; h += `<${t}>${clean(inl(c))}</${t}>`; } h += '</tr>'; }
      return h + '</table></div>';
    }
    function block(el, out, cls) {
      const n = fbName(el);
      switch (n) {
        case 'p': P(el, cls, out); break;
        case 'subtitle': P(el, 'sub', out); break;
        case 'empty-line': break;
        case 'image': { const s = img(el); if (s) out.push(`<figure><img src="${escA(s)}" alt=""></figure>`); break; }
        case 'poem': poem(el, out, cls === 'q' ? 'q' : ''); break;
        case 'cite': for (const c of el.children) { if (fbName(c) === 'text-author') P(c, 'ta', out); else block(c, out, 'q'); } break;
        case 'epigraph': epigraph(el, out); break;
        case 'table': out.push(fbTable(el)); break;
        case 'title': out.push(`<h2>${titleHTML(el)}</h2>`); break;
        case 'text-author': P(el, 'ta', out); break;
        case 'annotation': for (const c of el.children) block(c, out, 'q'); break;
        default: if (el.children.length) for (const c of el.children) block(c, out, cls); else P(el, cls, out);
      }
    }
    const chapters = [];
    function section(sec, level, isBody) {
      const direct = [], trailing = []; let title = '', content = false; const subs = [];
      for (const c of sec.children) {
        const m = fbName(c);
        if (m === 'section') { subs.push(c); continue; }
        if (subs.length) { block(c, trailing, ''); continue; }
        if (m === 'title') { title = kids(c, 'p').map(T).filter(Boolean).join('. ') || T(c); direct.push(`<h2>${titleHTML(c)}</h2>`); continue; }
        if (m === 'epigraph') { epigraph(c, direct); continue; }
        block(c, direct, '');
        if (m !== 'empty-line' && m !== 'image') content = true;
      }
      if (!subs.length) { chapters.push({ t: title || (isBody ? 'Текст' : ''), l: level, b: direct }); return; }
      if (direct.length) chapters.push({ t: title || (isBody ? 'Начало' : ''), l: isBody ? 1 : level, b: direct, part: !content });
      for (const s of subs) section(s, isBody ? 1 : Math.min(level + 1, 3), false);
      if (trailing.length) chapters.push({ t: title ? `${title}: окончание` : '', l: level, b: trailing });
    }
    report?.('Собираю главы…');
    section(main, 1, true);
    for (const nb of bodies) {
      if (nb === main) continue;
      const out = []; let t = '';
      for (const c of nb.children) {
        const m = fbName(c);
        if (m === 'title') { t = kids(c, 'p').map(T).filter(Boolean).join('. ') || T(c); out.push(`<h2>${titleHTML(c)}</h2>`); }
        else if (m === 'section') { for (const x of c.children) { const y = fbName(x); if (y === 'title') out.push(`<p class="note-t"><strong>${escT(T(x))}</strong></p>`); else block(x, out, ''); } }
        else block(c, out, '');
      }
      if (out.length) chapters.push({ t: t || (nb.getAttribute('name') === 'comments' ? 'Комментарии' : 'Примечания'), l: 1, b: out });
    }
    let cover = null;
    const cb = coverId && bins.get(coverId);
    if (cb) { try { cover = await shrinkImage(`data:${(cb.type || mimeByExt(coverId)).replace('image/jpg', 'image/jpeg')};base64,${cb.data.replace(/\s+/g, '')}`, 480, .85); } catch {} }
    return { title, author: authors.slice(0, 3).join(', '), description, lang: lang || guessLang(str), genre: genres.map(g => GENRES[g] || '').find(Boolean) || '', format: 'fb2', chapters, cover, warnings: ctx.imgSkipped ? [`Пропущено иллюстраций: ${ctx.imgSkipped} — книга получилась бы слишком тяжёлой.`] : [] };
  }

  /* ---------- TXT ---------- */
  const H_RE = /^(глава|часть|книга|том|раздел|пролог|эпилог|предисловие|послесловие|введение|заключение|интерлюдия|приложение|от автора|chapter|part|book|prologue|epilogue|preface|introduction|afterword|appendix|interlude)(?=$|[\s.:,№\-—–\dIVXLCivxlc])/i;
  function parseTxt(str, name) {
    str = str.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\t/g, '    ').replace(/­/g, '');
    const lines = str.split('\n');
    const ne = lines.filter(l => l.trim());
    if (!ne.length) throw new Error('Файл пустой.');
    const blank = lines.length - ne.length;
    const indented = ne.filter(l => /^\s{2,}\S/.test(l)).length;
    const wrapped = ne.filter(l => { const n = l.trim().length; return n >= 50 && n <= 85; }).length / ne.length;
    let paras = [];
    if (indented / ne.length > .2 && wrapped > .4 && blank / ne.length < .25) {
      let cur = [];
      const push = () => { if (cur.length) { paras.push({ t: cur.join(' ') }); cur = []; } };
      for (const l of lines) { if (!l.trim()) { push(); continue; } if (/^\s{2,}\S/.test(l)) push(); cur.push(l.trim()); }
      push();
    } else if (blank / ne.length > .3) {
      let cur = [];
      const push = () => { if (!cur.length) return; const avg = cur.reduce((a, l) => a + l.length, 0) / cur.length; if (cur.length > 1 && avg < 46) paras.push({ t: cur.join('\n'), verse: true }); else paras.push({ t: cur.join(' ') }); cur = []; };
      for (const l of lines) { if (!l.trim()) push(); else cur.push(l.trim()); }
      push();
    } else paras = ne.map(l => ({ t: l.trim() }));
    for (const p of paras) if (!p.verse) p.t = p.t.replace(/(\S)- (\p{Ll})/gu, '$1$2');
    const isHead = p => !p.verse && p.t.length <= 90 && (H_RE.test(p.t) || /^(?:[IVXLC]{1,7}|\d{1,3})\.?$/.test(p.t) || /^#{1,3}\s+\S/.test(p.t));
    const isBreak = p => /^(?:[*•·#~=_—–-]\s*){3,}$/.test(p.t.trim());
    const heads = paras.filter(isHead);
    const useHeads = heads.length >= 2 && heads.length < paras.length * .3;
    const B = p => p.verse ? `<p class="v">${escT(p.t).replace(/\n/g, '<br>')}</p>` : isBreak(p) ? '<hr>' : `<p>${escT(p.t)}</p>`;
    let chapters = [];
    if (useHeads) {
      const partRe = /^(часть|книга|том|part|book)/i;
      const twoLevels = heads.some(h => partRe.test(h.t)) && heads.some(h => !partRe.test(h.t));
      let cur = null;
      for (let i = 0; i < paras.length; i++) {
        const p = paras[i];
        if (isHead(p)) {
          let t = p.t.replace(/^#{1,3}\s+/, '');
          const blocks = [`<h2>${escT(t)}</h2>`];
          const nx = paras[i + 1];
          if (nx && !isHead(nx) && !nx.verse && nx.t.length < 70 && !/[.!?…,;:»")]$/.test(nx.t) && /^(глава|chapter|часть|part|[IVXLC]+\.?$|\d+\.?$)/i.test(t) && t.length < 20) { t = `${t}. ${nx.t}`; blocks.push(`<p class="sub">${escT(nx.t)}</p>`); i++; }
          cur = { t, l: twoLevels && !partRe.test(p.t) ? 2 : 1, b: blocks };
          chapters.push(cur); continue;
        }
        if (!cur) { cur = { t: 'Начало', l: 1, b: [] }; chapters.push(cur); }
        cur.b.push(B(p));
      }
      chapters.forEach(c => { if (c.b.length === 1 && /^<h2>/.test(c.b[0])) c.part = true; });
    } else {
      let part = [], size = 0, k = 1;
      for (const p of paras) { part.push(B(p)); size += p.t.length; if (size > 36000) { chapters.push({ t: `Часть ${k++}`, l: 1, b: part }); part = []; size = 0; } }
      if (part.length) chapters.push({ t: k === 1 ? 'Текст' : `Часть ${k}`, l: 1, b: part });
    }
    const { title, author } = fromName(name);
    return { title, author, description: '', lang: guessLang(str), genre: '', format: 'txt', chapters };
  }
  function fromName(name) {
    const base = name.replace(/\.(fb2\.zip|[^.]+)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base) || /^([^.]{3,40})\.\s+(.+)$/.exec(base);
    return m ? { author: m[1].trim(), title: m[2].trim() } : { author: '', title: base };
  }

  /* ---------- Markdown ---------- */
  function mdInline(s) {
    return escT(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  }
  function parseMd(str, name) {
    str = str.replace(/\r\n?/g, '\n');
    const out = []; let para = [], quote = false, code = null;
    const flush = () => { if (para.length) { out.push(`<p${quote ? ' class="q"' : ''}>${mdInline(para.join(' '))}</p>`); para = []; } quote = false; };
    for (const raw of str.split('\n')) {
      if (code !== null) { if (/^```/.test(raw)) { out.push(`<pre>${escT(code.join('\n'))}</pre>`); code = null; } else code.push(raw); continue; }
      if (/^```/.test(raw)) { flush(); code = []; continue; }
      const l = raw.trim();
      if (!l) { flush(); continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(l))) { flush(); out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); continue; }
      if (/^([-*_]\s*){3,}$/.test(l)) { flush(); out.push('<hr>'); continue; }
      if ((m = /^[-*+]\s+(.+)$/.exec(l))) { flush(); out.push(`<p class="li">${mdInline(m[1])}</p>`); continue; }
      if ((m = /^(\d+)[.)]\s+(.+)$/.exec(l))) { flush(); out.push(`<p class="li ol"><span class="n">${m[1]}.</span> ${mdInline(m[2])}</p>`); continue; }
      if ((m = /^>\s?(.*)$/.exec(l))) { if (!quote) flush(); quote = true; para.push(m[1]); continue; }
      if (quote) flush();
      para.push(l);
    }
    flush(); if (code) out.push(`<pre>${escT(code.join('\n'))}</pre>`);
    const r = splitByHeadings(out);
    const nm = fromName(name);
    return { title: r.title || nm.title, author: nm.author, description: '', lang: guessLang(str), genre: '', format: 'md', chapters: r.chapters };
  }
  function splitByHeadings(blocks) {
    const levels = blocks.map(b => { const m = /^<h([1-6])>/.exec(b); return m ? +m[1] : 0; });
    const present = [...new Set(levels.filter(Boolean))].sort();
    let title = '';
    let lv = present[0];
    if (lv && levels.filter(x => x === lv).length === 1 && present[1]) { title = plainOf(blocks[levels.indexOf(lv)]).trim(); lv = present[1]; }
    const chapters = []; let cur = null;
    blocks.forEach((b, i) => {
      if (levels[i] && levels[i] === lv) { cur = { t: plainOf(b).replace(/\s+/g, ' ').trim(), l: 1, b: [b] }; chapters.push(cur); return; }
      if (levels[i] && title && levels[i] < lv) return; // book title heading
      if (!cur) { cur = { t: 'Начало', l: 1, b: [] }; chapters.push(cur); }
      cur.b.push(b);
    });
    normHeadings(chapters);
    return { chapters, title };
  }

  /* ---------- HTML file ---------- */
  function parseHtmlFile(str, name) {
    const d = new DOMParser().parseFromString(str, 'text/html');
    const out = [];
    const conv = HtmlConv({ out, anchors: {}, img: (el, ref) => (ref && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(ref) && ref.length < 3e6) ? ref : null });
    conv.walk(d.body, ''); conv.flush('');
    const r = splitByHeadings(out);
    const nm = fromName(name);
    const author = d.querySelector('meta[name="author"]')?.getAttribute('content') || nm.author;
    return { title: T(d.querySelector('title')) || r.title || nm.title, author, description: d.querySelector('meta[name="description"]')?.getAttribute('content') || '', lang: (d.documentElement.getAttribute('lang') || guessLang(d.body.textContent)).slice(0, 2), genre: '', format: 'html', chapters: r.chapters };
  }

  /* ---------- PDF ---------- */
  async function parsePdf(buf, report) {
    report?.('Загружаю модуль PDF…');
    const pdfjs = await needPdf();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const n = pdf.numPages;
    let title = '', author = '';
    try { const meta = await pdf.getMetadata(); title = (meta?.info?.Title || '').trim(); author = (meta?.info?.Author || '').trim(); } catch {}
    const pages = [];
    let chars = 0;
    for (let i = 1; i <= n; i++) {
      if (i % 3 === 1) report?.(`Читаю страницы: ${i} из ${n}`);
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const lines = [];
      let cur = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const x = it.transform[4], y = it.transform[5], hgt = Math.abs(it.transform[3]) || it.height || 10;
        if (!cur || Math.abs(y - cur.y) > hgt * .5) { cur = { y, x, h: hgt, t: '' }; lines.push(cur); }
        cur.t += it.str; if (it.hasEOL) cur = null;
      }
      const ls = lines.map(l => ({ ...l, t: l.t.replace(/\s+/g, ' ').trim() })).filter(l => l.t && !/^\d{1,4}$/.test(l.t));
      pages.push(ls); chars += ls.reduce((a, l) => a + l.t.length, 0);
      page.cleanup?.();
    }
    if (chars < 200) throw new Error('В этом PDF нет текстового слоя: похоже, это отсканированные страницы. Такие файлы читалка открыть не может.');
    const pageParas = pages.map(ls => {
      if (!ls.length) return [];
      const gaps = []; for (let i = 1; i < ls.length; i++) gaps.push(Math.abs(ls[i - 1].y - ls[i].y));
      const med = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 12;
      const left = Math.min(...ls.map(l => l.x));
      const maxLen = Math.max(...ls.map(l => l.t.length));
      const paras = []; let cur = '';
      ls.forEach((l, i) => {
        const prev = ls[i - 1];
        const brk = !prev || Math.abs(prev.y - l.y) > med * 1.45 || (l.x > left + l.h * 1.2 && /[.!?…:»"]$/.test(prev.t)) || (prev.t.length < maxLen * .6 && /[.!?…:»"]$/.test(prev.t));
        if (brk && cur) { paras.push(cur); cur = ''; }
        if (cur && /[A-Za-zА-Яа-яЁё]-$/.test(cur) && /^\p{Ll}/u.test(l.t)) cur = cur.slice(0, -1) + l.t;
        else cur = cur ? cur + ' ' + l.t : l.t;
      });
      if (cur) paras.push(cur);
      return paras;
    });
    // join paragraphs broken across pages
    for (let i = 1; i < pageParas.length; i++) {
      const a = pageParas[i - 1], b = pageParas[i];
      if (a.length && b.length && !/[.!?…:»"]$/.test(a[a.length - 1]) && /^\p{Ll}/u.test(b[0])) { a[a.length - 1] += ' ' + b.shift(); }
    }
    let marks = [];
    try {
      const outline = await pdf.getOutline();
      const walkO = async (items, lvl) => { for (const it of items || []) { try { let dest = it.dest; if (typeof dest === 'string') dest = await pdf.getDestination(dest); if (Array.isArray(dest)) { const idx = await pdf.getPageIndex(dest[0]); marks.push({ t: (it.title || '').trim(), p: idx, l: Math.min(lvl, 3) }); } } catch {} if (lvl < 2) await walkO(it.items, lvl + 1); } };
      await walkO(outline, 1);
    } catch {}
    marks = marks.filter(m => m.t).sort((a, b) => a.p - b.p);
    const chapters = [];
    if (marks.length >= 2) {
      if (marks[0].p > 0) marks.unshift({ t: 'Начало', p: 0, l: 1 });
      marks.forEach((m, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].p : pageParas.length;
        const b = []; for (let p = m.p; p < Math.max(end, m.p + (i + 1 < marks.length && marks[i + 1].p === m.p ? 0 : 1)); p++) b.push(...(pageParas[p] || []).map(t => `<p>${escT(t)}</p>`));
        if (b.length) chapters.push({ t: m.t, l: m.l, b: [`<h2>${escT(m.t)}</h2>`, ...b] });
      });
    }
    if (!chapters.length) {
      const step = 15;
      for (let p = 0; p < pageParas.length; p += step) {
        const b = []; for (let q = p; q < Math.min(p + step, pageParas.length); q++) b.push(...pageParas[q].map(t => `<p>${escT(t)}</p>`));
        if (b.length) chapters.push({ t: `Страницы ${p + 1}–${Math.min(p + step, pageParas.length)}`, l: 1, b });
      }
    }
    let cover = null;
    try {
      const page = await pdf.getPage(1); const vp0 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 480 / vp0.width });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      cover = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
    } catch {}
    try { pdf.destroy(); } catch {}
    const all = pageParas.flat().join(' ');
    return { title, author, description: '', lang: guessLang(all), genre: '', format: 'pdf', chapters, cover, warnings: ['Текст извлечён из PDF: вёрстка и картинки не переносятся.'] };
  }

  /* ---------- finishing ---------- */
  function finalize(r) {
    let chapters = (r.chapters || []).filter(c => c.b && c.b.length);
    const MAX = 90000;
    const split = [];
    for (const c of chapters) {
      const lens = c.b.map(textLen); const tot = lens.reduce((a, b) => a + b, 0);
      if (tot <= MAX * 1.3) { split.push(c); continue; }
      let part = [], size = 0, k = 1;
      c.b.forEach((b, i) => { part.push(b); size += lens[i]; if (size >= MAX && i < c.b.length - 1) { split.push({ ...c, t: k === 1 ? c.t : `${c.t} (${k})`, b: part }); k++; part = []; size = 0; } });
      if (part.length) split.push({ ...c, t: k === 1 ? c.t : `${c.t} (${k})`, b: part });
    }
    chapters = split;
    let chars = 0, words = 0;
    chapters.forEach((c, i) => {
      let n = 0;
      for (const b of c.b) { const t = plainOf(b); n += t.length; const m = t.match(/[\p{L}\p{N}]+/gu); words += m ? m.length : 0; }
      c.n = n; chars += n;
      c.t = String(c.t || '').replace(/\s+/g, ' ').trim().slice(0, 140) || firstHeading(c.b) || `Глава ${i + 1}`;
      c.l = clamp(c.l || 1, 1, 3);
    });
    if (!chapters.length || chars < 20) throw new Error('В файле не нашлось текста для чтения.');
    return { ...r, chapters, chars, words, warnings: r.warnings || [] };
  }
  function detect(name, u8) {
    const n = name.toLowerCase();
    if (u8[0] === 0x50 && u8[1] === 0x4B) return n.endsWith('.epub') ? 'epub' : 'zip';
    if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'pdf';
    if (/\.fb2$/.test(n)) return 'fb2';
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 600));
    if (/<FictionBook/i.test(head)) return 'fb2';
    if (/\.(x?html?)$/.test(n)) return 'html';
    if (/\.(md|markdown)$/.test(n)) return 'md';
    if (/\.txt$/.test(n)) return 'txt';
    if (/\.(pdf|epub|docx?|rtf|mobi|azw3?|djvu|doc|odt)$/.test(n)) return 'no';
    if (/<html/i.test(head)) return 'html';
    return 'txt';
  }
  async function file(f, report) {
    const buf = await f.arrayBuffer(); const u8 = new Uint8Array(buf);
    const kind = detect(f.name, u8);
    let r;
    if (kind === 'zip' || kind === 'epub') {
      report?.('Распаковываю архив…');
      const JSZip = await needJSZip();
      let zip;
      try { zip = await JSZip.loadAsync(buf); } catch { throw new Error('Архив повреждён или защищён паролем.'); }
      const names = Object.keys(zip.files);
      if (names.some(x => /(^|\/)container\.xml$/i.test(x)) || names.some(x => /\.opf$/i.test(x))) r = await parseEpub(buf, report, zip);
      else {
        const fb = names.find(x => /\.fb2$/i.test(x));
        if (fb) r = await parseFb2(await zip.file(fb).async('uint8array'), report);
        else { const tx = names.find(x => /\.txt$/i.test(x)); if (!tx) throw new Error('В архиве нет книги в формате FB2, EPUB или TXT.'); r = parseTxt(decodeBytes(await zip.file(tx).async('uint8array')), tx.split('/').pop()); }
      }
    }
    else if (kind === 'fb2') r = await parseFb2(u8, report);
    else if (kind === 'pdf') r = await parsePdf(buf, report);
    else if (kind === 'html') r = parseHtmlFile(decodeBytes(u8, sniffEnc(u8)), f.name);
    else if (kind === 'md') r = parseMd(decodeBytes(u8), f.name);
    else if (kind === 'txt') r = parseTxt(decodeBytes(u8), f.name);
    else throw new Error('Этот формат пока не поддерживается. Подойдут FB2, EPUB, TXT, PDF, HTML и Markdown.');
    report?.('Проверяю текст…');
    r = finalize(r);
    if (!r.title) r.title = fromName(f.name).title;
    if (!r.author) r.author = fromName(f.name).author;
    return r;
  }
  return { file };
})();
