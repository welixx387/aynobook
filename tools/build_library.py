#!/usr/bin/env python3
"""Собирает открытую библиотеку для сайта из выгрузки артефакта Claude.

Выгрузка (папка EXPORT):
  books/<id>.json        карточки книг (ArtifactData list books, out_dir)
  lib/quotes.json        список цитат
  assets/<assetId>.*     файлы книг и обложек (Artifact read path=<assetId>)

Результат в library/: books.json, books/<id>.json, covers/<id>.<ext>, quotes.json
Скрытые книги на открытый сайт не попадают.
Файлы неизменённых книг (тот же updatedAt) берутся из прежней library/, их можно не выгружать.
"""
import json, os, re, shutil, sys, glob

EXPORT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/export'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'library')
KEEP = ('title', 'author', 'genre', 'description', 'lang', 'format', 'chars', 'words', 'chapters', 'addedAt', 'updatedAt')

def load(p):
    d = json.load(open(p, encoding='utf-8'))
    return d.get('data', d) if isinstance(d, dict) and 'data' in d and isinstance(d['data'], dict) else d

def asset(aid):
    hits = glob.glob(os.path.join(EXPORT, 'assets', aid + '.*'))
    return hits[0] if hits else None

# прежняя версия: неизменённые книги можно не скачивать заново
OLD = {}
try:
    for m in json.load(open(os.path.join(OUT, 'books.json'), encoding='utf-8'))['books']:
        OLD[m['id']] = m
except Exception:
    pass
KEEPDIR = os.path.join(EXPORT, '_prev')
shutil.rmtree(KEEPDIR, ignore_errors=True)
if os.path.isdir(OUT):
    shutil.copytree(OUT, KEEPDIR)
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(os.path.join(OUT, 'books')); os.makedirs(os.path.join(OUT, 'covers'))
books, missing = [], []
for f in sorted(glob.glob(os.path.join(EXPORT, 'books', '*.json'))):
    bid = os.path.splitext(os.path.basename(f))[0]
    if not re.fullmatch(r'[A-Za-z0-9_-]{2,80}', bid):
        continue
    b = load(f)
    if b.get('hidden'):
        continue
    c = b.get('content') or {}
    src = asset(c.get('id', '')) if c.get('kind') == 'asset' else None
    old = OLD.get(bid)
    unchanged = old and old.get('updatedAt') == b.get('updatedAt')
    if not src and unchanged and os.path.exists(os.path.join(KEEPDIR, 'books', bid + '.json')):
        src = os.path.join(KEEPDIR, 'books', bid + '.json')
    if not src:
        missing.append(b.get('title', bid)); continue
    shutil.copyfile(src, os.path.join(OUT, 'books', bid + '.json'))
    meta = {k: b[k] for k in KEEP if k in b}
    meta['id'] = bid
    meta['content'] = {'kind': 'static', 'path': f'library/books/{bid}.json'}
    cov = asset(b.get('cover') or '') if b.get('cover') else None
    if not cov and b.get('cover') and unchanged and old.get('coverPath') and os.path.exists(os.path.join(KEEPDIR, 'covers', os.path.basename(old['coverPath']))):
        cov = os.path.join(KEEPDIR, 'covers', os.path.basename(old['coverPath']))
    if cov:
        ext = os.path.splitext(cov)[1] or '.jpg'
        shutil.copyfile(cov, os.path.join(OUT, 'covers', bid + ext))
        meta['coverPath'] = f'library/covers/{bid}{ext}'
    elif isinstance(b.get('coverData'), str) and b['coverData'].startswith('data:image/'):
        meta['coverData'] = b['coverData']
    books.append(meta)
books.sort(key=lambda x: x.get('addedAt', ''), reverse=True)
json.dump({'books': books}, open(os.path.join(OUT, 'books.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
q = os.path.join(EXPORT, 'lib', 'quotes.json')
items = load(q).get('items', []) if os.path.exists(q) else []
json.dump({'items': items}, open(os.path.join(OUT, 'quotes.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'книг: {len(books)}, цитат: {len(items)}' + (f', без файла: {missing}' if missing else ''))
