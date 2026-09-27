#!/bin/sh
# Собирает страницу AynoBook из частей в src/ в один файл dist/aynobook.html
cd "$(dirname "$0")"
cat src/01_head.html src/02_body.html src/03_core.js src/04_views.js src/05_parse.js src/06_reader.js src/07_end.js > dist/aynobook.html
echo "dist/aynobook.html: $(wc -c < dist/aynobook.html) bytes"
