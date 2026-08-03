# -*- coding: utf-8 -*-
"""
web/make_sample.py — 학습 결과(web_export.json)를 웹에 심을 샘플로 변환

웹의 '6. 퀀트 AI' 탭은 보통 사용자가 JSON을 직접 올려서 봅니다. 하지만 아무것도 올리지
않아도 화면이 어떤 모습인지 볼 수 있도록, 결과 하나를 줄여서 자바스크립트 파일로 심어 둡니다.

    python3 web/make_sample.py runs/demo_gru/web_export.json

용량을 줄이는 방법
  - 숫자 자릿수를 줄입니다(가격 2자리, 점수 3자리)
  - 들여쓰기 없이 저장합니다
"""

from __future__ import annotations

import json
import os
import sys


def r(v, nd):
    return None if v is None else round(float(v), nd)


def compact(src: str, dst: str) -> None:
    with open(src, encoding="utf-8") as f:
        d = json.load(f)

    # 모의투자는 '갈아타는 날'의 가격만 있으면 되므로, 샘플에서는 그 날짜만 남깁니다.
    # (원본 web_export.json은 매일 가격을 다 담고 있습니다)
    keep = set(d.get("score_dates") or [])
    if keep:
        idx = [i for i, ds in enumerate(d["dates"]) if ds in keep]
        d["dates"] = [d["dates"][i] for i in idx]
        d["prices"] = [[r(v, 2) for v in d["prices"][i]] for i in idx]
        d["ic"]["dates"] = [d["ic"]["dates"][i] for i in idx if i < len(d["ic"]["dates"])]
        d["ic"]["values"] = [d["ic"]["values"][i] for i in idx if i < len(d["ic"]["values"])]
    else:
        d["prices"] = [[r(v, 2) for v in row] for row in d["prices"]]
    d["scores"] = [[r(v, 3) for v in row] for row in d["scores"]]
    for k in ("strategy", "strategy_gross", "benchmark", "index"):
        if d["equity"].get(k):
            d["equity"][k] = [r(v, 4) for v in d["equity"][k]]
    d["ic"]["values"] = [r(v, 3) for v in d["ic"]["values"]]
    d["meta"]["sample"] = True

    body = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    js = ("/* 자동 생성 파일 — web/make_sample.py 가 만듭니다. 직접 고치지 마세요.\n"
          "   quant 파이프라인의 학습 결과 예시입니다. */\n"
          "window.FRSP = window.FRSP || {};\n"
          "window.FRSP.SAMPLE_QUANT = " + body + ";\n")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"생성: {dst} ({len(js.encode('utf-8')) / 1024:,.0f} KB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("사용법: python3 web/make_sample.py runs/<이름>/web_export.json")
    here = os.path.dirname(os.path.abspath(__file__))
    compact(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "js", "sample_quant.js"))
