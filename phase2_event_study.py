# -*- coding: utf-8 -*-
# ============================================================================
#  Phase 2 : 연준(FOMC) 성명서 이벤트 스터디 (NLP)
#  영남대 SW중심대학사업단 AI·SW 러닝메이트 멘토링
# ----------------------------------------------------------------------------
#  왜 '이벤트 스터디'인가 (접근법)
#     FOMC는 1년에 8번뿐이라 10년을 모아도 표본이 약 80개.
#     머신러닝 학습에는 절대적으로 부족합니다.
#     표본이 적을 때 쓰는 정석이 '이벤트 스터디'이며,
#     Bernanke & Kuttner(2005)가 쓴 바로 그 방법입니다.
#
#  질문: "성명서 톤(매파/비둘기)에 따라 발표 당일·익일 주가 수익률이 다른가?" (가설 H6)
#
#  ★ 데이터 원칙 (반드시 지킴)
#     - 성명서는 federalreserve.gov의 '실제 원문'만 사용 (미국 정부 저작물, 공개).
#     - 텍스트를 절대 지어내지 않습니다. 원문을 못 구하면 그 회차는 분석에서 뺍니다.
#     - 뉴스/경제 사이트 크롤링 안 함. 요청 사이에 딜레이를 둡니다.
# ============================================================================

# ---------------------------------------------------------------------------
#  [0] 설치 : Colab에서 아래 줄 맨 앞 '#'을 지우고 한 번 실행하세요.
#      (톤 방법을 'change'로 쓰면 transformers/torch 없이도 됩니다.)
# ---------------------------------------------------------------------------
# !pip install fredapi requests beautifulsoup4 scikit-learn scipy matplotlib koreanize-matplotlib transformers torch

# ===========================================================================
#  [1] 설정
# ===========================================================================
FRED_API_KEY = ""          # ← 발급받은 FRED API 키를 이 따옴표 안에 붙여넣으세요.
PRICE_SERIES = "SP500"
RATE_SERIES  = "DGS2"
START = "2014-12-01"       # 첫 성명서 반응을 보려면 성명서일보다 조금 앞서 받아둠
END   = "2025-01-01"

# 톤 분석 방법:
#   "roberta" : FOMC-RoBERTa(매파/비둘기 전용 분류기)로 문장별 스탠스 → 순매파도. (권장, transformers 필요)
#   "change"  : 직전 성명서 대비 '문구 변화량'(TF-IDF 코사인 거리). 모델 불필요, 가벼움.
TONE_METHOD = "roberta"

REQUEST_DELAY = 2.0        # 서버 예의를 위해 요청 사이 대기(초)
CACHE_DIR = "fomc_cache"   # 받은 성명서를 저장해 재요청을 줄입니다.
USER_AGENT = "YU-mentoring-research/1.0 (educational; contact via GitHub)"
SEED = 42

# FOMC 성명서 발표일 (federalreserve.gov 실제 일정, 2015~2024). 지어낸 값 아님.
# 성명서 URL: .../pressreleases/monetaryYYYYMMDDa.htm  (이 날짜로 접근)
# 2020년은 코로나 긴급 성명(3/3, 3/15) 포함. 주가 반응은 발표일 이후 첫 거래일로 측정.
STATEMENT_DATES = [
    "2015-01-28","2015-03-18","2015-04-29","2015-06-17","2015-07-29","2015-09-17","2015-10-28","2015-12-16",
    "2016-01-27","2016-03-16","2016-04-27","2016-06-15","2016-07-27","2016-09-21","2016-11-02","2016-12-14",
    "2017-02-01","2017-03-15","2017-05-03","2017-06-14","2017-07-26","2017-09-20","2017-11-01","2017-12-13",
    "2018-01-31","2018-03-21","2018-05-02","2018-06-13","2018-08-01","2018-09-26","2018-11-08","2018-12-19",
    "2019-01-30","2019-03-20","2019-05-01","2019-06-19","2019-07-31","2019-09-18","2019-10-30","2019-12-11",
    "2020-01-29","2020-03-03","2020-03-15","2020-04-29","2020-06-10","2020-07-29","2020-09-16","2020-11-05","2020-12-16",
    "2021-01-27","2021-03-17","2021-04-28","2021-06-16","2021-07-28","2021-09-22","2021-11-03","2021-12-15",
    "2022-01-26","2022-03-16","2022-05-04","2022-06-15","2022-07-27","2022-09-21","2022-11-02","2022-12-14",
    "2023-02-01","2023-03-22","2023-05-03","2023-06-14","2023-07-26","2023-09-20","2023-11-01","2023-12-13",
    "2024-01-31","2024-03-20","2024-05-01","2024-06-12","2024-07-31","2024-09-18","2024-11-07","2024-12-18",
]

# ===========================================================================
#  [2] 임포트 & 재현성
# ===========================================================================
import os, re, time, warnings
os.environ.setdefault("PYTHONHASHSEED", str(SEED))
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy import stats
np.random.seed(SEED)

LABELS = {"LABEL_0": "dovish", "LABEL_1": "hawkish", "LABEL_2": "neutral"}  # FOMC-RoBERTa 라벨


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
#  [3] 성명서 수집 (실제 원문)
# ===========================================================================
def statement_url(date):
    d = pd.to_datetime(date).strftime("%Y%m%d")
    return f"https://www.federalreserve.gov/newsevents/pressreleases/monetary{d}a.htm"


def extract_text(html):
    """HTML에서 성명서 본문 텍스트만 추출."""
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        text = " ".join(p.get_text(" ", strip=True) for p in soup.find_all("p"))
    except Exception:
        text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    # 성명서 핵심 구간만 남기기(가능하면). 시작/끝 앵커를 찾아 잘라냄.
    starts = ["Recent indicators", "Information received", "Economic activity",
              "The Committee", "Consistent with"]
    for s in starts:
        i = text.find(s)
        if i != -1:
            text = text[i:]; break
    for e in ["Voting for the", "Voting against", "Implementation Note"]:
        j = text.find(e)
        if j != -1:
            text = text[:j]; break
    return text


def fetch_statement(date):
    """성명서 원문을 받아 텍스트로 반환. 캐시가 있으면 재사용. 실패하면 None."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = os.path.join(CACHE_DIR, f"{pd.to_datetime(date).strftime('%Y%m%d')}.txt")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return f.read()
    import urllib.request
    url = statement_url(date)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  [경고] {date} 성명서 수집 실패({e}) → 이 회차 제외")
        return None
    text = extract_text(html)
    time.sleep(REQUEST_DELAY)                          # 서버 예의
    if len(text) < 200:                                # 너무 짧으면 파싱 실패로 간주
        print(f"  [경고] {date} 본문이 너무 짧음 → 이 회차 제외")
        return None
    with open(cache, "w", encoding="utf-8") as f:
        f.write(text)
    return text


def collect_statements(dates):
    out = {}
    for d in dates:
        t = fetch_statement(d)
        if t:
            out[d] = t
    print(f"[수집] 성명서 {len(out)}/{len(dates)}회 확보")
    return out


# ===========================================================================
#  [4] 톤 분석
# ===========================================================================
def split_sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [s.strip() for s in parts if len(s.strip()) > 15]


def score_tone_roberta(texts_by_date):
    """FOMC-RoBERTa로 문장별 매파/비둘기 분류 → 순매파도 = (매파-비둘기)/문장수."""
    from transformers import pipeline
    print("[톤] FOMC-RoBERTa 로딩 중... (처음엔 모델 다운로드로 시간이 걸립니다)")
    clf = pipeline("text-classification", model="gtfintechlab/FOMC-RoBERTa", truncation=True)
    tone = {}
    for d, text in texts_by_date.items():
        sents = split_sentences(text)
        if not sents:
            tone[d] = np.nan; continue
        preds = clf(sents)
        hawk = sum(1 for p in preds if LABELS.get(p["label"]) == "hawkish")
        dove = sum(1 for p in preds if LABELS.get(p["label"]) == "dovish")
        tone[d] = (hawk - dove) / len(sents)           # +면 매파, -면 비둘기
    return pd.Series(tone, name="tone")


def score_tone_change(texts_by_date):
    """직전 성명서 대비 문구 변화량(1 - 코사인 유사도). 톤의 '절대값'이 아니라 '변화'를 봄."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    dates = sorted(texts_by_date)
    docs = [texts_by_date[d] for d in dates]
    M = TfidfVectorizer(stop_words="english", max_features=5000).fit_transform(docs)
    change = {dates[0]: np.nan}
    for i in range(1, len(dates)):
        change[dates[i]] = float(1 - cosine_similarity(M[i], M[i - 1])[0, 0])
    return pd.Series(change, name="change")


# ===========================================================================
#  [5] 시장 반응 (당일·익일 수익률) + 금리 서프라이즈 대용치
# ===========================================================================
def load_market():
    try:
        from fredapi import Fred
    except ImportError:
        raise SystemExit("[오류] fredapi가 없습니다. 맨 위 [0] 설치 줄을 먼저 실행하세요.")
    if not FRED_API_KEY:
        raise SystemExit("[오류] FRED_API_KEY가 비어 있습니다. [1] 설정에서 키를 채워주세요.")
    fred = Fred(api_key=FRED_API_KEY)
    price = fred.get_series(PRICE_SERIES, START, END)
    rate  = fred.get_series(RATE_SERIES,  START, END)
    df = pd.concat({"close": price, "rate": rate}, axis=1).dropna().sort_index()
    df["return"] = df["close"].pct_change()
    df["rate_change"] = df["rate"].diff()
    return df.dropna()


def market_reaction(df, date):
    """성명서일 이후 첫 거래일의 '당일' 수익률과 그 '다음' 거래일 수익률."""
    idx = df.index
    pos = idx.searchsorted(pd.to_datetime(date))       # 성명서일 >= 첫 거래일
    if pos >= len(idx) - 1:
        return None
    return dict(trade_day=idx[pos],
                same_day=float(df["return"].iloc[pos]),
                next_day=float(df["return"].iloc[pos + 1]),
                rate_change=float(df["rate_change"].iloc[pos]))  # 2년물 변화(서프라이즈 '대용치')


# ===========================================================================
#  [6] 이벤트 스터디
# ===========================================================================
def event_study(events):
    """톤 부호로 매파/비둘기 그룹을 나눠 평균 수익률 비교 + Welch t검정."""
    hawk = events[events["tone"] > 0]
    dove = events[events["tone"] < 0]
    print(f"\n[그룹] 매파 성명 {len(hawk)}회 / 비둘기 성명 {len(dove)}회 "
          f"/ 중립(톤=0) {len(events)-len(hawk)-len(dove)}회")
    for col, kor in [("same_day", "당일"), ("next_day", "익일")]:
        a, b = hawk[col].dropna(), dove[col].dropna()
        if len(a) < 2 or len(b) < 2:
            print(f"  · {kor}: 표본 부족으로 검정 생략"); continue
        t, p = stats.ttest_ind(a, b, equal_var=False)
        print(f"  · {kor} 수익률: 매파 평균 {a.mean()*100:+.2f}% vs 비둘기 평균 {b.mean()*100:+.2f}%"
              f"  (차이 {(a.mean()-b.mean())*100:+.2f}%p, t={t:.2f}, p={p:.3f}"
              f" → {'유의미 ✓' if p < 0.05 else '유의하지 않음'})")
    # 톤과 수익률의 상관
    for col, kor in [("same_day", "당일"), ("next_day", "익일")]:
        sub = events[["tone", col]].dropna()
        if len(sub) > 3:
            r, p = stats.pearsonr(sub["tone"], sub[col])
            print(f"  · 톤 vs {kor} 수익률 상관계수 r={r:+.2f} (p={p:.3f})")


def bernanke_kuttner_note():
    print("\n[해석 기준 — Bernanke & Kuttner(2005)]")
    print("  '예상치 못한' 25bp 인하가 주가지수를 약 1% 올린다고 보고했습니다.")
    print("  핵심은 금리 '수준'이 아니라 '서프라이즈'(예상 대비 놀람)입니다.")
    print("  우리의 2년물 금리변화는 서프라이즈의 '대용치'일 뿐임에 주의하세요.")
    print("  (정확한 서프라이즈는 연방기금 선물이 필요하며 여기선 다루지 않습니다.)")


# ===========================================================================
#  [7] 시각화
# ===========================================================================
def plot_tone_return(events):
    sub = events[["tone", "next_day"]].dropna()
    plt.figure(figsize=(7, 5))
    plt.scatter(sub["tone"], sub["next_day"] * 100, alpha=0.7)
    plt.axhline(0, color="gray", lw=0.6); plt.axvline(0, color="gray", lw=0.6)
    plt.xlabel("성명서 톤 (+매파 / -비둘기)"); plt.ylabel("익일 주가 수익률(%)")
    plt.title("성명서 톤 vs 익일 주가 수익률")
    plt.tight_layout(); plt.show()


def plot_group_means(events):
    hawk = events[events["tone"] > 0]; dove = events[events["tone"] < 0]
    labels = ["매파-당일", "비둘기-당일", "매파-익일", "비둘기-익일"]
    vals = [hawk["same_day"].mean()*100, dove["same_day"].mean()*100,
            hawk["next_day"].mean()*100, dove["next_day"].mean()*100]
    plt.figure(figsize=(7, 4.5))
    plt.bar(labels, vals, color=["tab:red", "tab:blue", "tab:red", "tab:blue"], alpha=0.8)
    plt.axhline(0, color="black", lw=0.6); plt.ylabel("평균 수익률(%)")
    plt.title("톤 그룹별 평균 주가 수익률")
    plt.tight_layout(); plt.show()


# ===========================================================================
#  [8] 메인
# ===========================================================================
def main():
    setup_korean_font()
    print("=" * 66)
    print(f"[Phase 2] FOMC 성명서 이벤트 스터디  (톤 방법 = {TONE_METHOD})")
    print("=" * 66)

    market = load_market()
    texts = collect_statements(STATEMENT_DATES)
    if len(texts) < 10:
        raise SystemExit("[오류] 확보된 성명서가 너무 적습니다. 네트워크/URL을 확인하세요.")

    # 톤 점수
    if TONE_METHOD == "roberta":
        tone = score_tone_roberta(texts)
    elif TONE_METHOD == "change":
        # 변화량은 톤의 '부호'가 없으므로, 그룹 비교용으로 중앙값 기준 상/하로 나눕니다.
        chg = score_tone_change(texts)
        tone = (chg - chg.median()).rename("tone")     # +면 '많이 바뀜', -면 '적게 바뀜'
        print("[주의] 'change' 방법은 매파/비둘기 방향이 아니라 '문구 변화량'입니다.")
    else:
        raise SystemExit(f"[오류] 알 수 없는 TONE_METHOD: {TONE_METHOD}")

    # 시장 반응 결합
    rows = []
    for d in texts:
        mr = market_reaction(market, d)
        if mr is None or pd.isna(tone.get(d, np.nan)):
            continue
        rows.append(dict(date=pd.to_datetime(d), tone=float(tone[d]),
                         same_day=mr["same_day"], next_day=mr["next_day"],
                         rate_change=mr["rate_change"]))
    events = pd.DataFrame(rows).set_index("date").sort_index()
    print(f"\n[이벤트 표] 분석 가능한 회차 {len(events)}개")
    print(events.assign(tone=events["tone"].round(3),
                        same_day=(events["same_day"]*100).round(2),
                        next_day=(events["next_day"]*100).round(2),
                        rate_change=events["rate_change"].round(3)).tail(10).to_string())

    # 이벤트 스터디 (가설 H6)
    event_study(events)
    bernanke_kuttner_note()

    print("\n[정직한 주의]")
    print(f"  · 표본이 {len(events)}개로 작습니다. p값이 유의해도 과대해석 금지.")
    print("  · 톤 차이가 유의하지 않으면 H6는 기각 — 그대로 보고합니다.")
    print("  · 교육·연구용입니다.")

    plot_tone_return(events)
    plot_group_means(events)


if __name__ == "__main__":
    main()
