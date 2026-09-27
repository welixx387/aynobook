#!/bin/sh
# Собирает страницу AynoBook из частей в src/
#  dist/aynobook.html — версия для публикации артефактом в Claude (без обёртки)
#  index.html         — полная HTML-страница для обычного хостинга (Vercel и т. п.)
cd "$(dirname "$0")"
cat src/01_head.html src/02_body.html src/03_core.js src/04_views.js src/05_parse.js src/06_reader.js src/07_end.js > dist/aynobook.html
{
  printf '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style></head><body>\n'
  cat dist/aynobook.html
  printf '\n</body></html>\n'
} > index.html
echo "dist/aynobook.html и index.html собраны"
