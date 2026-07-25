# -*- coding: utf-8 -*-
"""
web/build_single.py — 여러 파일로 나뉜 웹사이트를 '파일 하나'로 합칩니다.

왜 필요한가
    web/index.html은 styles.css와 js/*.js를 따로 불러옵니다. 폴더째 옮기면 잘 되지만,
    파일 하나만 메일로 보내거나 USB로 옮겨 더블클릭으로 열고 싶을 때가 있습니다.
    이 스크립트는 CSS와 자바스크립트를 HTML 안에 그대로 집어넣어
    인터넷 없이도 열리는 standalone.html 한 개를 만듭니다.

사용법
    python3 web/build_single.py                 # web/standalone.html 생성
    python3 web/build_single.py --fragment out.html   # <body> 안쪽만 (임베드용)
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read()


def build():
    html = read("index.html")
    css = read("styles.css")

    # <link rel="stylesheet" href="styles.css"> → <style>…</style>
    html = re.sub(
        r'<link rel="stylesheet" href="styles\.css">',
        "<style>\n" + css + "\n</style>",
        html,
    )

    # <script src="js/xxx.js"></script> → <script>…</script>
    def inline(m):
        src = m.group(1)
        code = read(src)
        return "<script>\n/* ===== " + src + " ===== */\n" + code + "\n</script>"

    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline, html)

    if '<script src="' in html or 'href="styles.css"' in html:
        raise SystemExit("[오류] 합치지 못한 파일이 남아 있습니다.")
    return html


def to_fragment(html):
    """<body>…</body> 안쪽만 남깁니다. <head>의 <style>은 앞에 붙여 둡니다."""
    style = re.search(r"<style>.*?</style>", html, re.S)
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    body = re.search(r"<body>(.*?)</body>", html, re.S)
    if not (style and body):
        raise SystemExit("[오류] style 또는 body를 찾지 못했습니다.")
    head = "<title>%s</title>\n" % (title.group(1) if title else "")
    return head + style.group(0) + "\n" + body.group(1)


if __name__ == "__main__":
    out_html = build()
    if "--fragment" in sys.argv:
        i = sys.argv.index("--fragment")
        target = sys.argv[i + 1]
        text = to_fragment(out_html)
    else:
        target = os.path.join(HERE, "standalone.html")
        text = out_html
    with open(target, "w", encoding="utf-8") as f:
        f.write(text)
    print("생성: %s (%.0f KB)" % (target, len(text.encode("utf-8")) / 1024))
