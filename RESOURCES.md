# 📚 참고자료 모음 (수준별)

주가·인공지능·통계가 처음이어도 괜찮아요. **아주 쉬운 영상부터 진짜 논문까지** 단계별로 정리했어요.
너무 어려우면 건너뛰고, 재미있어 보이는 것부터 보세요. 🙂

> 링크는 모두 실제로 존재하는 자료만 넣었어요. (영어 자료는 대부분 자동 한글 자막을 켤 수 있습니다: 유튜브 설정 ⚙️ → 자막 → 자동 번역 → 한국어)

---

## ⭐ 딱 3개만 먼저 보기

바쁘면 이 3개만! 이것만 봐도 프로젝트 절반은 이해돼요.

1. 🎬 **신경망이 대체 뭐야?** — 3Blue1Brown (14분, 세계 최고의 그림 설명)
   https://www.youtube.com/watch?v=aircAruvnKk
2. 🎬 **랜덤 포레스트 / 혼동행렬 / ROC-AUC** — StatQuest 영상 목록에서 골라 보기 (한 편 10분 내외)
   https://statquest.org/video-index/
3. 🧑‍💻 **직접 코딩 맛보기** — Kaggle Learn "Intro to Machine Learning" (설치 없이 브라우저에서)
   https://www.kaggle.com/learn/intro-to-machine-learning

---

## 레벨 0 — 개념을 '그림'으로 (영상) 🎬

가장 쉬운 출발점. 수식 없이 그림과 애니메이션으로 이해해요.

- **3Blue1Brown — 신경망(딥러닝) 시리즈**: 신경망이 어떻게 배우는지 그림으로. LSTM 이해에 도움.
  - 재생목록: https://www.youtube.com/playlist?list=PLZZWrBYkx7Otcjr3eCLZDCgfpqnxMY29s
  - 1편 "신경망이란?": https://www.youtube.com/watch?v=aircAruvnKk
  - 2편 "경사하강법, 신경망은 어떻게 배우나": https://www.youtube.com/watch?v=IHZwWFHWa-w
- **StatQuest with Josh Starmer**: 우리가 쓰는 개념을 세상에서 제일 친절하게 설명. ("BAM!" 하는 그 채널)
  - 채널: https://www.youtube.com/@statquest
  - 전체 영상 목록: https://statquest.org/video-index/
  - 여기서 꼭 볼 것: *Random Forests*, *XGBoost*, *The Confusion Matrix*, *ROC and AUC*, *Decision Trees*

---

## 레벨 1 — 직접 해보기 (실습·문서) 🧑‍💻

눈으로만 보지 말고 손으로 해보면 확 늘어요.

- **Kaggle Learn** (무료, 브라우저에서 바로 실습): https://www.kaggle.com/learn
  - 추천 순서: *Python* → *Intro to Machine Learning* → *Intermediate Machine Learning*
- **Google Colab** (우리가 코드를 돌리는 곳): https://colab.research.google.com
  - 사용법이 궁금하면 유튜브에 "코랩 사용법" 검색
- **scikit-learn 공식 문서** (RandomForest·지표 등 우리가 쓴 도구): https://scikit-learn.org/stable/
- **파이썬 기초가 필요하면**: 점프 투 파이썬 (무료 한국어 책) https://wikidocs.net/book/1

---

## 레벨 2 — 통계·금융 기초 📊

'기준선', 'p값', '금리' 같은 개념의 바탕.

- **Khan Academy — 통계와 확률** (한국어 일부 지원): https://ko.khanacademy.org/math/statistics-probability
  - p값, 가설검정, 평균/표준편차 → 우리 프로젝트의 t검정·기준선 이해에 필수
- **금리·주식 용어**: 투자 용어 사전 Investopedia (영어, 자동번역 추천): https://www.investopedia.com
  - 검색해 볼 단어: *interest rate*, *Federal Reserve*, *hawkish/dovish*, *Sharpe ratio*, *drawdown*
- **한국어로 쉽게**: 유튜브에서 "금리와 주가 관계", "연준 FOMC 쉽게" 검색 (경제 유튜버들의 5~10분 요약 영상)

---

## 레벨 3 — 이 프로젝트에 실제로 쓴 도구·데이터 🛠️

코드에서 무엇을 어디서 가져오는지 궁금할 때.

- **FRED** (미국 경제 데이터, 주가·금리 출처): https://fred.stlouisfed.org
  - 무료 API 키 발급: https://fred.stlouisfed.org/docs/api/api_key.html
- **yfinance** (야후 파이낸스에서 주가 받기, Phase 3): https://github.com/ranaroussi/yfinance
- **arch** (GARCH 변동성 모델, Phase 1-c): https://arch.readthedocs.io
- **statsmodels** (ARIMA 등 통계 시계열): https://www.statsmodels.org
- **XGBoost 공식 문서**: https://xgboost.readthedocs.io
- **연준(FOMC) 공식 일정·성명서 원문** (Phase 2, 공개 저작물): https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- **Trillion Dollar Words — FOMC 매파/비둘기 데이터셋 & 모델** (Phase 2):
  - 데이터셋: https://huggingface.co/datasets/gtfintechlab/fomc_communication
  - 분류 모델(FOMC-RoBERTa): https://huggingface.co/gtfintechlab/FOMC-RoBERTa

---

## 레벨 4 — 진짜 논문에 도전! 📄

어려워요. 하지만 **우리 프로젝트가 장난이 아니라 진짜 연구를 따라 하는 것**임을 보여주는 근거예요. 초록(요약)만 읽어도 충분합니다.

- **Bernanke & Kuttner (2005)** — 금리와 주가의 핵심 논문
  무슨 내용? *"예상치 못한" 25bp 금리 인하가 주가지수를 약 1% 올린다. 중요한 건 금리 수준이 아니라 '놀람(서프라이즈)'이다.*
  https://www.nber.org/papers/w10402
- **Gu, Kelly & Xiu (2020)** — 여러 AI 모델로 자산가격 예측 비교 (우리 Phase 1·3의 모범)
  무슨 내용? *트리 계열과 신경망이 좋았고, 이유는 '비선형 상호작용'을 잡아내기 때문.*
  https://www.nber.org/papers/w25398
- **Welch & Goyal (2008)** — "사실 예측은 잘 안 된다"는 회의론 (우리 결과 해석의 근거)
  무슨 내용? *학계가 제안한 예측 변수 대부분이 실제로는 별 쓸모가 없었다.*
  https://www.nber.org/papers/w10483
- **Shah, Paturi & Chava (2023) "Trillion Dollar Words"** — 우리 Phase 2와 거의 같은 작업
  무슨 내용? *FOMC 문서를 매파/비둘기로 분류하는 AI를 만들고 시장 반응을 분석. 데이터셋을 공개.*
  https://arxiv.org/abs/2305.07972
- **Bailey & López de Prado (2014) "The Deflated Sharpe Ratio"** — 백테스트의 함정
  무슨 내용? *전략을 여러 번 시도하면 우연히 좋은 게 나온다. 시도 횟수만큼 성과를 깎아서 봐야 한다.*
  (제목으로 Google Scholar / SSRN 검색)

---

## 🇰🇷 한국어로 더 찾고 싶다면

유튜브·구글에 아래 검색어를 넣어 보세요 (한국어 설명 영상이 많아요):

- `랜덤포레스트 쉽게`, `XGBoost 설명`, `LSTM 쉽게`, `ARIMA 시계열`
- `머신러닝 정확도 정밀도 재현율`, `혼동행렬 이란`, `ROC AUC 쉽게`
- `p값 뜻`, `가설검정 쉽게`
- `금리와 주가 관계`, `FOMC 매파 비둘기`, `효율적 시장 가설`
- `백테스트 뜻`, `샤프지수 MDD`

추천 한국어 채널(검색해서 구독하세요): **테디노트**, **혁펜하임**, **김성범[핵심 머신러닝]**

---

> 궁금한 게 생기면 멘토에게 편하게 물어보세요. 모르는 건 당연한 거예요. 하나씩 알아가면 됩니다! 🚀
