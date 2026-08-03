# -*- coding: utf-8 -*-
"""
export_web.py — 학습 결과를 웹 화면으로 넘기기

파이썬에서 GPU로 학습한 결과를 브라우저에서 그대로 확인하고,
그 예측으로 여러 종목 모의투자까지 해 볼 수 있게 JSON 하나로 내보냅니다.

  runs/<이름>/web_export.json  →  웹의 '6. 퀀트 AI' 탭에서 불러오기

용량을 줄이려고 이렇게 합니다.
  - 가격은 소수점 4자리까지만
  - 점수는 리밸런싱 날짜에만 (매일 저장할 필요가 없습니다)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Dict, List

import numpy as np

from .config import Config
from .data import Panel
from .report import save_json


def _round_list(a: np.ndarray, nd: int) -> List:
    out = []
    for v in np.asarray(a, dtype=float):
        out.append(None if not np.isfinite(v) else round(float(v), nd))
    return out


def export(cfg: Config, panel: Panel, res: Dict, bt: Dict, ic: np.ndarray,
           ic_stats: Dict, q_returns: List[float], path: str) -> str:
    lo, hi = res["test_range"]
    hi = min(hi, panel.T - 1)
    dates = panel.dates[lo:hi + 1]
    close = panel.close[lo:hi + 1]
    scores = res["scores"][lo:hi + 1]

    # 점수는 리밸런싱한 날만 저장합니다.
    pick_dates = {p["date"] for p in bt["picks"]}
    score_rows, score_dates = [], []
    for i, d in enumerate(dates):
        if str(d) in pick_dates:
            score_rows.append(_round_list(scores[i], 4))
            score_dates.append(str(d))

    payload = {
        "meta": {
            "name": cfg.name,
            "created": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "model": cfg.model,
            "loss": cfg.loss,
            "device": res.get("device"),
            "source": panel.meta.get("source"),
            "synthetic": bool(panel.meta.get("synthetic")),
            "note": panel.meta.get("note", ""),
            "horizon": cfg.horizon,
            "rebalance": cfg.rebalance,
            "top_k": cfg.top_k,
            "long_short": cfg.long_short,
            "cost_per_side": cfg.cost_per_side,
            "slippage": cfg.slippage,
            "n_features": res.get("n_features"),
            "ensemble": cfg.ensemble,
            "universe": len(panel.tickers),
        },
        "tickers": panel.tickers,
        "dates": [str(d) for d in dates],
        "prices": [_round_list(row, 4) for row in close],
        "score_dates": score_dates,
        "scores": score_rows,
        "equity": {
            "dates": [str(d) for d in bt["dates"]],
            "strategy": _round_list(np.cumprod(1 + bt["strat_net"]), 5),
            "strategy_gross": _round_list(np.cumprod(1 + bt["strat_gross"]), 5),
            "benchmark": _round_list(np.cumprod(1 + bt["bench"]), 5),
            "index": (_round_list(np.cumprod(1 + bt["index"]), 5) if bt.get("index") is not None else None),
        },
        "ic": {
            "dates": [str(d) for d in dates],
            "values": _round_list(ic, 4),
            "stats": {k: (None if not np.isfinite(v) else round(float(v), 6))
                      if isinstance(v, float) else v for k, v in ic_stats.items()},
        },
        "quantiles": _round_list(np.array(q_returns), 6),
        "performance": {
            "net": {k: (None if not np.isfinite(v) else round(float(v), 6)) for k, v in bt["perf_net"].items()},
            "gross": {k: (None if not np.isfinite(v) else round(float(v), 6)) for k, v in bt["perf_gross"].items()},
            "benchmark": {k: (None if not np.isfinite(v) else round(float(v), 6)) for k, v in bt["perf_bench"].items()},
            "excess": {k: (None if not np.isfinite(v) else round(float(v), 6)) for k, v in bt["perf_excess"].items()},
        },
        "picks": bt["picks"],
        "folds": res["folds"],
    }

    save_json(path, payload)
    size = os.path.getsize(path) / 1024
    print(f"[내보내기] {path} ({size:,.0f} KB) — 웹의 '6. 퀀트 AI' 탭에서 불러오세요.")
    return path
