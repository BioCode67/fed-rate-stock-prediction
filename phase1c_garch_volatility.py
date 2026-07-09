# -*- coding: utf-8 -*-
# ============================================================================
#  Phase 1-c : GARCH 변동성 분석 (별도 파트)
#  영남대 SW중심대학사업단 AI·SW 러닝메이트 멘토링
# ----------------------------------------------------------------------------
#  ★ 주의: GARCH는 '방향(오를까/내릴까)'을 맞히는 모델이 아닙니다.
#          '변동성(얼마나 출렁이나)'을 다루는 모델입니다.
#          그래서 Phase 1-a의 정확도 표에 절대 넣지 않고, 독립된 질문으로 봅니다.
#
#  이 파일이 답하려는 질문
#     "금리 정책 발표(FOMC)나 금리 급변이 시장 '변동성'을 키우는가?"
#
#  변동성(volatility)이란: 수익률이 위아래로 얼마나 심하게 흔들리는지의 정도.
#                         값이 크면 '불안정', 작으면 '잠잠'.
#  GARCH란: 오늘의 변동성이 어제의 충격과 어제의 변동성에 의존한다고 보는 모델.
#           "변동성은 뭉쳐서 온다(volatility clustering)"는 현상을 잡아냅니다.
# ============================================================================

# ---------------------------------------------------------------------------
#  [0] 설치 : Colab에서 아래 줄 맨 앞 '#'을 지우고 한 번 실행하세요.
# ---------------------------------------------------------------------------
# !pip install fredapi arch scipy matplotlib koreanize-matplotlib

# ===========================================================================
#  [1] 설정
# ===========================================================================
FRED_API_KEY = ""          # ← 발급받은 FRED API 키를 이 따옴표 안에 붙여넣으세요.
PRICE_SERIES = "SP500"
RATE_SERIES  = "DGS2"
START = "2015-01-01"
END   = "2025-01-01"

EVENT_NEXT_DAY = True      # FOMC 발표 '다음 날'까지 이벤트 창에 포함할지 (반응이 하루 늦게 오기도 함)
BIG_MOVE_Q = 0.75          # 금리 변화 '큰 날' 기준: |금리변화| 상위 25%(0.75 분위 초과)
SEED = 42

# 미국 FOMC 정책 발표일 (federalreserve.gov 원문 기준, 2015~2024).
# ※ 실제 공개 일정입니다(지어낸 값이 아님). 2020년은 코로나 긴급 인하일(3/3, 3/16 반응일) 포함.
FOMC_DATES = [
    "2015-01-28","2015-03-18","2015-04-29","2015-06-17","2015-07-29","2015-09-17","2015-10-28","2015-12-16",
    "2016-01-27","2016-03-16","2016-04-27","2016-06-15","2016-07-27","2016-09-21","2016-11-02","2016-12-14",
    "2017-02-01","2017-03-15","2017-05-03","2017-06-14","2017-07-26","2017-09-20","2017-11-01","2017-12-13",
    "2018-01-31","2018-03-21","2018-05-02","2018-06-13","2018-08-01","2018-09-26","2018-11-08","2018-12-19",
    "2019-01-30","2019-03-20","2019-05-01","2019-06-19","2019-07-31","2019-09-18","2019-10-30","2019-12-11",
    "2020-01-29","2020-03-03","2020-03-16","2020-04-29","2020-06-10","2020-07-29","2020-09-16","2020-11-05","2020-12-16",
    "2021-01-27","2021-03-17","2021-04-28","2021-06-16","2021-07-28","2021-09-22","2021-11-03","2021-12-15",
    "2022-01-26","2022-03-16","2022-05-04","2022-06-15","2022-07-27","2022-09-21","2022-11-02","2022-12-14",
    "2023-02-01","2023-03-22","2023-05-03","2023-06-14","2023-07-26","2023-09-20","2023-11-01","2023-12-13",
    "2024-01-31","2024-03-20","2024-05-01","2024-06-12","2024-07-31","2024-09-18","2024-11-07","2024-12-18",
]

# ===========================================================================
#  [2] 임포트 & 재현성
# ===========================================================================
import os, warnings
os.environ.setdefault("PYTHONHASHSEED", str(SEED))
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy import stats
np.random.seed(SEED)


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
#  [3] 데이터
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
    df["return"] = df["close"].pct_change()
    df["rate_change"] = df["rate"].diff()
    df = df.dropna()
    print(f"[데이터] {df.index.min().date()} ~ {df.index.max().date()}, {len(df):,}개 거래일")
    return df


def fomc_event_mask(index, next_day=True):
    """거래일 인덱스에서 FOMC 발표일(및 옵션으로 다음 거래일)을 True로 표시."""
    fomc = pd.to_datetime(FOMC_DATES)
    mask = index.isin(fomc)
    hit = int(mask.sum())
    if next_day:  # 발표 다음 거래일도 이벤트 창에 포함
        nxt = np.zeros(len(index), dtype=bool)
        nxt[1:] = mask[:-1]
        mask = mask | nxt
    return pd.Series(mask, index=index), hit


# ===========================================================================
#  [4] GARCH(1,1) 적합
# ===========================================================================
def fit_garch(returns):
    """
    수익률에 GARCH(1,1)를 적합합니다.
    arch 라이브러리는 퍼센트 단위(×100)를 권장하므로 그렇게 넣습니다.
    반환: 결과객체, 조건부 변동성(퍼센트 단위) 시계열
    """
    from arch import arch_model
    y = returns.dropna() * 100.0                       # 퍼센트 단위로
    am = arch_model(y, mean="Constant", vol="GARCH", p=1, q=1, dist="normal")
    res = am.fit(disp="off")
    cond_vol = pd.Series(res.conditional_volatility, index=y.index)  # 조건부 변동성(%)
    return res, cond_vol


# ===========================================================================
#  [5] 변동성 비교 (t검정)
# ===========================================================================
def compare_groups(values, mask, label_a, label_b):
    """mask=True 그룹 vs False 그룹의 평균 변동성을 Welch t검정으로 비교."""
    a = values[mask].dropna()
    b = values[~mask].dropna()
    t, p = stats.ttest_ind(a, b, equal_var=False)      # 등분산 가정 안 함(Welch)
    print(f"  · {label_a}: 평균 {a.mean():.3f} (n={len(a)})")
    print(f"  · {label_b}: 평균 {b.mean():.3f} (n={len(b)})")
    print(f"  · 차이 {a.mean()-b.mean():+.3f}, t={t:.2f}, p={p:.4f}  "
          f"→ {'유의미하게 다름 ✓' if p < 0.05 else '통계적으로 차이 없음'}")
    return dict(mean_a=a.mean(), mean_b=b.mean(), t=t, p=p, n_a=len(a), n_b=len(b))


# ===========================================================================
#  [6] 변동성 예측 성능 (MSE / QLIKE) — 정확도가 아니라 이 지표로 평가
# ===========================================================================
def forecast_eval(returns, train_ratio=0.8):
    """
    앞 train_ratio로 GARCH를 적합하고, 뒤 구간의 1일 앞 '분산'을 예측해
    실제(수익률 제곱)와 비교합니다. MSE와 QLIKE로 평가(낮을수록 좋음).
    QLIKE = log(예측분산) + 실제/예측분산  (변동성 예측 평가의 표준 손실함수)
    """
    from arch import arch_model
    y = returns.dropna() * 100.0
    n = len(y); split = int(n * train_ratio)
    am = arch_model(y, mean="Constant", vol="GARCH", p=1, q=1, dist="normal")
    res = am.fit(disp="off", last_obs=y.index[split])   # 학습 구간까지만 모수 추정(누수 방지)
    fc = res.forecast(horizon=1, start=y.index[split], reindex=False)
    var_pred = fc.variance.values.ravel()               # 예측 분산
    real = (y.values[split:split + len(var_pred)]) ** 2  # 실제 변동성 대용치 = 수익률 제곱
    m = min(len(var_pred), len(real))
    var_pred, real = var_pred[:m], real[:m]
    eps = 1e-8
    mse = np.mean((real - var_pred) ** 2)
    qlike = np.mean(np.log(var_pred + eps) + real / (var_pred + eps))
    print(f"  · 예측 구간 {m}일, MSE={mse:.3f}, QLIKE={qlike:.3f} (둘 다 낮을수록 좋음)")
    return dict(mse=mse, qlike=qlike, n=m)


# ===========================================================================
#  [7] 시각화
# ===========================================================================
def plot_cond_vol(cond_vol, event_mask):
    plt.figure(figsize=(11, 4))
    plt.plot(cond_vol.index, cond_vol.values, color="tab:purple", lw=0.9,
             label="조건부 변동성(GARCH, %)")
    ev = cond_vol.index[event_mask.reindex(cond_vol.index, fill_value=False).values]
    plt.scatter(ev, cond_vol.reindex(ev).values, color="red", s=10, zorder=3,
                label="FOMC 발표(전후)")
    plt.ylabel("일간 변동성(%)"); plt.title("GARCH 조건부 변동성과 FOMC 발표일")
    plt.legend(); plt.tight_layout(); plt.show()


def plot_vol_box(abs_ret, event_mask):
    plt.figure(figsize=(6, 4.5))
    data = [abs_ret[event_mask].dropna().values * 100,
            abs_ret[~event_mask].dropna().values * 100]
    plt.boxplot(data, showfliers=False)               # labels= 인자는 버전마다 달라 xticks로 지정
    plt.xticks([1, 2], ["FOMC 전후", "평소"])
    plt.ylabel("|일간 수익률| (%)"); plt.title("FOMC 전후 vs 평소 — 변동성 분포")
    plt.tight_layout(); plt.show()


# ===========================================================================
#  [8] 메인
# ===========================================================================
def main():
    setup_korean_font()
    df = load_data()
    returns = df["return"]
    abs_ret = returns.abs()                              # 실현 변동성 대용치

    # --- GARCH 적합 ---
    print("\n[1] GARCH(1,1) 적합")
    res, cond_vol = fit_garch(returns)
    print(res.params.round(4).to_string())
    print(f"  · 조건부 변동성 평균 {cond_vol.mean():.3f}% / 최대 {cond_vol.max():.3f}%")

    # --- FOMC 이벤트 마스크 ---
    event_mask, n_hit = fomc_event_mask(df.index, next_day=EVENT_NEXT_DAY)
    print(f"\n[2] FOMC 발표일 중 거래일에 잡힌 수 {n_hit}회 "
          f"(이벤트 창 총 {int(event_mask.sum())}일, 다음날 포함={EVENT_NEXT_DAY})")

    # --- (가설 H5) FOMC 전후 변동성 vs 평소 ---
    print("\n[3] FOMC 발표 전후 변동성이 평소보다 큰가? (가설 H5)")
    print(" [실현 변동성 |수익률|로 비교]")
    compare_groups(abs_ret, event_mask, "FOMC 전후", "평소")
    print(" [GARCH 조건부 변동성으로 비교]")
    cv_full = cond_vol.reindex(df.index)
    compare_groups(cv_full, event_mask, "FOMC 전후", "평소")
    print(" [해석] 차이가 유의(p<0.05)하면 H5 지지, 아니면 '평소와 다르지 않다'로 보고.")

    # --- 금리 급변일 vs 잔잔한 날 ---
    print("\n[4] 금리가 크게 움직인 날 변동성이 더 큰가?")
    thr = df["rate_change"].abs().quantile(BIG_MOVE_Q)
    big_move = df["rate_change"].abs() > thr
    print(f"  (기준: |금리변화| > {thr:.3f}%p, 상위 {int((1-BIG_MOVE_Q)*100)}%)")
    compare_groups(abs_ret, big_move, "금리 급변일", "잔잔한 날")

    # --- 변동성 예측 성능 ---
    print("\n[5] 변동성 예측 성능 (정확도 아님 — MSE/QLIKE)")
    forecast_eval(returns, train_ratio=0.8)

    # --- 시각화 ---
    print("\n[그래프 그리는 중...]")
    plot_cond_vol(cond_vol, event_mask)
    plot_vol_box(abs_ret, event_mask)

    print("\n" + "=" * 66)
    print("[정리] GARCH는 '방향'이 아니라 '변동성'을 봅니다. '주가 변동'을 변동성으로")
    print("      해석했을 때의 분석이며, 방향 예측(1-a)과는 다른 질문에 답합니다.")
    print("      교육·연구용입니다.")
    print("=" * 66)


if __name__ == "__main__":
    main()
