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
# !pip install fredapi yfinance scikit-learn statsmodels xgboost tensorflow scipy matplotlib koreanize-matplotlib

# ===========================================================================
#  [1] 설정 (상수) — 실험할 때 멘티들이 바꾸는 값은 대부분 여기 있습니다.
# ===========================================================================
FRED_API_KEY = ""          # ← 발급받은 FRED API 키를 이 따옴표 안에 붙여넣으세요.

PRICE_SOURCE = "yfinance"  # "yfinance"(권장) 또는 "fred"
#   FRED의 'SP500' 시리즈는 최근 약 10년치만 제공합니다.
#   yfinance의 '^GSPC'는 훨씬 긴 역사를 주므로 표본이 늘어납니다.
PRICE_TICKER = "^GSPC"     # yfinance용 (S&P500). 코스피는 "^KS11"
PRICE_SERIES = "SP500"     # fred용 (PRICE_SOURCE="fred"일 때만 사용)
RATE_SERIES  = "DGS2"      # FRED 금리 시리즈 (미국 2년물 국채금리, %)
START = "2010-01-01"       # 데이터 시작일
END   = "2025-01-01"       # 데이터 끝일

# ★ 클래스 불균형 대응
#   상승일이 57%처럼 한쪽으로 치우치면, 모델은 "무조건 상승"만 외쳐도
#   정확도가 높아 보입니다. 아래를 True로 두면 소수 클래스에 가중치를 줘서
#   모델이 다수결을 흉내내지 못하게 막습니다.
USE_CLASS_WEIGHT = True

# ★ 시기별(체제별) 분석 구간 — 금리 환경이 다른 시기를 나눠서 봅니다.
REGIMES = [
    ("2010-2015 저금리기",   "2010-01-01", "2015-12-31"),
    ("2016-2019 정상화기",   "2016-01-01", "2019-12-31"),
    ("2020-2021 코로나기",   "2020-01-01", "2021-12-31"),
    ("2022-2024 금리인상기", "2022-01-01", "2024-12-31"),
]

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
import os, time, random, warnings, unicodedata
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


# ---------------------------------------------------------------------------
#  표를 예쁘게 출력하는 도우미
#  한글(전각 문자)은 화면에서 2칸을 차지하는데, 파이썬 기본 정렬은 1칸으로 세어
#  Colab에서 표가 어긋나 보입니다. 아래 함수는 '표시 폭'을 기준으로 칸을 맞춰
#  한글이 섞여도 열이 가지런히 보이게 합니다.
# ---------------------------------------------------------------------------
def _disp_width(s):
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in str(s))


def _pad(s, width, right=False):
    gap = max(0, width - _disp_width(s))
    return (" " * gap + str(s)) if right else (str(s) + " " * gap)


def print_table(df, index=False):
    """DataFrame을 한글 폭까지 고려해 열을 맞춰 출력합니다."""
    df = df.reset_index() if index else df.copy()
    headers = [str(c) for c in df.columns]

    def cell(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return ""
        return str(v)

    rows = [[cell(v) for v in r] for r in df.itertuples(index=False, name=None)]
    widths = [max([_disp_width(headers[j])] + [_disp_width(r[j]) for r in rows])
              for j in range(len(headers))]
    # 첫 열(이름표)은 왼쪽, 숫자 열들은 오른쪽 정렬이 읽기 편합니다.
    def line(cells):
        return "   ".join(_pad(c, widths[j], right=(j != 0)) for j, c in enumerate(cells))
    print(line(headers))
    print("   ".join("-" * widths[j] for j in range(len(headers))))
    for r in rows:
        print(line(r))


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
        rate = fred.get_series(RATE_SERIES, START, END)   # 금리는 항상 FRED
    except Exception as e:
        raise SystemExit(f"[오류] FRED 다운로드 실패: {e}\n키가 올바른지, 인터넷 연결을 확인하세요.")

    if PRICE_SOURCE == "yfinance":
        try:
            import yfinance as yf
        except ImportError:
            raise SystemExit("[오류] yfinance가 없습니다. 맨 위 [0] 설치 줄을 실행하세요.")
        px = yf.download(PRICE_TICKER, start=START, end=END,
                         auto_adjust=True, progress=False)
        if isinstance(px.columns, pd.MultiIndex):
            px.columns = px.columns.get_level_values(0)
        if len(px) == 0:
            raise SystemExit("[오류] 주가 데이터를 받지 못했습니다.")
        price = px["Close"]
        src = f"{PRICE_TICKER}(yfinance)"
    else:
        price = fred.get_series(PRICE_SERIES, START, END)
        src = f"{PRICE_SERIES}(FRED, 최근 10년만 제공)"

    price.index = pd.to_datetime(price.index).tz_localize(None)
    rate.index  = pd.to_datetime(rate.index)

    df = pd.concat({"close": price, "rate": rate}, axis=1)
    df["rate"] = df["rate"].ffill()          # 금리는 휴일에 결측 → 직전 값 유지
    df = df.dropna().sort_index()
    if len(df) < 500:
        raise SystemExit(f"[오류] 표본이 너무 적습니다({len(df)}개). 기간/시리즈를 확인하세요.")

    print("=" * 70)
    print(f"[데이터] {src} + {RATE_SERIES}(금리)")
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
def auc_pvalue(auc, n_pos, n_neg):
    """AUC가 0.5(판별력 없음)보다 유의하게 큰지 검정 (Hanley-McNeil 표준오차).
       AUC는 임계값과 무관해서 클래스 불균형에 속지 않는 지표입니다."""
    from scipy.stats import norm
    if np.isnan(auc) or auc <= 0.5 or n_pos == 0 or n_neg == 0:
        return np.nan
    q1 = auc / (2 - auc)
    q2 = 2 * auc ** 2 / (1 + auc)
    se = np.sqrt((auc * (1 - auc) + (n_pos - 1) * (q1 - auc ** 2)
                  + (n_neg - 1) * (q2 - auc ** 2)) / (n_pos * n_neg))
    return float(1 - norm.cdf((auc - 0.5) / se))


def evaluate(y_true, y_pred, y_score=None):
    from scipy.stats import binomtest
    from sklearn.metrics import balanced_accuracy_score, matthews_corrcoef

    y_true = np.asarray(y_true).astype(int)
    y_pred = np.asarray(y_pred).astype(int)

    acc  = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, zero_division=0)
    rec  = recall_score(y_true, y_pred, zero_division=0)
    f1   = f1_score(y_true, y_pred, zero_division=0)

    # 균형정확도: 상승·하락 각각의 정확도를 평균 → 불균형에 강함
    bal_acc = balanced_accuracy_score(y_true, y_pred)
    # MCC: -1~+1. 0이면 무작위. 불균형 데이터에서 가장 정직한 단일 지표로 꼽힘
    mcc = matthews_corrcoef(y_true, y_pred)

    try:
        auc = roc_auc_score(y_true, y_score) if y_score is not None else np.nan
    except ValueError:
        auc = np.nan

    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])

    n = len(y_true)
    p_up = y_true.mean()
    baseline = max(p_up, 1 - p_up)          # '항상 다수 클래스' 찍기의 정확도

    # ★ 진단: 모델이 '상승'으로 예측한 날의 비율.
    #   이 값이 95%처럼 극단적이면, 모델은 예측이 아니라 다수결을 흉내내는 중입니다.
    pred_up_rate = float(y_pred.mean())

    n_correct = int((y_pred == y_true).sum())

    # ★ 핵심 수정: 귀무가설은 '동전 던지기(0.5)'가 아니라 '기준선'이어야 합니다.
    #   0.5로 검정하면, 아무 실력 없이 다수결만 흉내낸 모델도 '유의함'으로 나옵니다.
    p_vs_baseline = binomtest(n_correct, n, baseline, alternative="greater").pvalue
    p_vs_coin     = binomtest(n_correct, n, 0.5,      alternative="greater").pvalue  # 참고용

    n_pos = int(y_true.sum()); n_neg = n - n_pos
    p_auc = auc_pvalue(auc, n_pos, n_neg)

    return dict(acc=acc, prec=prec, rec=rec, f1=f1, auc=auc, cm=cm,
                bal_acc=bal_acc, mcc=mcc, pred_up_rate=pred_up_rate,
                baseline=baseline, p_up=p_up, n=n,
                p_vs_baseline=p_vs_baseline, p_vs_coin=p_vs_coin, p_auc=p_auc)


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
    # class_weight="balanced": 소수 클래스(대개 '하락')에 큰 가중치를 줘서
    # 모델이 '무조건 상승'으로 도망가지 못하게 합니다.
    cw = "balanced" if USE_CLASS_WEIGHT else None
    m = RandomForestClassifier(n_estimators=200, max_depth=6, class_weight=cw,
                               random_state=SEED, n_jobs=-1)
    m.fit(X_tr, y_tr)
    return m.predict(X_te), m.predict_proba(X_te)[:, 1], m


def run_xgb(X_tr, y_tr, X_te):
    from xgboost import XGBClassifier
    # XGBoost는 scale_pos_weight = (음성 수 / 양성 수) 로 균형을 맞춥니다.
    spw = 1.0
    if USE_CLASS_WEIGHT:
        n_pos = float((y_tr == 1).sum()); n_neg = float((y_tr == 0).sum())
        spw = n_neg / n_pos if n_pos > 0 else 1.0
    m = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05,
                      subsample=0.9, colsample_bytree=0.9, scale_pos_weight=spw,
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

    # 클래스 가중치: 소수 클래스의 오답에 더 큰 벌점을 줍니다.
    cw = None
    if USE_CLASS_WEIGHT:
        ytr_ = y_seq[tr]
        n_pos = float((ytr_ == 1).sum()); n_neg = float((ytr_ == 0).sum())
        total = n_pos + n_neg
        if n_pos > 0 and n_neg > 0:
            cw = {0: total / (2 * n_neg), 1: total / (2 * n_pos)}

    model.fit(X_seq[tr], y_seq[tr], epochs=EPOCHS, batch_size=32,
              verbose=0, class_weight=cw)

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


def _r(v, k=3):
    return np.nan if (isinstance(v, float) and np.isnan(v)) else round(v, k)


def metrics_table(results, model_names):
    """AUC를 맨 앞에 둡니다. 클래스가 불균형할 때 정확도는 오해를 부르기 때문입니다."""
    rows = []
    for name in model_names:
        r = results[name]
        rows.append({
            "모델": name,
            "AUC": _r(r["auc"]),                       # ★ 주 지표 (0.5 = 판별력 없음)
            "AUC p값": _r(r["p_auc"]),                 # 0.05 미만이면 판별력 유의
            "MCC": _r(r["mcc"]),                       # 0 = 무작위
            "균형정확도": _r(r["bal_acc"]),             # 0.5 = 무작위
            "정확도": _r(r["acc"]),
            "기준선": _r(r["baseline"]),
            "정확도-기준선": _r(r["acc"] - r["baseline"]),
            "p값(vs기준선)": _r(r["p_vs_baseline"]),    # ★ 올바른 귀무가설
            "상승예측비율": _r(r["pred_up_rate"]),      # ★ 0.9 넘으면 다수결 흉내 의심
            "시간(초)": _r(r.get("time", np.nan), 2),
        })
    return pd.DataFrame(rows)


def diagnose(results, model_names):
    """모델이 진짜 예측을 하는지, 다수결을 흉내내는지 진단합니다."""
    print("\n[진단] 모델이 다수결을 흉내내고 있지는 않은가?")
    for name in model_names:
        r = results[name]
        flags = []
        if r["pred_up_rate"] > 0.90 or r["pred_up_rate"] < 0.10:
            flags.append(f"한쪽으로 {max(r['pred_up_rate'],1-r['pred_up_rate'])*100:.0f}% 쏠림")
        if not np.isnan(r["auc"]) and r["auc"] <= 0.51:
            flags.append("AUC≈0.5 → 판별력 없음")
        if abs(r["mcc"]) < 0.05:
            flags.append("MCC≈0 → 무작위 수준")
        verdict = " / ".join(flags) if flags else "이상 없음 (실제 판별을 시도함)"
        print(f"  - {name:<13}: {verdict}")
    print("  ※ 다수결 흉내 모델은 정확도가 높아 보여도 AUC와 MCC가 0 근처입니다.")


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


def plot_auc_bar(results, model_names):
    aucs = [results[m]["auc"] for m in model_names]
    plt.figure(figsize=(8, 4.5))
    bars = plt.bar(model_names, aucs, color="tab:purple", alpha=0.85)
    plt.axhline(0.5, color="red", linestyle="--", label="판별력 없음 (AUC=0.5)")
    for b, a in zip(bars, aucs):
        if not np.isnan(a):
            plt.text(b.get_x()+b.get_width()/2, a+0.004, f"{a:.3f}", ha="center")
    plt.ylim(0.40, max(0.62, np.nanmax(aucs)+0.04))
    plt.ylabel("AUC"); plt.title("모델별 AUC (주 지표)")
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
#  [8-2] 실험 E : 시기별(체제별) 분석
#   금융 시계열은 시기마다 통계적 성질이 달라집니다(regime shift).
#   "금리가 내리면 주가가 오른다"는 통념이 모든 시기에 성립하는지 직접 확인합니다.
# ===========================================================================
def regime_analysis(df, horizon):
    print("\n" + "=" * 70)
    print("[실험 E] 시기별 금리-주가 관계 (통념 검증)")
    print("=" * 70)
    print("통념: 금리가 내리면 주가가 오른다 → 상관계수가 음수(-)여야 함\n")

    from scipy.stats import pearsonr
    rows = []
    for label, s, e in REGIMES:
        seg = df.loc[s:e].dropna(subset=["rate_change", "return"])
        if len(seg) < 60:
            continue
        # 같은 날의 금리 변화 vs 주가 등락률
        r1, p1 = pearsonr(seg["rate_change"], seg["return"])
        # horizon일 뒤 누적 수익률과 20일 금리 변화
        fwd = seg["close"].shift(-horizon) / seg["close"] - 1
        m = seg["rate_change_20"].notna() & fwd.notna()
        r2, p2 = pearsonr(seg.loc[m, "rate_change_20"], fwd[m]) if m.sum() > 30 else (np.nan, np.nan)

        rows.append({
            "시기": label,
            "일수": len(seg),
            "평균금리(%)": round(seg["rate"].mean(), 2),
            "당일 상관": round(r1, 3),
            "p값": round(p1, 3),
            f"{horizon}일후 상관": round(r2, 3) if not np.isnan(r2) else np.nan,
            "통념 부합": "예" if r1 < 0 else "아니오",
        })
    out = pd.DataFrame(rows)
    print_table(out)
    print("\n[해석]")
    print(" - '당일 상관'이 음수면 통념(금리↓ → 주가↑)과 일치합니다.")
    print(" - 시기마다 부호가 달라진다면, 이 관계가 항상 성립하지 않는다는 뜻입니다.")
    print("   (예: 경기침체 우려로 금리를 내릴 땐 주가도 함께 떨어질 수 있음)")
    print(" - 학습 구간과 시험 구간의 금리 환경이 다르면, 모델이 배운 패턴이")
    print("   시험 구간에서 통하지 않을 수 있습니다. 이것이 체제 변화(regime shift)입니다.")
    return out


# ===========================================================================
#  [9] 메인 : 실험 A / HORIZON 민감도 / 실험 B / 실험 C / 실험 E
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
    print_table(tableA)
    diagnose(resA, MODELS)
    print("\n[해석 힌트]")
    print(" - ★ AUC를 먼저 보세요. 0.5면 판별력이 전혀 없다는 뜻입니다.")
    print("   정확도는 상승일이 많으면 '무조건 상승'만 찍어도 높아지므로 속기 쉽습니다.")
    print(" - 'p값(vs기준선)'은 다수결보다 나은지를 검정합니다. (0.5가 아니라 기준선이 옳은 비교 대상)")
    print(" - '상승예측비율'이 0.9를 넘으면, 모델은 예측이 아니라 다수결을 흉내내는 중입니다.")
    print(" - MCC와 균형정확도가 각각 0, 0.5 근처면 무작위와 다르지 않습니다.")
    print(" - 판별력이 없다는 결과도 실패가 아닙니다. 효율적 시장 가설과 일치하는 발견입니다.")

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
    # (1) 정확도 표 — 괄호 안은 기준선 대비 우위
    print("\n[정확도]  괄호 = 기준선 대비 우위 (양수여야 다수결보다 나음)")
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
    print_table(pd.DataFrame(rows + [base_row]))

    # (2) ★ AUC 표 — 클래스 불균형에 속지 않는 주 지표.
    #     특정 시계에서만 0.5를 넘으면 우연, 여러 시계에서 일관되면 진짜 신호.
    print("\n[AUC]  0.5 = 판별력 없음.  괄호 = AUC가 0.5보다 큰지의 p값")
    rowsA = []
    for m in MODELS:
        row = {"모델": m}
        for h in HORIZONS:
            r = sweep[h][m]
            a = r["auc"]; p = r["p_auc"]
            cell = "N/A" if np.isnan(a) else (
                f"{a:.3f} (p={p:.3f})" if not np.isnan(p) else f"{a:.3f} (—)")
            row[f"{h}일"] = cell
        rowsA.append(row)
    print_table(pd.DataFrame(rowsA))

    # (3) 다수결 흉내 진단
    print("\n[상승예측비율]  0.9를 넘으면 모델이 다수결을 흉내내는 중")
    rowsP = []
    for m in MODELS:
        row = {"모델": m}
        for h in HORIZONS:
            row[f"{h}일"] = f"{sweep[h][m]['pred_up_rate']:.2f}"
        rowsP.append(row)
    print_table(pd.DataFrame(rowsP))

    print(f"\n총 학습 횟수: {n_runs}회 (모델 {len(MODELS)} × 시계 {len(HORIZONS)})")
    print(" [주의] 여러 설정을 시도할수록 우연히 좋은 결과가 나올 확률이 커집니다(다중검정).")
    print(f"        {n_runs}번 시도하면 그중 하나가 우연히 p<0.05를 받을 확률은 "
          f"약 {1-(0.95**n_runs):.0%}입니다.")
    print("        따라서 한 시계에서만 유의한 결과는 신뢰하지 마세요.")

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
        ab, af = res_base[m]["auc"], res_full[m]["auc"]
        rowsB.append({"모델": m,
                      "AUC 금리없음": _r(ab), "AUC 금리포함": _r(af),
                      "AUC 차이": _r(af - ab),
                      "정확도 금리없음": _r(b), "정확도 금리포함": _r(f),
                      "정확도 차이": _r(f - b)})
    print_table(pd.DataFrame(rowsB))
    print("\n※ AUC 차이를 우선 보세요. 정확도 차이는 클래스 불균형에 흔들립니다.")
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

    # ==================================================================
    #  실험 E : 시기별(체제별) 금리-주가 관계
    # ==================================================================
    regime_analysis(df, PRIMARY_HORIZON)

    # ---- 시각화 ----
    print("\n[그래프 그리는 중...]")
    plot_price_rate(df)
    plot_auc_bar(resA, MODELS)
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
