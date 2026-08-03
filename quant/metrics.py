# -*- coding: utf-8 -*-
"""
metrics.py — 퀀트에서 실제로 쓰는 성적표

정확도는 여기서 주인공이 아닙니다. 대신 이런 것들을 봅니다.

  IC       날마다 '예측 순위'와 '실제 수익률'이 얼마나 같은 방향인지(상관계수).
           0.02~0.05면 쓸 만하고, 0.1을 넘으면 아주 좋은 신호입니다.
           0.3처럼 크면 거의 확실히 뭔가 잘못된 것입니다(누수).
  ICIR     IC의 평균 ÷ IC의 표준편차. 꾸준한지를 봅니다. 높을수록 안정적입니다.
  t값      그 IC가 우연이 아닐 가능성. |t| > 2 면 우연으로 보기 어렵습니다.
  분위 수익 상위 10%와 하위 10% 종목의 실제 수익 차이. 이게 벌어져야 돈이 됩니다.
  샤프     위험 대비 수익. 최대낙폭(MDD)과 함께 봅니다.
"""

from __future__ import annotations

from typing import Dict, List

import numpy as np


TRADING_DAYS = 252


def _rank(a: np.ndarray) -> np.ndarray:
    order = a.argsort(kind="mergesort")
    r = np.empty(len(a), dtype=np.float64)
    r[order] = np.arange(len(a), dtype=np.float64)
    return r


def daily_ic(score: np.ndarray, fwd: np.ndarray, ok: np.ndarray, min_stocks: int = 10):
    """날짜별 IC(피어슨)와 RankIC(스피어만)를 계산합니다."""
    T = score.shape[0]
    ic = np.full(T, np.nan)
    ric = np.full(T, np.nan)
    for t in range(T):
        m = ok[t] & np.isfinite(score[t]) & np.isfinite(fwd[t])
        if m.sum() < min_stocks:
            continue
        s, f = score[t, m].astype(np.float64), fwd[t, m].astype(np.float64)
        if s.std() < 1e-12 or f.std() < 1e-12:
            continue
        ic[t] = np.corrcoef(s, f)[0, 1]
        rs, rf = _rank(s), _rank(f)
        ric[t] = np.corrcoef(rs, rf)[0, 1]
    return ic, ric


def summarize_ic(ic: np.ndarray, ric: np.ndarray, sample_every: int = 1) -> Dict[str, float]:
    """
    sample_every: 겹치는 라벨(예: 5일 뒤 수익률을 매일 계산)은 서로 강하게 닮아 있어
                  t값이 부풀려집니다. horizon 간격으로 띄엄띄엄 뽑아 계산합니다.
    """
    v = ic[np.isfinite(ic)]
    rv = ric[np.isfinite(ric)]
    idx = np.where(np.isfinite(ic))[0][::max(1, sample_every)]
    indep = ic[idx]
    indep = indep[np.isfinite(indep)]
    n = len(indep)
    t = float(indep.mean() / (indep.std(ddof=1) / np.sqrt(n))) if n > 2 and indep.std() > 0 else float("nan")
    return {
        "ic_mean": float(v.mean()) if len(v) else float("nan"),
        "ic_std": float(v.std()) if len(v) else float("nan"),
        "icir": float(v.mean() / v.std()) if len(v) and v.std() > 0 else float("nan"),
        "rank_ic_mean": float(rv.mean()) if len(rv) else float("nan"),
        "ic_t_stat": t,
        "ic_positive_rate": float((v > 0).mean()) if len(v) else float("nan"),
        "n_days": int(len(v)),
        "n_independent": int(n),
    }


def quantile_returns(score: np.ndarray, fwd: np.ndarray, ok: np.ndarray,
                     n_q: int = 5, min_stocks: int = 20) -> List[float]:
    """예측 점수로 종목을 n_q개 그룹으로 나눴을 때 각 그룹의 평균 실제 수익률."""
    sums = np.zeros(n_q)
    cnts = np.zeros(n_q)
    for t in range(score.shape[0]):
        m = ok[t] & np.isfinite(score[t]) & np.isfinite(fwd[t])
        if m.sum() < min_stocks:
            continue
        s, f = score[t, m], fwd[t, m]
        r = _rank(s) / max(1, (m.sum() - 1))
        q = np.clip((r * n_q).astype(int), 0, n_q - 1)
        for k in range(n_q):
            sel = q == k
            if sel.any():
                sums[k] += f[sel].mean()
                cnts[k] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        return list(np.where(cnts > 0, sums / np.maximum(cnts, 1), np.nan))


def perf_stats(daily_ret: np.ndarray) -> Dict[str, float]:
    r = np.asarray(daily_ret, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 2:
        return {k: float("nan") for k in
                ("total", "cagr", "vol", "sharpe", "sortino", "mdd", "hit", "t_stat", "years")}
    cum = np.cumprod(1.0 + r)
    years = len(r) / TRADING_DAYS
    peak = np.maximum.accumulate(cum)
    mdd = float((cum / peak - 1.0).min())
    downside = r[r < 0]
    sd = r.std(ddof=1)
    return {
        "total": float(cum[-1] - 1.0),
        "cagr": float(cum[-1] ** (1 / years) - 1.0) if years > 0 else float("nan"),
        "vol": float(sd * np.sqrt(TRADING_DAYS)),
        "sharpe": float(r.mean() / sd * np.sqrt(TRADING_DAYS)) if sd > 0 else float("nan"),
        "sortino": float(r.mean() / downside.std(ddof=1) * np.sqrt(TRADING_DAYS))
        if len(downside) > 2 and downside.std(ddof=1) > 0 else float("nan"),
        "mdd": mdd,
        "hit": float((r > 0).mean()),
        "t_stat": float(r.mean() / (sd / np.sqrt(len(r)))) if sd > 0 else float("nan"),
        "years": float(years),
    }


def equity_curve(daily_ret: np.ndarray) -> np.ndarray:
    r = np.nan_to_num(np.asarray(daily_ret, dtype=float))
    return np.cumprod(1.0 + r)
