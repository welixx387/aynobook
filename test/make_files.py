import zipfile, base64, io, random
from PIL import Image, ImageDraw
random.seed(7)
def cover(color, w=300, h=450):
    im = Image.new('RGB', (w, h), color); d = ImageDraw.Draw(im)
    for i in range(0, h, 18): d.line([(0, i), (w, i + 40)], fill=(255, 255, 255), width=2)
    d.rectangle([20, 20, w - 20, h - 20], outline=(240, 220, 150), width=4)
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()
# original filler sentences (written for this test)
S = ["Утро над рекой начиналось с тумана, который медленно отступал к дальнему берегу.",
     "Смотритель маяка записывал в тетрадь всё, что видел: ветер, облака, редкие лодки.",
     "В деревне говорили, что старый мост построили ещё до того, как появилась сама дорога.",
     "Она открыла окно, и в комнату вошёл запах мокрой травы и дыма от соседской печи.",
     "Никто не помнил, откуда в библиотеке взялся этот сундук с письмами без адресов.",
     "К полудню туман ушёл совсем, и стали видны крыши, колокольня и линия леса.",
     "Он долго стоял у двери, не решаясь постучать, а потом просто сел на ступеньку.",
     "Письмо было коротким, но каждую строчку в нём хотелось перечитать дважды."]
def para(n=5): return ' '.join(random.choice(S) for _ in range(n))
# EPUB
chapters = [(f"Глава {i}. " + t, [para(random.randint(4, 9)) for _ in range(random.randint(14, 22))]) for i, t in enumerate(["Туман", "Маяк", "Мост", "Письма", "Сундук", "Возвращение"], 1)]
z = zipfile.ZipFile('Тестовая повесть.epub', 'w')
z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip')
z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
items = ''.join(f'<item id="c{i}" href="text/ch{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))
spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
z.writestr('OEBPS/content.opf', f'''<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Туман над рекой</dc:title><dc:creator>Анна Тестова</dc:creator><dc:language>ru</dc:language><dc:description>&lt;p&gt;Повесть о смотрителе маяка и сундуке с письмами.&lt;/p&gt;</dc:description><meta name="cover" content="cov"/></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cov" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="pic" href="images/pic.png" media-type="image/png"/>{items}</manifest><spine>{spine}</spine></package>''')
z.writestr('OEBPS/images/cover.png', cover((31, 77, 69)))
z.writestr('OEBPS/images/pic.png', cover((120, 40, 50), 200, 140))
nav = ''.join(f'<li><a href="text/ch{i}.xhtml">{t}</a></li>' for i, (t, _) in enumerate(chapters))
z.writestr('OEBPS/nav.xhtml', f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol>{nav}</ol></nav></body></html>')
for i, (t, ps) in enumerate(chapters):
    body = f'<h1>{t}</h1>' + ''.join(f'<p>{p}</p>' for p in ps[:5]) + ('<p><img src="../images/pic.png" alt=""/></p>' if i == 1 else '') + '<blockquote><p>Цитата внутри главы, <em>выделенная курсивом</em>.</p></blockquote>' + ''.join(f'<p>{p}</p>' for p in ps[5:]) + '<ul><li>Первый пункт</li><li>Второй пункт</li></ul>'
    z.writestr(f'OEBPS/text/ch{i}.xhtml', f'<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>{t}</title><style>p{{margin:0}}</style></head><body>{body}&nbsp;</body></html>')
z.close()
# FB2 cp1251
secs = ''.join(f'<section><title><p>Часть {i}</p><p>{t}</p></title><epigraph><p>Эпиграф к части {i}.</p><text-author>Неизвестный автор</text-author></epigraph>' + ''.join(f'<p>{para(random.randint(3, 8))}</p>' for _ in range(25)) + '<poem><stanza><v>Первая строка стиха,</v><v>вторая строка стиха.</v></stanza></poem></section>' for i, t in enumerate(["Начало", "Дорога", "Дом"], 1))
cb = base64.b64encode(cover((110, 31, 42))).decode()
fb2 = f'''<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>prose_contemporary</genre><author><first-name>Пётр</first-name><last-name>Примеров</last-name></author><book-title>Дорога домой</book-title><annotation><p>Короткий тестовый роман в трёх частях.</p></annotation><coverpage><image l:href="#cover.png"/></coverpage><lang>ru</lang></title-info></description><body><title><p>Дорога домой</p></title>{secs}</body><body name="notes"><title><p>Примечания</p></title><section id="n1"><title><p>1</p></title><p>Первое примечание.</p></section></body><binary id="cover.png" content-type="image/png">{cb}</binary></FictionBook>'''
open('Примеров - Дорога домой.fb2', 'wb').write(fb2.encode('cp1251'))
# TXT cp1251
txt = "Записки наблюдателя\n\n" + ''.join(f"Глава {i}\n\n" + '\n\n'.join(para(random.randint(3, 7)) for _ in range(30)) + "\n\n* * *\n\n" + '\n\n'.join(para(4) for _ in range(5)) + "\n\n" for i in range(1, 5))
open('Иванов - Записки наблюдателя.txt', 'wb').write(txt.encode('cp1251'))
print('done')
