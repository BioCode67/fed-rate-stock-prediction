# -*- coding: utf-8 -*-
# ============================================================================
#  Phase 3 : 개별 종목 횡단면(cross-section) 순위 예측 (실무 축소 재현)
#  영남대 SW중심대학사업단 AI·SW 러닝메이트 멘토링
# ----------------------------------------------------------------------------
#  실무는 "지수가 오를까"를 맞히지 않고, 여러 종목의 '상대적 순위'를 예측해
#  상위를 사고 하위를 팝니다. 이를 축소 재현합니다.
#  (Gu, Kelly & Xiu(2020)가 하는 것이 정확히 이것)
#
#  질문: "종목 순위 예측 포트폴리오가 코스피 지수를 이기는가?" (가설 H7)
#
#  ★ 반드시 밝힐 한계 — 생존 편향(Survivorship Bias)
#     지금 상장된 종목만 쓰면, 지난 10년간 상장폐지된 회사가 표본에서 빠집니다.
#     그 결과 성과가 '실제보다 좋게' 나옵니다. 이 한계를 발표에 반드시 밝히세요.
#     (피하려면 과거 시점의 상장 종목 리스트가 필요한데 무료로 구하기 어렵습니다.)
#
#  ★ 교육·연구용입니다. 실제 투자 판단에 쓰지 마세요.
# ============================================================================

# ---------------------------------------------------------------------------
#  [0] 설치 : Colab에서 아래 줄 맨 앞 '#'을 지우고 한 번 실행하세요.
# ---------------------------------------------------------------------------
# !pip install yfinance scikit-learn xgboost scipy matplotlib koreanize-matplotlib

# ===========================================================================
#  [1] 설정
# ===========================================================================
START = "2015-01-01"
END   = "2025-01-01"
BENCHMARK = "^KS11"        # 코스피 지수 (벤치마크)

TOP_N = 10                 # 매달 상위 몇 종목을 살지
WARMUP_MONTHS = 36         # 처음 몇 개월은 학습용으로만 쓰고 투자 시작은 그 이후
COST_PER_SIDE = 0.0005     # 편도 거래비용 0.05% (월 리밸런싱은 거래가 잦음)
MODELS = ["RandomForest", "XGBoost"]
SEED = 42

# 코스피 주요 종목 (yfinance 코드, .KS). ※ '현재 상장 종목' 표본 → 생존편향 있음(위 경고 참조).
#   더 많은 종목을 넣을수록 좋습니다(코스피100 지향). 다운로드 실패 종목은 자동 제외됩니다.
TICKERS = [
    "005930.KS","000660.KS","373220.KS","207940.KS","005380.KS","000270.KS","068270.KS",
    "035420.KS","035720.KS","005490.KS","051910.KS","006400.KS","105560.KS","055550.KS",
    "086790.KS","012330.KS","096770.KS","066570.KS","028260.KS","015760.KS","017670.KS",
    "033780.KS","032830.KS","010130.KS","011200.KS","316140.KS","402340.KS","009150.KS",
    "003550.KS","009830.KS","090430.KS","323410.KS","034020.KS","267250.KS","010950.KS",
    "006800.KS","036570.KS","251270.KS","032640.KS","030200.KS","000810.KS","021240.KS",
    "003670.KS","161390.KS","011780.KS","047050.KS","018260.KS","010140.KS","004020.KS",
]

# ===========================================================================
#  [2] 임포트 & 재현성
# ===========================================================================
import os, warnings, unicodedata
os.environ.setdefault("PYTHONHASHSEED", str(SEED))
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.ensemble import RandomForestRegressor
np.random.seed(SEED)

FEATURES = ["mom_1m", "mom_6m", "mom_12m", "vol_6m", "volume_change"]


# 표를 한글 폭까지 맞춰 출력하는 도우미 (Colab에서 한글 표가 어긋나는 것을 방지)
def _disp_width(s):
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in str(s))


def _pad(s, width, right=False):
    gap = max(0, width - _disp_width(s))
    return (" " * gap + str(s)) if right else (str(s) + " " * gap)


def print_table(df, index=False):
    df = df.reset_index() if index else df.copy()
    headers = [str(c) for c in df.columns]
    def cell(v):
        return "" if (v is None or (isinstance(v, float) and pd.isna(v))) else str(v)
    rows = [[cell(v) for v in r] for r in df.itertuples(index=False, name=None)]
    widths = [max([_disp_width(headers[j])] + [_disp_width(r[j]) for r in rows])
              for j in range(len(headers))]
    def line(cells):
        return "   ".join(_pad(c, widths[j], right=(j != 0)) for j, c in enumerate(cells))
    print(line(headers))
    print("   ".join("-" * widths[j] for j in range(len(headers))))
    for r in rows:
        print(line(r))


def setup_korean_font():
    import matplotlib as mpl, matplotlib.font_manager as fm
    try:
        import koreanize_matplotlib; return
    except Exception:
        pass
    for name in ["NanumGothic", "Malgun Gothic", "AppleGothic", "NanumBarunGothic"]:
        try:
            fm.findfont(name, fallback_to_default=False)
            mpl.rcParams["font.family"] = name; break
        except Exception:
            continue
    mpl.rcParams["axes.unicode_minus"] = False


# ===========================================================================
#  [3] 데이터 다운로드 (yfinance) — API 키 불필요
# ===========================================================================
def download_prices(tickers):
    try:
        import yfinance as yf
    except ImportError:
        raise SystemExit("[오류] yfinance가 없습니다. 맨 위 [0] 설치 줄을 먼저 실행하세요.")
    data = yf.download(tickers, start=START, end=END, auto_adjust=True,
                       progress=False, group_by="column")
    close = data["Close"].copy()
    volume = data["Volume"].copy()
    # 결측이 너무 많은 종목(상장 늦음 등) 제외
    good = close.columns[close.notna().mean() > 0.6]
    close, volume = close[good], volume[good]
    print(f"[다운로드] 요청 {len(tickers)}종목 → 사용 가능 {close.shape[1]}종목")
    bench = yf.download(BENCHMARK, start=START, end=END, auto_adjust=True, progress=False)
    bench_close = bench["Close"].squeeze()
    return close, volume, bench_close


# ===========================================================================
#  [4] 월별 특징 & 목표 만들기 (모두 정상성 있는 값)
# ---------------------------------------------------------------------------
#  특징(오늘까지 정보만 사용):
#    mom_1m/6m/12m : 과거 1/6/12개월 수익률 (모멘텀). 12개월은 직전 1개월 제외(12-1).
#    vol_6m        : 과거 6개월 월수익률 변동성
#    volume_change : 최근 거래량 / 6개월 평균 거래량 - 1
#  목표: '다음 달' 수익률 (미래) → 이것의 '횡단면 순위'를 맞힙니다.
# ===========================================================================
def build_panel(close, volume):
    m_close = close.resample("ME").last()
    m_ret = m_close.pct_change()
    m_vol = volume.resample("ME").mean()

    mom_1m  = m_ret
    mom_6m  = m_close / m_close.shift(6) - 1
    mom_12m = m_close.shift(1) / m_close.shift(12) - 1
    vol_6m  = m_ret.rolling(6).std()
    volume_change = m_vol / m_vol.rolling(6).mean() - 1
    target = m_ret.shift(-1)                            # 다음 달 수익률 (미래)

    frames = []
    for t in m_close.columns:
        d = pd.DataFrame({
            "date": m_close.index, "ticker": t,
            "mom_1m": mom_1m[t], "mom_6m": mom_6m[t], "mom_12m": mom_12m[t],
            "vol_6m": vol_6m[t], "volume_change": volume_change[t],
            "target": target[t],
        })
        frames.append(d)
    panel = pd.concat(frames, ignore_index=True)
    panel = panel.dropna(subset=FEATURES + ["target"])
    return panel


# ===========================================================================
#  [5] 워크포워드 횡단면 순위 예측 & 포트폴리오
# ---------------------------------------------------------------------------
#  매달: 그 달 이전의 모든 (종목, 월) 데이터로 학습 → 이번 달 종목들의 다음 달 수익률 예측
#        → 예측값 상위 TOP_N 종목을 동일비중 매수 → 실제 다음 달 수익률을 얻음.
#  누수 방지: 특징은 그 달까지의 정보만, 목표는 다음 달. 학습은 '과거'만.
# ===========================================================================
def make_model(name):
    if name == "RandomForest":
        return RandomForestRegressor(n_estimators=200, max_depth=6,
                                     random_state=SEED, n_jobs=-1)
    if name == "XGBoost":
        from xgboost import XGBRegressor
        return XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05,
                            subsample=0.9, colsample_bytree=0.9,
                            random_state=SEED, n_jobs=-1)
    raise ValueError(name)


def walk_forward_portfolio(panel, model_name, top_n, warmup_months, cost_per_side):
    months = np.sort(panel["date"].unique())
    test_months = months[warmup_months:]

    strat_ret, ew_ret, dates = [], [], []
    prev_holdings = set()
    for m in test_months:
        train = panel[panel["date"] < m]
        test = panel[panel["date"] == m]
        if len(train) < 200 or len(test) < top_n + 2:
            continue
        model = make_model(model_name)
        model.fit(train[FEATURES].values, train["target"].values)
        test = test.assign(pred=model.predict(test[FEATURES].values))
        picks = test.sort_values("pred", ascending=False).head(top_n)

        gross = picks["target"].mean()                 # 상위 종목 동일비중 다음달 수익
        holdings = set(picks["ticker"])
        turnover = len(holdings - prev_holdings) / top_n
        cost = turnover * 2 * cost_per_side            # 바뀐 비중만큼 왕복 비용
        strat_ret.append(gross - cost)
        ew_ret.append(test["target"].mean())           # 전체 종목 동일비중(참고용 벤치마크)
        dates.append(pd.Timestamp(m))
        prev_holdings = holdings

    return pd.DataFrame({"strat": strat_ret, "ew": ew_ret}, index=pd.DatetimeIndex(dates))


# ===========================================================================
#  [6] 성과 지표
# ===========================================================================
def perf(monthly_ret):
    r = np.asarray(monthly_ret, dtype=float)
    cum = np.cumprod(1 + r)
    total = cum[-1] - 1
    sharpe = (r.mean() / r.std() * np.sqrt(12)) if r.std() > 0 else np.nan   # 월→연 환산
    mdd = (cum / np.maximum.accumulate(cum) - 1).min()
    return dict(total=total, sharpe=sharpe, mdd=mdd, cum=cum)


def benchmark_monthly(bench_close, index):
    b = bench_close.resample("ME").last().pct_change()
    return b.reindex(index)


def summarize(port, model_name, bench_m):
    ps = perf(port["strat"])
    bench = bench_m.reindex(port.index).fillna(0.0)
    pb = perf(bench.values)
    print("\n" + "=" * 60)
    print(f"[포트폴리오] {model_name} — 상위 {TOP_N}종목 동일비중 (비용 후)")
    print("=" * 60)
    tbl = pd.DataFrame({
        "항목": ["총수익률", "샤프지수", "최대낙폭"],
        "전략": [f"{ps['total']*100:.1f}%", f"{ps['sharpe']:.2f}", f"{ps['mdd']*100:.1f}%"],
        "코스피(벤치)": [f"{pb['total']*100:.1f}%", f"{pb['sharpe']:.2f}", f"{pb['mdd']*100:.1f}%"],
    })
    print_table(tbl)
    win = "이김" if ps["total"] > pb["total"] else "짐"
    print(f"\n[정직한 판정] 전략이 코스피를 {win} "
          f"({(ps['total']-pb['total'])*100:+.1f}%p)")
    if ps["total"] <= pb["total"]:
        print("  · H7(순위예측이 지수를 이긴다) 기각 방향. 그대로 보고합니다.")
    print("  · ★ 생존편향으로 성과가 실제보다 좋게 나올 수 있음을 반드시 기억하세요.")
    return ps, pb


# ===========================================================================
#  [7] 시각화
# ===========================================================================
def plot_equity(port, bench_m, model_name):
    ps = perf(port["strat"])
    bench = bench_m.reindex(port.index).fillna(0.0)
    pb = perf(bench.values)
    plt.figure(figsize=(11, 4.5))
    plt.plot(port.index, ps["cum"], label="전략(상위종목)", color="tab:blue")
    plt.plot(port.index, pb["cum"], label="코스피(벤치)", color="tab:gray", linestyle="--")
    plt.axhline(1.0, color="black", lw=0.6)
    plt.ylabel("누적 자산 (시작=1)"); plt.title(f"횡단면 순위 전략 vs 코스피 — {model_name}")
    plt.legend(); plt.tight_layout(); plt.show()


# ===========================================================================
#  [8] 메인
# ===========================================================================
def main():
    setup_korean_font()
    print("=" * 60)
    print("[Phase 3] 개별 종목 횡단면 순위 예측 포트폴리오")
    print("=" * 60)
    close, volume, bench_close = download_prices(TICKERS)
    panel = build_panel(close, volume)
    print(f"[패널] {panel['ticker'].nunique()}종목 × 월별 관측 {len(panel):,}행")

    bench_m = None
    for name in MODELS:
        port = walk_forward_portfolio(panel, name, TOP_N, WARMUP_MONTHS, COST_PER_SIDE)
        if bench_m is None:
            bench_m = benchmark_monthly(bench_close, port.index)
        summarize(port, name, bench_m)
        plot_equity(port, bench_m, name)

    print("\n" + "=" * 60)
    print("[한계 — 반드시 발표에 명시]")
    print("  1) 생존편향: 현재 상장 종목만 사용 → 성과 과대평가 가능")
    print("  2) 표본/기간 제한, 월 리밸런싱 거래비용 가정")
    print("  3) 교육·연구용. 실제 투자에 사용 금지.")
    print("=" * 60)


if __name__ == "__main__":
    main()
