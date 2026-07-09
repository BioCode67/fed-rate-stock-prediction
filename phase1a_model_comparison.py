# -*- coding: utf-8 -*-
# ============================================================================
#  Phase 1-a : 4개 모델 비교 (금리 기대와 주가 방향 예측)
#  영남대 SW중심대학사업단 AI·SW 러닝메이트 멘토링
# ----------------------------------------------------------------------------
#  이 파일이 하는 일 (한눈에)
#   - S&P500(주가)과 미국 2년물 국채금리(DGS2)를 FRED에서 받아옵니다.
#   - "내일(또는 N일 뒤) 주가가 오를까/내릴까"를 네 종류의 모델로 예측합니다.
#       ARIMA(전통 통계) / RandomForest(배깅) / XGBoost(부스팅) / LSTM(딥러닝)
#   - 정확도만 보지 않고 정밀도·재현율·F1·AUC·혼동행렬·기준선까지 함께 봅니다.
#   - 예측 시계(HORIZON), 금리변수 유무, 변수 중요도를 실험으로 비교합니다.
#
#  ★ 이 프로젝트의 목표는 "돈 버는 예측기"가 아니라
#     "시장이 왜 이렇게 예측하기 어려운지를 데이터로 보여주는 연구"입니다.
#     정확도가 낮게 나와도 실패가 아닙니다. 정직한 낮은 숫자가 더 가치 있습니다.
#     만약 정확도가 90%처럼 비현실적으로 높으면 데이터 누수 버그를 의심하세요.
# ============================================================================

# ---------------------------------------------------------------------------
#  [0] 설치 : Colab에서 아래 한 줄의 맨 앞 '#'을 지우고 한 번 실행하세요.
# ---------------------------------------------------------------------------
# !pip install fredapi scikit-learn statsmodels xgboost tensorflow scipy matplotlib koreanize-matplotlib

# ===========================================================================
#  [1] 설정 (상수) — 실험할 때 멘티들이 바꾸는 값은 대부분 여기 있습니다.
# ===========================================================================
FRED_API_KEY = ""          # ← 발급받은 FRED API 키를 이 따옴표 안에 붙여넣으세요.

PRICE_SERIES = "SP500"     # FRED 주가 시리즈 (S&P500 지수)
RATE_SERIES  = "DGS2"      # FRED 금리 시리즈 (미국 2년물 국채금리, %)
START = "2015-01-01"       # 데이터 시작일
END   = "2025-01-01"       # 데이터 끝일
# 참고: FRED의 'SP500' 시리즈는 최근 약 10년치만 제공합니다.
#       그래서 실제 시작일은 위 START보다 늦을 수 있습니다(코드가 실제 범위를 출력합니다).
#       더 긴 역사가 필요하면 yfinance의 '^GSPC'로 바꾸는 방법도 있습니다(다음 세션 주제).

PRIMARY_HORIZON = 5        # 대표 예측 시계: "5거래일(약 1주) 뒤" 방향을 맞힌다
HORIZONS = [1, 5, 20, 60]  # 예측 시계 민감도 실험에 쓸 값들 (1일/1주/1달/3달 뒤)
TRAIN_RATIO = 0.8          # 앞 80%로 학습, 뒤 20%로 시험 (시간순 분할)

# LSTM(딥러닝) 설정
SEQ_LEN   = 20             # 며칠치 과거를 한 덩어리로 보고 예측할지 (되돌아보는 길이)
LSTM_UNITS = 32            # LSTM 은닉 유닛 수 (모델의 기억 용량)
EPOCHS    = 20             # 학습 반복 횟수

# ARIMA 설정
ARIMA_ORDER = (2, 0, 2)    # (p, d, q). 수익률은 이미 정상성이 있어 d=0으로 둡니다.

SEED = 42                  # 재현성(같은 코드는 같은 결과)을 위한 난수 고정값

# --- 특징(feature) 구성 -----------------------------------------------------
# 정상성(stationarity) 확보 : 값의 범위가 시기마다 크게 달라지지 않도록,
#                            절대 수준(level) 대신 비율/변화량으로 만듭니다.
BASE_FEATURES = [
    "return",        # 일간 등락률
    "px_vs_ma5",     # 주가 / 5일 이동평균 - 1  (단기 이격도)
    "px_vs_ma20",    # 주가 / 20일 이동평균 - 1 (중기 이격도)
    "ma5_vs_ma20",   # 5일평균 / 20일평균 - 1   (모멘텀)
]
RATE_FEATURES = [
    "rate_change",     # 하루 금리 변화 (금리 수준이 아니라 '변화'를 씀)
    "rate_change_20",  # 20일간 금리 변화 (중기 금리 기대 변화)
]
ALL_FEATURES = BASE_FEATURES + RATE_FEATURES

# ===========================================================================
#  [2] 임포트 & 재현성 고정
# ===========================================================================
import os, time, random, warnings
os.environ.setdefault("PYTHONHASHSEED", str(SEED))
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")  # 텐서플로 잔소리 줄이기
os.environ.setdefault("KERAS_BACKEND", "tensorflow")  # 케라스 백엔드를 텐서플로로 고정(안전장치)
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                             f1_score, roc_auc_score, confusion_matrix)

random.seed(SEED)
np.random.seed(SEED)


def setup_korean_font():
    """그래프에서 한글이 깨지지 않도록 한글 폰트를 잡아줍니다."""
    import matplotlib as mpl
    import matplotlib.font_manager as fm
    try:
        import koreanize_matplotlib  # Colab: pip 설치돼 있으면 이 한 줄로 끝
        return
    except Exception:
        pass
    for name in ["NanumGothic", "Malgun Gothic", "AppleGothic", "NanumBarunGothic"]:
        try:
            fm.findfont(name, fallback_to_default=False)
            mpl.rcParams["font.family"] = name
            break
        except Exception:
            continue
    mpl.rcParams["axes.unicode_minus"] = False  # 마이너스 기호 깨짐 방지


# ===========================================================================
#  [3] 데이터 로드 (FRED)
# ===========================================================================
def load_data():
    """FRED에서 주가와 금리를 받아 하나의 표로 합칩니다."""
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
        raise SystemExit(f"[오류] FRED 다운로드 실패: {e}\n키가 올바른지, 인터넷 연결을 확인하세요.")

    df = pd.concat({"close": price, "rate": rate}, axis=1)
    df = df.dropna().sort_index()   # 두 시리즈가 모두 있는 거래일만 사용
    if len(df) < 500:
        raise SystemExit(f"[오류] 표본이 너무 적습니다({len(df)}개). 기간/시리즈를 확인하세요.")

    print("=" * 70)
    print(f"[데이터] {PRICE_SERIES}(주가) + {RATE_SERIES}(금리)")
    print(f"  실제 기간 : {df.index.min().date()} ~ {df.index.max().date()}")
    print(f"  표본 수   : {len(df):,}개 거래일")
    print("=" * 70)
    return df


def make_features(df):
    """정상성 있는 특징들을 계산해 새 열로 추가합니다."""
    d = df.copy()
    d["return"] = d["close"].pct_change()               # 일간 등락률
    ma5  = d["close"].rolling(5).mean()
    ma20 = d["close"].rolling(20).mean()
    d["px_vs_ma5"]   = d["close"] / ma5 - 1
    d["px_vs_ma20"]  = d["close"] / ma20 - 1
    d["ma5_vs_ma20"] = ma5 / ma20 - 1
    d["rate_change"]    = d["rate"].diff()              # 금리 '수준'이 아니라 '변화'
    d["rate_change_20"] = d["rate"].diff(20)
    return d


def adf_report(series, name):
    """ADF 검정: p값이 작으면(<0.05) '정상성 있음'으로 봅니다."""
    from statsmodels.tsa.stattools import adfuller
    s = series.dropna()
    try:
        p = adfuller(s)[1]
        verdict = "정상성 있음 ✓" if p < 0.05 else "정상성 의심 ✗ (수준 변수일 수 있음)"
        print(f"  - {name:12s}: ADF p={p:.4f}  →  {verdict}")
    except Exception as e:
        print(f"  - {name:12s}: ADF 검정 실패 ({e})")


# ===========================================================================
#  [4] 지도학습용 데이터 만들기 (목표 = N일 뒤 방향)
# ===========================================================================
def build_supervised(df, feature_cols, horizon):
    """
    목표변수(target) = 'horizon일 뒤 종가가 오늘보다 높으면 1(상승), 아니면 0(하락)'.
    데이터 누수 방지: 특징은 모두 '오늘까지의 정보'만 사용하고,
                     목표만 미래를 봅니다(마지막 horizon일은 미래가 없어 제거).
    """
    d = df.copy()
    future = d["close"].shift(-horizon)                 # horizon일 뒤 종가
    d["target"] = np.where(future > d["close"], 1.0, 0.0)
    d.loc[future.isna(), "target"] = np.nan             # 미래가 없는 마지막 구간은 무효
    d = d.dropna(subset=feature_cols + ["return"])      # 이동평균·금리차분 워밍업 결측 제거
    d = d.dropna(subset=["target"])                     # 마지막 horizon일 제거
    return d


def time_split_index(n, ratio):
    """시간순 분할 지점(위치)을 돌려줍니다. 절대 무작위로 섞지 않습니다."""
    return int(n * ratio)


# ===========================================================================
#  [5] 평가 지표 (정확도만 보지 않습니다)
# ===========================================================================
def evaluate(y_true, y_pred, y_score=None):
    y_true = np.asarray(y_true).astype(int)
    y_pred = np.asarray(y_pred).astype(int)

    acc  = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, zero_division=0)
    rec  = recall_score(y_true, y_pred, zero_division=0)
    f1   = f1_score(y_true, y_pred, zero_division=0)
    try:
        auc = roc_auc_score(y_true, y_score) if y_score is not None else np.nan
    except ValueError:
        auc = np.nan                                    # 한 쪽 클래스만 있으면 AUC 계산 불가

    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])

    # 기준선(baseline): 아무 생각 없이 '항상 다수 클래스'에 베팅했을 때의 정확도
    p_up = y_true.mean()
    baseline = max(p_up, 1 - p_up)

    # 이항검정: 맞힌 개수가 '동전 던지기(50%)'보다 유의하게 많은가?
    from scipy.stats import binomtest
    n = len(y_true)
    n_correct = int((y_pred == y_true).sum())
    pval = binomtest(n_correct, n, 0.5, alternative="greater").pvalue

    return dict(acc=acc, prec=prec, rec=rec, f1=f1, auc=auc, cm=cm,
                baseline=baseline, p_up=p_up, pval=pval, n=n)


# ===========================================================================
#  [6] 네 가지 모델
# ===========================================================================
def run_arima(ret_series, split, horizon, order=ARIMA_ORDER):
    """
    ARIMA는 특징을 쓰지 않고 '수익률 시계열' 그 자체의 흐름만 봅니다(단변량).
    워크포워드: 하루하루 실제값을 반영하며 horizon일 뒤까지 예측 → 누적수익의 부호로 방향 판단.
    (매 스텝 재학습하지 않고 상태만 갱신하므로 빠릅니다.)
    """
    from statsmodels.tsa.arima.model import ARIMA
    ret = np.asarray(ret_series, dtype=float)
    res = ARIMA(ret[:split], order=order).fit()
    preds, scores = [], []
    for i in range(split, len(ret)):
        res = res.append([ret[i]], refit=False)         # 오늘(i)까지의 실제값 반영
        fc = res.forecast(steps=horizon)                # 내일~horizon일 뒤 수익률 예측
        cum = float(np.sum(fc))                          # 누적수익 예상치
        scores.append(cum)
        preds.append(1 if cum > 0 else 0)
    return np.array(preds), np.array(scores)


def run_rf(X_tr, y_tr, X_te):
    m = RandomForestClassifier(n_estimators=200, max_depth=6,
                               random_state=SEED, n_jobs=-1)
    m.fit(X_tr, y_tr)
    return m.predict(X_te), m.predict_proba(X_te)[:, 1], m


def run_xgb(X_tr, y_tr, X_te):
    from xgboost import XGBClassifier
    m = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05,
                      subsample=0.9, colsample_bytree=0.9,
                      random_state=SEED, eval_metric="logloss", n_jobs=-1)
    m.fit(X_tr, y_tr)
    return m.predict(X_te), m.predict_proba(X_te)[:, 1], m


def run_lstm(sup, feature_cols, split, horizon):
    """
    LSTM은 SEQ_LEN일치 과거를 한 덩어리(시퀀스)로 보고 다음 방향을 예측합니다.
    데이터 누수 방지: 스케일러는 '학습 구간에만 fit', 시험 구간은 transform만.
    """
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Input
    tf.random.set_seed(SEED)

    feats = sup[feature_cols].values
    y = sup["target"].values.astype(int)

    scaler = StandardScaler().fit(feats[:split])         # ★ 학습 구간에만 fit (미래 정보 차단)
    feats_s = scaler.transform(feats)

    X_seq, y_seq, end_pos = [], [], []
    for i in range(SEQ_LEN - 1, len(sup)):
        X_seq.append(feats_s[i - SEQ_LEN + 1:i + 1])     # i일까지의 과거 SEQ_LEN일
        y_seq.append(y[i])
        end_pos.append(i)
    X_seq = np.array(X_seq); y_seq = np.array(y_seq); end_pos = np.array(end_pos)

    tr = end_pos < split                                 # 시퀀스가 끝나는 날 기준으로 분할
    te = end_pos >= split

    model = Sequential([
        Input(shape=(SEQ_LEN, len(feature_cols))),
        LSTM(LSTM_UNITS),
        Dense(1, activation="sigmoid"),
    ])
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    model.fit(X_seq[tr], y_seq[tr], epochs=EPOCHS, batch_size=32, verbose=0)

    score = model.predict(X_seq[te], verbose=0).ravel()
    pred = (score > 0.5).astype(int)
    return pred, score, y_seq[te]                        # LSTM의 시험 정답도 함께 반환


# ===========================================================================
#  [7] 모델들을 한 번에 돌리는 드라이버
# ===========================================================================
def run_all_models(df, feature_cols, horizon,
                   models=("ARIMA", "RandomForest", "XGBoost", "LSTM")):
    sup = build_supervised(df, feature_cols, horizon)
    n = len(sup)
    split = time_split_index(n, TRAIN_RATIO)

    X_tr = sup[feature_cols].iloc[:split].values
    y_tr = sup["target"].iloc[:split].values.astype(int)
    X_te = sup[feature_cols].iloc[split:].values
    y_te = sup["target"].iloc[split:].values.astype(int)

    out = {"_meta": dict(n=n, split=split, n_test=len(y_te), p_up=float(y_te.mean()))}

    if "ARIMA" in models:
        t = time.time()
        p, s = run_arima(sup["return"].values, split, horizon)
        m = evaluate(y_te, p, s); m["time"] = time.time() - t
        out["ARIMA"] = m

    if "RandomForest" in models:
        t = time.time()
        p, s, rf = run_rf(X_tr, y_tr, X_te)
        m = evaluate(y_te, p, s); m["time"] = time.time() - t
        out["RandomForest"] = m
        out["_rf_model"] = rf                            # 실험 C(변수 중요도)에서 사용

    if "XGBoost" in models:
        t = time.time()
        p, s, _ = run_xgb(X_tr, y_tr, X_te)
        m = evaluate(y_te, p, s); m["time"] = time.time() - t
        out["XGBoost"] = m

    if "LSTM" in models:
        t = time.time()
        p, s, y_lstm = run_lstm(sup, feature_cols, split, horizon)
        m = evaluate(y_lstm, p, s); m["time"] = time.time() - t
        out["LSTM"] = m

    return out


def metrics_table(results, model_names):
    rows = []
    for name in model_names:
        r = results[name]
        rows.append({
            "모델": name,
            "정확도": round(r["acc"], 3),
            "정밀도": round(r["prec"], 3),
            "재현율": round(r["rec"], 3),
            "F1": round(r["f1"], 3),
            "AUC": round(r["auc"], 3) if not np.isnan(r["auc"]) else np.nan,
            "기준선": round(r["baseline"], 3),
            "정확도-기준선": round(r["acc"] - r["baseline"], 3),
            "p값(vs50%)": round(r["pval"], 3),
            "학습시간(초)": round(r.get("time", np.nan), 2),
        })
    return pd.DataFrame(rows)


# ===========================================================================
#  [8] 시각화
# ===========================================================================
def plot_price_rate(df):
    fig, ax1 = plt.subplots(figsize=(11, 4))
    ax1.plot(df.index, df["close"], color="tab:blue", label="주가(S&P500)")
    ax1.set_ylabel("주가", color="tab:blue")
    ax2 = ax1.twinx()
    ax2.plot(df.index, df["rate"], color="tab:red", alpha=0.7, label="금리(2년물,%)")
    ax2.set_ylabel("금리(%)", color="tab:red")
    plt.title("주가와 금리의 흐름 (이중축)")
    fig.tight_layout(); plt.show()


def plot_accuracy_bar(results, model_names, baseline, horizon):
    accs = [results[m]["acc"] for m in model_names]
    plt.figure(figsize=(8, 4.5))
    bars = plt.bar(model_names, accs, color="tab:blue", alpha=0.8)
    plt.axhline(baseline, color="red", linestyle="--",
                label=f"기준선(다수결) {baseline:.3f}")
    plt.axhline(0.5, color="gray", linestyle=":", label="동전 던지기 0.5")
    for b, a in zip(bars, accs):
        plt.text(b.get_x() + b.get_width() / 2, a + 0.005, f"{a:.3f}", ha="center")
    plt.ylim(0.35, max(0.7, max(accs) + 0.05))
    plt.ylabel("정확도"); plt.title(f"모델별 정확도 (예측 시계 {horizon}일)")
    plt.legend(); plt.tight_layout(); plt.show()


def plot_horizon_sensitivity(sweep, model_names, horizons):
    plt.figure(figsize=(8, 4.5))
    for m in model_names:
        accs = [sweep[h][m]["acc"] for h in horizons]
        plt.plot(horizons, accs, marker="o", label=m)
    base = [sweep[h][model_names[0]]["baseline"] for h in horizons]
    plt.plot(horizons, base, marker="x", linestyle="--", color="red", label="기준선(다수결)")
    plt.xlabel("예측 시계 (일)"); plt.ylabel("정확도")
    plt.title("예측 시계별 정확도 변화")
    plt.legend(); plt.tight_layout(); plt.show()


def plot_feature_importance(rf_model, feature_cols):
    imp = pd.Series(rf_model.feature_importances_, index=feature_cols).sort_values()
    plt.figure(figsize=(8, 4))
    plt.barh(imp.index, imp.values, color="tab:green", alpha=0.8)
    plt.xlabel("중요도"); plt.title("RandomForest 변수 중요도")
    plt.tight_layout(); plt.show()


def plot_confusions(results, model_names):
    fig, axes = plt.subplots(1, len(model_names), figsize=(4 * len(model_names), 3.6))
    if len(model_names) == 1:
        axes = [axes]
    for ax, name in zip(axes, model_names):
        cm = results[name]["cm"]
        im = ax.imshow(cm, cmap="Blues")
        ax.set_title(name)
        ax.set_xticks([0, 1]); ax.set_yticks([0, 1])
        ax.set_xticklabels(["하락", "상승"]); ax.set_yticklabels(["하락", "상승"])
        ax.set_xlabel("예측"); ax.set_ylabel("실제")
        for i in range(2):
            for j in range(2):
                ax.text(j, i, cm[i, j], ha="center", va="center",
                        color="white" if cm[i, j] > cm.max() / 2 else "black")
    plt.suptitle("혼동행렬 (실제 vs 예측)")
    plt.tight_layout(); plt.show()


# ===========================================================================
#  [9] 메인 : 실험 A / HORIZON 민감도 / 실험 B / 실험 C
# ===========================================================================
def main():
    setup_korean_font()
    MODELS = ["ARIMA", "RandomForest", "XGBoost", "LSTM"]

    # ---- 데이터 준비 ----
    raw = load_data()
    df = make_features(raw)

    print("\n[정상성 점검] 절대 수준은 '정상성 의심', 비율/변화량은 '정상성 있음'이 정상입니다.")
    adf_report(df["close"], "close(수준)")
    adf_report(df["rate"], "rate(수준)")
    adf_report(df["return"], "return")
    adf_report(df["px_vs_ma20"], "px_vs_ma20")
    adf_report(df["rate_change"], "rate_change")

    # ==================================================================
    #  실험 A : 네 모델 정면 비교 (대표 예측 시계에서, 금리변수 포함)
    # ==================================================================
    print("\n" + "=" * 70)
    print(f"[실험 A] 네 모델 비교 — 예측 시계 {PRIMARY_HORIZON}일, 금리변수 포함")
    print("=" * 70)
    resA = run_all_models(df, ALL_FEATURES, PRIMARY_HORIZON, models=MODELS)
    meta = resA["_meta"]
    print(f"학습 {meta['split']}개 / 시험 {meta['n_test']}개, "
          f"시험구간 상승비율 {meta['p_up']:.3f}")
    tableA = metrics_table(resA, MODELS)
    print(tableA.to_string(index=False))
    print("\n[해석 힌트]")
    print(" - '정확도-기준선'이 양수여야 모델이 다수결보다 나은 것입니다.")
    print(" - p값(vs50%)이 0.05보다 크면 '동전 던지기와 통계적으로 구별되지 않음'입니다.")
    print(" - 정확도가 기준선을 못 넘어도 실패가 아닙니다. 시장이 효율적이라는 증거일 수 있습니다.")

    # ==================================================================
    #  HORIZON 민감도 : 예측 시계를 1/5/20/60일로 바꿔가며
    # ==================================================================
    print("\n" + "=" * 70)
    print("[HORIZON 민감도] 예측 시계를 바꾸면 정확도가 어떻게 변하나")
    print("=" * 70)
    sweep = {}
    n_runs = 0
    for h in HORIZONS:
        sweep[h] = run_all_models(df, ALL_FEATURES, h, models=MODELS)
        n_runs += len(MODELS)
    # 표: 행=모델, 열=예측시계 (정확도 / 괄호 안은 기준선 대비)
    rows = []
    for m in MODELS:
        row = {"모델": m}
        for h in HORIZONS:
            r = sweep[h][m]
            row[f"{h}일"] = f"{r['acc']:.3f} ({r['acc']-r['baseline']:+.3f})"
        rows.append(row)
    base_row = {"모델": "기준선(다수결)"}
    for h in HORIZONS:
        base_row[f"{h}일"] = f"{sweep[h][MODELS[0]]['baseline']:.3f}"
    print(pd.DataFrame(rows + [base_row]).to_string(index=False))
    print(f"\n총 학습 횟수: {n_runs}회 (모델 {len(MODELS)} × 시계 {len(HORIZONS)})")
    print(" [주의] 여러 설정을 시도할수록 우연히 좋은 결과가 나올 확률이 커집니다(다중검정).")
    print("        괄호 안 '기준선 대비'로 봐야 공정합니다. 시계가 길수록 기준선도 함께 오릅니다.")

    # ==================================================================
    #  실험 B : 금리변수를 빼면 vs 넣으면 (★ 연구 주제의 핵심 질문)
    # ==================================================================
    print("\n" + "=" * 70)
    print(f"[실험 B] 금리 변수가 예측에 도움이 되는가? — 예측 시계 {PRIMARY_HORIZON}일")
    print("=" * 70)
    ML = ["RandomForest", "XGBoost", "LSTM"]   # ARIMA는 단변량이라 제외
    res_base = run_all_models(df, BASE_FEATURES, PRIMARY_HORIZON, models=ML)
    res_full = run_all_models(df, ALL_FEATURES,  PRIMARY_HORIZON, models=ML)
    rowsB = []
    for m in ML:
        b, f = res_base[m]["acc"], res_full[m]["acc"]
        rowsB.append({"모델": m, "금리 뺐을 때": round(b, 3),
                      "금리 넣었을 때": round(f, 3), "차이": round(f - b, 3)})
    print(pd.DataFrame(rowsB).to_string(index=False))
    print("\n[해석 힌트]")
    print(" - 가설 H2: '금리변수를 넣어도 정확도가 크게 오르지 않는다(효율적 시장)'.")
    print("   차이가 거의 0이면 H2를 지지, 뚜렷이 +면 H2를 반박(더 흥미로운 발견!)합니다.")
    print(" - 둘 다 의미 있는 결과입니다. 결과를 가설에 맞추려 설정을 바꾸지 마세요.")

    # ==================================================================
    #  실험 C : 변수 중요도 (RandomForest)
    # ==================================================================
    print("\n" + "=" * 70)
    print("[실험 C] RandomForest 변수 중요도")
    print("=" * 70)
    rf = resA["_rf_model"]
    imp = pd.Series(rf.feature_importances_, index=ALL_FEATURES).sort_values(ascending=False)
    print(imp.round(4).to_string())
    print("\n[해석 주의] 금리 관련 변수의 중요도가 높게 나와도, 실험 B에서 정확도가")
    print("           오르지 않았다면 그 중요도는 '시기(time)를 알려주는 프록시'일 수 있습니다.")
    print("           (가설 H3) — 중요도가 곧 예측력 향상은 아닙니다.")

    # ---- 시각화 ----
    print("\n[그래프 그리는 중...]")
    plot_price_rate(df)
    plot_accuracy_bar(resA, MODELS, resA["ARIMA"]["baseline"], PRIMARY_HORIZON)
    plot_horizon_sensitivity(sweep, MODELS, HORIZONS)
    plot_feature_importance(rf, ALL_FEATURES)
    plot_confusions(resA, MODELS)

    print("\n" + "=" * 70)
    print("[마무리] 이 코드는 교육·연구용입니다. 실제 투자 판단에 쓰지 마세요.")
    print("        낮더라도 정직한 정확도가, 부풀린 높은 정확도보다 훨씬 값집니다.")
    print("=" * 70)


if __name__ == "__main__":
    main()
