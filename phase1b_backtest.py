# -*- coding: utf-8 -*-
# ============================================================================
#  Phase 1-b : 실무형 검증 (워크포워드 + 거래비용 백테스트)
#  영남대 SW중심대학사업단 AI·SW 러닝메이트 멘토링
# ----------------------------------------------------------------------------
#  이 파일이 답하려는 질문
#     "학술적 정확도(51%, 53%…)가 실제 투자에서도 의미가 있는가?"
#
#  핵심 메시지 (미리 말합니다)
#     정확도가 50%를 넘어도, 거래비용을 물고 나면 실제로는
#     '그냥 사서 들고 있기(Buy & Hold)'에 지는 경우가 많습니다.
#     이걸 정직하게 숫자로 확인하는 것이 이 파트의 목표입니다.
#
#  ★ 교육·연구용입니다. 실제 투자 판단에 쓰지 마세요.
#    백테스트가 좋아도 미래 수익을 보장하지 않습니다.
# ============================================================================

# ---------------------------------------------------------------------------
#  [0] 설치 : Colab에서 아래 줄 맨 앞 '#'을 지우고 한 번 실행하세요.
# ---------------------------------------------------------------------------
# !pip install fredapi scikit-learn xgboost matplotlib koreanize-matplotlib

# ===========================================================================
#  [1] 설정 (상수)
# ===========================================================================
FRED_API_KEY = ""          # ← 발급받은 FRED API 키를 이 따옴표 안에 붙여넣으세요.

PRICE_SERIES = "SP500"     # FRED 주가 시리즈 (S&P500)
RATE_SERIES  = "DGS2"      # FRED 금리 시리즈 (미국 2년물, %)
START = "2015-01-01"
END   = "2025-01-01"

HORIZON = 1                # 백테스트는 '내일 오를까'(1일)를 맞혀 하루씩 굴립니다.
START_FRAC = 0.60          # 워크포워드 시작 지점 (전체의 60%)
STEP = 50                  # 50거래일 예측 → 그 실제값을 학습셋에 추가 → 재학습 (반복)

COST_PER_SIDE = 0.0005     # 편도 거래비용 0.05% (사거나 팔 때 각각). 왕복이면 0.1%.
SLIPPAGE      = 0.0005     # 슬리피지(체결 미끄러짐) 0.05%. 더 현실적으로. 0으로 두면 무시.

TRADING_DAYS = 252         # 연율화에 쓰는 1년 거래일 수
MODELS = ["RandomForest", "XGBoost"]   # 백테스트할 모델 (트리 계열: 재학습이 빨라 워크포워드에 적합)
SEED = 42

# 특징(feature) — 모두 정상성 있는 값
BASE_FEATURES = ["return", "px_vs_ma5", "px_vs_ma20", "ma5_vs_ma20"]
RATE_FEATURES = ["rate_change", "rate_change_20"]
ALL_FEATURES  = BASE_FEATURES + RATE_FEATURES

# ===========================================================================
#  [2] 임포트 & 재현성
# ===========================================================================
import os, random, warnings
os.environ.setdefault("PYTHONHASHSEED", str(SEED))
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.ensemble import RandomForestClassifier
random.seed(SEED); np.random.seed(SEED)


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
#  [3] 데이터 (Phase 1-a와 동일한 방식 — 파일 하나로 완결되게 다시 담음)
# ===========================================================================
def load_data():
    try:
        from fredapi import Fred
    except ImportError:
        raise SystemExit("[오류] fredapi가 없습니다. 맨 위 [0] 설치 줄을 먼저 실행하세요.")
    if not FRED_API_KEY:
        raise SystemExit("[오류] FRED_API_KEY가 비어 있습니다. [1] 설정에서 키를 채워주세요.")
    try:
        fred = Fred(api_key=FRED_API_KEY)
        price = fred.get_series(PRICE_SERIES, START, END)
        rate  = fred.get_series(RATE_SERIES,  START, END)
    except Exception as e:
        raise SystemExit(f"[오류] FRED 다운로드 실패: {e}")
    df = pd.concat({"close": price, "rate": rate}, axis=1).dropna().sort_index()
    if len(df) < 500:
        raise SystemExit(f"[오류] 표본이 너무 적습니다({len(df)}개).")
    print(f"[데이터] {df.index.min().date()} ~ {df.index.max().date()}, {len(df):,}개 거래일")
    return df


def make_features(df):
    d = df.copy()
    d["return"] = d["close"].pct_change()
    ma5, ma20 = d["close"].rolling(5).mean(), d["close"].rolling(20).mean()
    d["px_vs_ma5"]   = d["close"] / ma5 - 1
    d["px_vs_ma20"]  = d["close"] / ma20 - 1
    d["ma5_vs_ma20"] = ma5 / ma20 - 1
    d["rate_change"]    = d["rate"].diff()
    d["rate_change_20"] = d["rate"].diff(20)
    return d


def build_supervised(df, feature_cols, horizon):
    """목표 = horizon일 뒤 상승(1)/하락(0). 특징은 오늘까지 정보만 사용(누수 방지)."""
    d = df.copy()
    future = d["close"].shift(-horizon)
    d["target"] = np.where(future > d["close"], 1.0, 0.0)
    d.loc[future.isna(), "target"] = np.nan
    d = d.dropna(subset=feature_cols + ["return"])
    d = d.dropna(subset=["target"])
    return d


# ===========================================================================
#  [4] 워크포워드 검증 (확장 윈도우)
# ---------------------------------------------------------------------------
#  실무에서는 한 번 학습하고 끝이 아니라, 시간이 지나며 새 데이터로 다시 배웁니다.
#   - 전체의 60% 지점부터 시작
#   - 다음 50거래일을 (그 시점의 모델로) 예측
#   - 그 50일의 '실제값'을 학습셋에 추가하고 재학습
#   - 끝까지 반복
#  단순 80/20 분할보다 현실적이며, 보통 결과가 더 나쁘게 나옵니다. 그 차이가 발견입니다.
# ===========================================================================
def make_model(name):
    if name == "RandomForest":
        return RandomForestClassifier(n_estimators=200, max_depth=6,
                                      random_state=SEED, n_jobs=-1)
    if name == "XGBoost":
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05,
                             subsample=0.9, colsample_bytree=0.9,
                             random_state=SEED, eval_metric="logloss", n_jobs=-1)
    raise ValueError(name)


def walk_forward(sup, feature_cols, model_name, start_frac, step):
    n = len(sup)
    start = int(n * start_frac)
    X = sup[feature_cols].values
    y = sup["target"].values.astype(int)

    preds = np.full(n, np.nan)
    n_retrains = 0
    i = start
    while i < n:
        end = min(i + step, n)
        # 학습셋 = 지금(i)까지 '정답이 확정된' 행들만. 미래 정보 없음.
        m = make_model(model_name)
        m.fit(X[:i], y[:i])
        preds[i:end] = m.predict(X[i:end])
        n_retrains += 1
        i = end
    return preds, start, n_retrains


# ===========================================================================
#  [5] 백테스트 & 실무 지표
# ---------------------------------------------------------------------------
#  전략: 모델이 '오를 것'이라 하면 지수 보유(포지션 1), '내릴 것'이라 하면 현금(0).
#        (공매도 없이 매수/현금만 오가는 '마켓 타이밍' 전략)
#  누수 방지: 오늘 보유할 포지션은 '어제까지의 정보로 만든 예측'만 씁니다.
# ===========================================================================
def backtest(sup, preds, start):
    n = len(sup)
    ret = sup["return"].values                      # ret[t] = 오늘 시장 수익률
    idx = sup.index

    t = np.arange(start + 1, n)                      # 백테스트 대상 날들
    position = preds[t - 1]                          # 오늘 포지션 = 어제 만든 예측 (누수 차단)
    mkt = ret[t]                                     # 오늘 시장 수익률

    strat_gross = position * mkt                     # 비용 전 전략 수익률
    # 포지션이 바뀔 때만 비용. 시작은 현금(0)에서 출발.
    prev = np.concatenate([[0.0], position[:-1]])
    trades = np.abs(position - prev)                 # 1이면 이날 매매 발생
    cost = (COST_PER_SIDE + SLIPPAGE) * trades
    strat_net = strat_gross - cost                   # 비용 후 전략 수익률
    bh = mkt                                          # 벤치마크: 매수 후 보유

    return pd.DataFrame({
        "strat_gross": strat_gross,
        "strat_net": strat_net,
        "bh": bh,
        "position": position,
        "trade": trades,
        "cost": cost,
    }, index=idx[t])


def perf_metrics(daily_ret):
    r = np.asarray(daily_ret, dtype=float)
    cum = np.cumprod(1 + r)
    total = cum[-1] - 1
    years = len(r) / TRADING_DAYS
    cagr = (cum[-1]) ** (1 / years) - 1 if years > 0 else np.nan
    sharpe = (r.mean() / r.std() * np.sqrt(TRADING_DAYS)) if r.std() > 0 else np.nan
    peak = np.maximum.accumulate(cum)
    mdd = (cum / peak - 1).min()
    return dict(total=total, cagr=cagr, sharpe=sharpe, mdd=mdd, cum=cum)


def summarize(bt, model_name, n_retrains):
    m_strat = perf_metrics(bt["strat_net"])
    m_bh    = perf_metrics(bt["bh"])
    n_trades = int(bt["trade"].sum())
    total_cost = bt["cost"].sum()
    invested = bt["position"] == 1
    win_rate = (bt.loc[invested, "bh"] > 0).mean() if invested.any() else np.nan

    print("\n" + "=" * 66)
    print(f"[백테스트 결과] 모델 = {model_name}  (재학습 {n_retrains}회)")
    print("=" * 66)
    print(f"{'항목':<22}{'전략(비용후)':>16}{'매수후보유(B&H)':>18}")
    print(f"{'총수익률':<22}{m_strat['total']*100:>15.1f}%{m_bh['total']*100:>17.1f}%")
    print(f"{'연환산수익률(CAGR)':<20}{m_strat['cagr']*100:>15.1f}%{m_bh['cagr']*100:>17.1f}%")
    print(f"{'샤프지수(연율)':<21}{m_strat['sharpe']:>16.2f}{m_bh['sharpe']:>18.2f}")
    print(f"{'최대낙폭(MDD)':<21}{m_strat['mdd']*100:>15.1f}%{m_bh['mdd']*100:>17.1f}%")
    print(f"{'매매 횟수':<22}{n_trades:>16}{'-':>18}")
    print(f"{'총 거래비용':<21}{total_cost*100:>15.1f}%{'-':>18}")
    print(f"{'보유일 승률':<21}{win_rate*100:>15.1f}%{'-':>18}")

    # --- 정직한 판정 ---
    print("\n[정직한 판정]")
    beat = m_strat["total"] > m_bh["total"]
    if beat:
        print(f"  · 전략이 매수후보유를 이겼습니다 (+{(m_strat['total']-m_bh['total'])*100:.1f}%p).")
        print("    단, 백테스트 승리가 미래 수익을 보장하지 않습니다. 시도 횟수(다중검정)를 기억하세요.")
    else:
        print(f"  · 전략이 매수후보유에 졌습니다 ({(m_strat['total']-m_bh['total'])*100:.1f}%p).")
    gross_total = perf_metrics(bt["strat_gross"])["total"]
    print(f"  · 거래비용을 빼기 전 총수익 {gross_total*100:.1f}% → 뺀 후 {m_strat['total']*100:.1f}% "
          f"(비용이 {total_cost*100:.1f}%를 갉아먹음).")
    if gross_total > m_bh["total"] and not beat:
        print("    ★ '비용을 빼면 수익이 사라진다'는 이 파트의 핵심 메시지가 그대로 관측됩니다.")
    return dict(strat=m_strat, bh=m_bh, n_trades=n_trades,
                total_cost=total_cost, win_rate=win_rate)


# ===========================================================================
#  [6] 시각화
# ===========================================================================
def plot_equity(bt, model_name):
    m_s = perf_metrics(bt["strat_net"]); m_b = perf_metrics(bt["bh"])
    plt.figure(figsize=(11, 4.5))
    plt.plot(bt.index, m_s["cum"], label="전략(비용 후)", color="tab:blue")
    plt.plot(bt.index, m_b["cum"], label="매수 후 보유(B&H)", color="tab:gray", linestyle="--")
    plt.axhline(1.0, color="black", linewidth=0.6)
    plt.ylabel("누적 자산 (시작=1)")
    plt.title(f"누적 수익 곡선 — {model_name}")
    plt.legend(); plt.tight_layout(); plt.show()


def plot_drawdown(bt, model_name):
    cum = perf_metrics(bt["strat_net"])["cum"]
    dd = cum / np.maximum.accumulate(cum) - 1
    plt.figure(figsize=(11, 3))
    plt.fill_between(bt.index, dd * 100, 0, color="tab:red", alpha=0.4)
    plt.ylabel("낙폭(%)"); plt.title(f"전략 낙폭(Drawdown) — {model_name}")
    plt.tight_layout(); plt.show()


# ===========================================================================
#  [7] 메인
# ===========================================================================
def main():
    setup_korean_font()
    raw = load_data()
    df = make_features(raw)
    sup = build_supervised(df, ALL_FEATURES, HORIZON)
    print(f"[준비] 지도학습 표본 {len(sup):,}개, 상승비율 {sup['target'].mean():.3f}")

    results = {}
    for name in MODELS:
        preds, start, n_ret = walk_forward(sup, ALL_FEATURES, name, START_FRAC, STEP)
        # 워크포워드 예측 정확도(참고): 단순 80/20보다 보통 낮게 나옵니다.
        mask = ~np.isnan(preds)
        acc = (preds[mask] == sup["target"].values[mask]).mean()
        p_up = sup["target"].values[mask].mean()
        base = max(p_up, 1 - p_up)
        print(f"\n[워크포워드] {name}: 예측 정확도 {acc:.3f} (기준선 {base:.3f}, "
              f"차이 {acc-base:+.3f})")
        bt = backtest(sup, preds, start)
        results[name] = summarize(bt, name, n_ret)
        plot_equity(bt, name)
        plot_drawdown(bt, name)

    print("\n" + "=" * 66)
    print(f"[다중검정 주의] 이번에 백테스트한 전략 수 = {len(MODELS)}개.")
    print("  여러 전략을 시도할수록 우연히 좋은 하나가 나올 확률이 커집니다.")
    print("  López de Prado는 '시도 횟수만큼 샤프지수를 할인(deflate)하라'고 권고합니다.")
    print("[마무리] 교육·연구용 코드입니다. 실제 투자에 사용하지 마세요.")
    print("=" * 66)


if __name__ == "__main__":
    main()
