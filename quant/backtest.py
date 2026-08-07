# -*- coding: utf-8 -*-
"""
backtest.py — 예측 점수로 실제 포트폴리오를 굴려 보기

IC가 좋아도 돈이 되는지는 별개입니다. 갈아탈 때마다 수수료가 나가고,
좋은 종목이 이미 비싸져 있을 수도 있습니다. 그래서 이렇게 검증합니다.

  1. 리밸런싱 날마다 예측 점수로 종목을 줄 세웁니다.
  2. 상위 K종목을 삽니다. (롱숏이면 하위 K종목은 공매도)
  3. 다음 리밸런싱까지 들고 갑니다. 그동안 비중은 가격 따라 자연히 움직입니다(드리프트).
  4. 갈아탈 때 바뀐 비중만큼 거래비용과 슬리피지를 뺍니다.
  5. 같은 기간 '전 종목 동일가중'과 비교합니다. 이걸 못 이기면 의미가 없습니다.

타이밍 규칙: t일 종가까지의 정보로 만든 점수 → t일 종가에 매매 → t+1일 수익률부터 반영.
미래를 앞당겨 쓰는 실수를 막기 위한 것입니다.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from .config import Config
from .data import Panel
from .metrics import perf_stats


def _target_weights(score: np.ndarray, usable: np.ndarray, cfg: Config) -> np.ndarray:
    """그날의 목표 비중을 만듭니다. 롱온리면 합이 1(또는 그 이하), 롱숏이면 롱 1 / 숏 -1."""
    N = len(score)
    w = np.zeros(N)
    idx = np.where(usable & np.isfinite(score))[0]
    if len(idx) < 4:
        return w

    k = max(1, min(cfg.top_k, len(idx) // 2 if cfg.long_short else len(idx)))
    order = idx[np.argsort(-score[idx], kind="mergesort")]      # 점수 높은 순
    longs = order[:k]

    def alloc(sel: np.ndarray, sign: float) -> None:
        if len(sel) == 0:
            return
        if cfg.weighting == "score":
            s = score[sel] - score[sel].min() + 1e-9
            ww = s / s.sum()
        else:
            ww = np.full(len(sel), 1.0 / len(sel))
        ww = np.minimum(ww, cfg.max_weight)                     # 한 종목 쏠림 방지
        ww = ww / ww.sum() if ww.sum() > 0 else ww
        w[sel] = sign * ww

    alloc(longs, 1.0)
    if cfg.long_short:
        alloc(order[-k:], -1.0)
    return w


def run_backtest(panel: Panel, scores: np.ndarray, ok: np.ndarray, cfg: Config,
                 lo: int, hi: int) -> Dict:
    """
    scores (T, N) 예측 점수 (예측이 없는 자리는 NaN)
    lo, hi          백테스트할 구간 (시험 구간)
    """
    close = panel.close
    T, N = close.shape
    hi = min(hi, T - 1)

    with np.errstate(invalid="ignore", divide="ignore"):
        ret = np.zeros((T, N))
        ret[1:] = close[1:] / close[:-1] - 1.0
    ret = np.where(np.isfinite(ret), ret, 0.0)

    cost_rate = cfg.cost_per_side + cfg.slippage

    w = np.zeros(N)               # 현재 비중
    bw = np.zeros(N)              # 벤치마크(동일가중) 비중
    dates, strat_net, strat_gross, bench_ret, turn_hist = [], [], [], [], []
    picks: List[Dict] = []
    last_rebalance = -10 ** 9

    for t in range(lo, hi):
        # --- (1) 리밸런싱 판단: t일 종가 기준 ---
        if t - last_rebalance >= cfg.rebalance and np.isfinite(scores[t]).any():
            usable = ok[t] & np.isfinite(close[t])
            target = _target_weights(scores[t], usable, cfg)
            turnover = float(np.abs(target - w).sum())
            cost = turnover * cost_rate
            w = target
            last_rebalance = t

            sel = np.where(w != 0)[0]
            order = sel[np.argsort(-w[sel])] if len(sel) else sel
            picks.append({
                "date": str(panel.dates[t]),
                "long": [panel.tickers[i] for i in order if w[i] > 0][: cfg.top_k],
                "short": [panel.tickers[i] for i in order if w[i] < 0][: cfg.top_k],
                "turnover": round(turnover, 4),
            })

            # 벤치마크도 같은 날 동일가중으로 맞춥니다
            bu = np.where(usable)[0]
            bw = np.zeros(N)
            if len(bu):
                bw[bu] = 1.0 / len(bu)
        else:
            turnover, cost = 0.0, 0.0

        # --- (2) 다음 날 수익률 반영 ---
        r_next = ret[t + 1]
        gross = float(np.dot(w, r_next))
        bench = float(np.dot(bw, r_next))

        dates.append(panel.dates[t + 1])
        strat_gross.append(gross)
        strat_net.append(gross - cost)
        bench_ret.append(bench)
        turn_hist.append(turnover)

        # --- (3) 비중 드리프트 (가격이 오른 종목의 비중이 저절로 커집니다) ---
        denom = 1.0 + gross
        if abs(denom) > 1e-9:
            w = w * (1.0 + r_next) / denom
        bdenom = 1.0 + bench
        if abs(bdenom) > 1e-9:
            bw = bw * (1.0 + r_next) / bdenom

    strat_net = np.array(strat_net)
    strat_gross = np.array(strat_gross)
    bench_ret = np.array(bench_ret)

    # 지수(벤치마크 시계열)가 따로 있으면 그것도 비교에 넣습니다
    index_ret: Optional[np.ndarray] = None
    if panel.bench is not None and np.isfinite(panel.bench).sum() > 10:
        b = panel.bench
        with np.errstate(invalid="ignore", divide="ignore"):
            br = np.zeros(T)
            br[1:] = b[1:] / b[:-1] - 1.0
        index_ret = np.nan_to_num(br[lo + 1: hi + 1])

    out = {
        "dates": np.array(dates),
        "strat_net": strat_net,
        "strat_gross": strat_gross,
        "bench": bench_ret,
        "index": index_ret,
        "turnover": np.array(turn_hist),
        "picks": picks,
        "perf_net": perf_stats(strat_net),
        "perf_gross": perf_stats(strat_gross),
        "perf_bench": perf_stats(bench_ret),
        "perf_index": perf_stats(index_ret) if index_ret is not None else None,
        "n_rebalance": len(picks),
        "avg_turnover": float(np.mean([p["turnover"] for p in picks])) if picks else float("nan"),
        "total_cost": float(np.sum(np.array(turn_hist) * cost_rate)),
    }

    # 초과수익(전략 - 동일가중)의 통계: 이게 진짜 실력 부분입니다
    excess = strat_net - bench_ret
    out["perf_excess"] = perf_stats(excess)
    return out
