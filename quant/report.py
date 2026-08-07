# -*- coding: utf-8 -*-
"""
report.py — 결과를 표와 그림으로 정리

숫자만 잔뜩 찍으면 읽히지 않습니다. 그래서
  - 표는 한글 폭을 맞춰 가지런히 출력하고
  - 그림은 자산 곡선 / IC 흐름 / 분위별 수익 세 장으로 요약합니다.
그림은 runs/<이름>/ 폴더에 PNG로 저장됩니다.
"""

from __future__ import annotations

import json
import os
import unicodedata
from typing import Dict, List, Sequence

import numpy as np


# ---------------------------------------------------------------------------
#  표 출력 (한글 폭 고려 — 다른 phase 스크립트와 같은 방식)
# ---------------------------------------------------------------------------
def _w(s) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in str(s))


def _pad(s, width, right=False) -> str:
    gap = max(0, width - _w(s))
    return (" " * gap + str(s)) if right else (str(s) + " " * gap)


def print_table(headers: Sequence[str], rows: Sequence[Sequence]) -> None:
    rows = [[("" if v is None else str(v)) for v in r] for r in rows]
    widths = [max([_w(headers[j])] + [_w(r[j]) for r in rows]) for j in range(len(headers))]

    def line(cells):
        return "   ".join(_pad(c, widths[j], right=(j != 0)) for j, c in enumerate(cells))

    print(line(headers))
    print("   ".join("-" * widths[j] for j in range(len(headers))))
    for r in rows:
        print(line(r))


def pct(x, d=2) -> str:
    return "—" if x is None or not np.isfinite(x) else f"{x * 100:.{d}f}%"


def sgn(x, d=2) -> str:
    return "—" if x is None or not np.isfinite(x) else f"{'+' if x >= 0 else ''}{x * 100:.{d}f}%"


def num(x, d=3) -> str:
    return "—" if x is None or not np.isfinite(x) else f"{x:.{d}f}"


# ---------------------------------------------------------------------------
#  그림
# ---------------------------------------------------------------------------
def _setup_matplotlib():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    korean = None
    for name in ("NanumGothic", "Malgun Gothic", "AppleGothic", "NanumBarunGothic",
                 "Noto Sans CJK KR", "Noto Sans KR", "UnDotum"):
        try:
            path = font_manager.findfont(name, fallback_to_default=False)
            if path and os.path.exists(path):
                korean = name
                break
        except Exception:
            continue
    if korean:
        plt.rcParams["font.family"] = korean
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.dpi"] = 120
    plt.rcParams["axes.grid"] = True
    plt.rcParams["grid.alpha"] = 0.25
    return plt, bool(korean)


# 한글 폰트가 없는 환경(서버 등)에서는 영문 라벨로 바꿔 글자가 깨지지 않게 합니다.
_KO = {
    "equity_title": "자산 곡선 (시작 = 1)", "strategy": "AI 전략 (비용 후)",
    "strategy_gross": "AI 전략 (비용 전)", "benchmark": "동일가중 벤치마크", "index": "시장지수",
    "ic_title": "IC 흐름 (60일 이동평균)", "ic_label": "IC", "zero": "0 (실력 없음)",
    "quant_title": "예측 분위별 실제 수익률", "quant_x": "예측 점수 낮음 → 높음",
    "quant_y": "평균 미래 수익률", "date": "날짜", "cum": "누적",
}
_EN = {
    "equity_title": "Equity curve (start = 1)", "strategy": "AI strategy (net)",
    "strategy_gross": "AI strategy (gross)", "benchmark": "Equal-weight benchmark", "index": "Index",
    "ic_title": "IC over time (60d moving average)", "ic_label": "IC", "zero": "0 (no skill)",
    "quant_title": "Forward return by predicted quantile", "quant_x": "low score -> high score",
    "quant_y": "mean forward return", "date": "date", "cum": "cumulative",
}


def make_figures(out_dir: str, bt: Dict, ic: np.ndarray, q_returns: List[float],
                 dates: np.ndarray) -> List[str]:
    plt, has_ko = _setup_matplotlib()
    L = _KO if has_ko else _EN
    os.makedirs(out_dir, exist_ok=True)
    paths = []

    # 1) 자산 곡선
    fig, ax = plt.subplots(figsize=(9, 4.2))
    x = bt["dates"]
    ax.plot(x, np.cumprod(1 + bt["strat_net"]), lw=2, label=L["strategy"])
    ax.plot(x, np.cumprod(1 + bt["strat_gross"]), lw=1.2, ls="--", label=L["strategy_gross"])
    ax.plot(x, np.cumprod(1 + bt["bench"]), lw=1.5, label=L["benchmark"])
    if bt.get("index") is not None:
        ax.plot(x, np.cumprod(1 + bt["index"]), lw=1.2, alpha=0.8, label=L["index"])
    ax.axhline(1.0, color="gray", lw=1, alpha=0.6)
    ax.set_title(L["equity_title"])
    ax.legend(loc="upper left", fontsize=8)
    fig.autofmt_xdate()
    p = os.path.join(out_dir, "equity.png")
    fig.tight_layout(); fig.savefig(p); plt.close(fig); paths.append(p)

    # 2) IC 흐름
    fig, ax = plt.subplots(figsize=(9, 3.4))
    s = np.array(ic, dtype=float)
    valid = np.isfinite(s)
    if valid.sum() > 60:
        k = 60
        roll = np.convolve(np.nan_to_num(s), np.ones(k) / k, mode="same")
        roll[~valid] = np.nan
        ax.plot(dates[: len(roll)], roll, lw=2, label=L["ic_label"])
    ax.axhline(0, color="gray", lw=1)
    ax.set_title(L["ic_title"])
    fig.autofmt_xdate()
    p = os.path.join(out_dir, "ic.png")
    fig.tight_layout(); fig.savefig(p); plt.close(fig); paths.append(p)

    # 3) 분위별 수익
    fig, ax = plt.subplots(figsize=(5.5, 3.4))
    qs = [0 if not np.isfinite(v) else v for v in q_returns]
    ax.bar(range(1, len(qs) + 1), [v * 100 for v in qs], color="#2a78d6")
    ax.axhline(0, color="gray", lw=1)
    ax.set_title(L["quant_title"])
    ax.set_xlabel(L["quant_x"])
    ax.set_ylabel(L["quant_y"] + " (%)")
    p = os.path.join(out_dir, "quantiles.png")
    fig.tight_layout(); fig.savefig(p); plt.close(fig); paths.append(p)

    return paths


# ---------------------------------------------------------------------------
#  본 보고서
# ---------------------------------------------------------------------------
def print_report(cfg, panel, bt: Dict, ic_stats: Dict, q_returns: List[float],
                 folds: List[Dict]) -> None:
    line = "=" * 78
    print("\n" + line)
    print(f" 결과 요약 — {cfg.name}  (모델 {cfg.model} · 예측시계 {cfg.horizon}일 · "
          f"리밸런싱 {cfg.rebalance}일 · 상위 {cfg.top_k}종목"
          + (" · 롱숏" if cfg.long_short else " · 롱온리") + ")")
    print(line)
    if panel.meta.get("synthetic"):
        print(" ※ 가상 데이터입니다. 실제 시장 성과가 아닙니다.")
    if panel.meta.get("note"):
        print(f" ※ {panel.meta['note']}")

    print("\n[1] 예측력 (IC — 예측 순위와 실제 수익률의 상관)")
    print_table(
        ["지표", "값", "읽는 법"],
        [
            ["IC 평균", num(ic_stats["ic_mean"], 4), "0.02~0.05면 쓸 만함, 0.3 이상이면 누수 의심"],
            ["RankIC 평균", num(ic_stats["rank_ic_mean"], 4), "순위만 본 IC. 이상치에 강함"],
            ["ICIR", num(ic_stats["icir"], 3), "IC평균/IC표준편차. 꾸준함의 척도"],
            ["IC t값", num(ic_stats["ic_t_stat"], 2), "|t|>2면 우연으로 보기 어려움"],
            ["IC>0 비율", pct(ic_stats["ic_positive_rate"], 1), "0.5면 동전 던지기"],
            ["관측일 수", f"{ic_stats['n_days']:,}일", f"겹치지 않는 표본 {ic_stats['n_independent']:,}개로 t값 계산"],
        ],
    )

    print("\n[2] 예측 분위별 실제 수익률 (낮은 점수 → 높은 점수)")
    rows = [[f"{i + 1}분위", sgn(v, 3), "상위 그룹이 하위 그룹보다 높아야 신호가 산다"] for i, v in enumerate(q_returns)]
    spread = (q_returns[-1] - q_returns[0]) if len(q_returns) >= 2 and np.isfinite(q_returns[0]) else float("nan")
    rows.append(["상-하위 차이", sgn(spread, 3), "이 값이 거래비용보다 커야 의미가 있다"])
    print_table(["분위", f"{cfg.horizon}일 평균수익", "설명"], rows)

    print("\n[3] 포트폴리오 성과")
    pn, pg, pb = bt["perf_net"], bt["perf_gross"], bt["perf_bench"]
    rows = [
        ["AI 전략 (비용 후)", sgn(pn["total"], 1), sgn(pn["cagr"], 1), num(pn["sharpe"], 2),
         pct(pn["mdd"], 1), pct(pn["hit"], 1)],
        ["AI 전략 (비용 전)", sgn(pg["total"], 1), sgn(pg["cagr"], 1), num(pg["sharpe"], 2),
         pct(pg["mdd"], 1), pct(pg["hit"], 1)],
        ["동일가중 벤치마크", sgn(pb["total"], 1), sgn(pb["cagr"], 1), num(pb["sharpe"], 2),
         pct(pb["mdd"], 1), pct(pb["hit"], 1)],
    ]
    if bt.get("perf_index"):
        pi = bt["perf_index"]
        rows.append(["시장지수", sgn(pi["total"], 1), sgn(pi["cagr"], 1), num(pi["sharpe"], 2),
                     pct(pi["mdd"], 1), pct(pi["hit"], 1)])
    print_table(["구분", "누적수익", "연평균", "샤프", "최대낙폭", "승률"], rows)

    pe = bt["perf_excess"]
    print(f"\n    초과수익(전략-벤치마크): 연 {sgn(pe['cagr'], 2)} · 샤프 {num(pe['sharpe'], 2)} · "
          f"t값 {num(pe['t_stat'], 2)}")
    print(f"    리밸런싱 {bt['n_rebalance']}회 · 평균 회전율 {num(bt['avg_turnover'], 2)} · "
          f"누적 거래비용 {pct(bt['total_cost'], 2)}")

    print("\n[4] 구간별 (워크포워드)")
    print_table(["구간", "학습일", "검증IC", "시험IC", "초"],
                [[f"{f['fold'] + 1}", f"{f['train'][1] - f['train'][0]:,}",
                  num(f["valid_ic"], 4), num(f["test_ic"], 4), f"{f['seconds']:.1f}"] for f in folds])

    print("\n[5] 최근 리밸런싱에서 고른 종목")
    for p in bt["picks"][-3:]:
        longs = ", ".join(p["long"][:10])
        print(f"    {p['date']}  매수: {longs}")
        if p["short"]:
            print(f"    {' ' * len(p['date'])}  공매도: {', '.join(p['short'][:10])}")

    print("\n" + line)
    verdict = _verdict(ic_stats, bt)
    print(" " + verdict)
    print(line + "\n")


def _verdict(ic_stats: Dict, bt: Dict) -> str:
    ic = ic_stats["ic_mean"]
    t = ic_stats["ic_t_stat"]
    ex = bt["perf_excess"]
    if not np.isfinite(ic):
        return "판단 불가: IC를 계산할 표본이 부족합니다."
    if ic > 0.25:
        return "경고: IC가 비정상적으로 높습니다. 데이터 누수를 의심하고 파이프라인을 점검하세요."
    if np.isfinite(t) and abs(t) > 2 and ic > 0:
        if ex["cagr"] > 0 and np.isfinite(ex["t_stat"]) and ex["t_stat"] > 1.5:
            return "예측력이 통계적으로 확인되고, 비용을 물린 뒤에도 벤치마크를 앞섰습니다. 다른 기간에서도 재현되는지 확인하세요."
        return "예측력은 있지만 거래비용을 물면 벤치마크 대비 우위가 사라집니다. 회전율을 낮추거나 예측시계를 늘려 보세요."
    return "이 설정에서는 예측력이 사실상 없습니다. 실패가 아니라 효율적 시장 가설과 어울리는 정직한 결과입니다."


def save_json(path: str, payload: Dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)

    def default(o):
        if isinstance(o, (np.floating, np.integer)):
            return float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.datetime64,)):
            return str(o)
        return str(o)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=default)
