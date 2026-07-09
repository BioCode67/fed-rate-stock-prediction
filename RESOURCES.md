# 참고자료 (수준별 정리)

주식·머신러닝·통계가 처음이어도 볼 수 있도록 쉬운 것부터 어려운 것까지 정리했습니다.
한국어 자료를 중심으로 담았고, 필요한 곳에만 영어 자료를 넣었습니다. 너무 어려우면 건너뛰고
관심 가는 것부터 보면 됩니다.

영어 영상은 유튜브 설정에서 자막을 켜고 자동 번역(한국어)을 선택하면 한글 자막으로 볼 수 있습니다.


## 먼저 볼 것 세 가지

시간이 없다면 이 세 개만 봐도 프로젝트의 절반은 이해됩니다.

1. 김성범 교수 [핵심 머신러닝] — 우리가 쓰는 모델(의사결정나무, 랜덤포레스트 등)을 한국어로 설명
   https://www.youtube.com/playlist?list=PLpIPLT0Pf7IoTxTCi2MEQ94MZnHaxrP0j
2. 모두를 위한 딥러닝 (김성훈 교수) — 신경망과 딥러닝의 기초. LSTM 이해에 도움
   https://hunkim.github.io/ml/
3. But what is a neural network? (3Blue1Brown, 영어·자막 가능) — 신경망을 그림으로 보여주는 명강의
   https://www.youtube.com/watch?v=aircAruvnKk


## 한국어 강의·자료

### 머신러닝 개념 (영상)

- 김성범 교수 [핵심 머신러닝] (고려대 산업경영공학부)
  랜덤포레스트, 부스팅, 의사결정나무 등 우리가 실제로 쓰는 모델을 차근차근 설명합니다.
  - 재생목록: https://www.youtube.com/playlist?list=PLpIPLT0Pf7IoTxTCi2MEQ94MZnHaxrP0j
  - 채널: https://www.youtube.com/channel/UCueLU1pCvFlM8Y8sth7a6RQ
- 모두를 위한 딥러닝 (김성훈 교수)
  딥러닝과 신경망 입문으로 가장 널리 쓰이는 한국어 강의입니다. LSTM(1-a의 딥러닝 모델) 이해에 좋습니다.
  - 강의 사이트: https://hunkim.github.io/ml/
  - 유튜브 재생목록: https://www.youtube.com/playlist?list=PLlMkM4tgfjnLSOjrEJN31gZATbcj_MpUm
- 테디노트 (TeddyNote)
  파이썬, 판다스, 데이터 분석, 머신러닝 실습을 다루는 채널입니다. 코드를 직접 따라 하기 좋습니다.
  - 유튜브: https://www.youtube.com/channel/UCt2wAAXgm87ACiQnDHQEW6Q
  - 실습 코드 저장소: https://github.com/teddylee777/machine-learning

### 통계·수학·파이썬 기초 (읽기 자료)

- 데이터 사이언스 스쿨 (김도형)
  통계, 머신러닝, 시계열 분석을 글로 정리한 무료 사이트입니다. 저자가 퀀트(금융 데이터 분석가)
  출신이라 우리 주제와도 잘 맞습니다. p값, 회귀, 시계열 부분을 참고하세요.
  https://datascienceschool.net/
- Khan Academy 통계와 확률 (한국어)
  p값, 가설검정, 평균·표준편차 등 우리 프로젝트의 t검정과 기준선 개념의 바탕이 됩니다.
  https://ko.khanacademy.org/math/statistics-probability
- 점프 투 파이썬 (위키독스, 무료 전자책)
  파이썬 문법이 낯설다면 여기부터 보면 됩니다.
  https://wikidocs.net/book/1

### 금리·경제 이해

금리와 주가, 연준(FOMC)에 대한 배경 지식은 아래 검색어로 한국어 영상을 찾아보길 권합니다.
경제 유튜버들의 5~10분짜리 요약 영상이 입문에 적당합니다.

- 검색어 예: `금리와 주가 관계`, `연준 FOMC 매파 비둘기`, `효율적 시장 가설 쉽게`


## 영어 강의 (자막 켜고 보기)

- 3Blue1Brown — 신경망 시리즈
  수식 없이 애니메이션으로 신경망의 원리를 보여줍니다.
  - 재생목록: https://www.youtube.com/playlist?list=PLZZWrBYkx7Otcjr3eCLZDCgfpqnxMY29s
  - 1편(신경망이란): https://www.youtube.com/watch?v=aircAruvnKk
- StatQuest with Josh Starmer
  혼동행렬, ROC/AUC, 랜덤포레스트, XGBoost 등 우리가 쓰는 개념을 짧고 친절하게 설명합니다.
  - 채널: https://www.youtube.com/@statquest
  - 전체 영상 목록: https://statquest.org/video-index/
- Kaggle Learn (브라우저에서 바로 실습)
  파이썬 → 머신러닝 입문 순서로 무료 실습 과정을 제공합니다.
  https://www.kaggle.com/learn


## 이 프로젝트가 쓰는 도구·데이터 (문서)

코드에서 무엇을 어디서 가져오는지 확인할 때 봅니다. 대부분 영어 공식 문서입니다.

- FRED (미국 경제 데이터, 주가·금리): https://fred.stlouisfed.org
  - API 키 발급: https://fred.stlouisfed.org/docs/api/api_key.html
- yfinance (야후 파이낸스 주가, 3단계): https://github.com/ranaroussi/yfinance
- arch (GARCH 변동성 모델, 1-c): https://arch.readthedocs.io
- statsmodels (ARIMA 등 통계 시계열): https://www.statsmodels.org
- XGBoost 공식 문서: https://xgboost.readthedocs.io
- 연준 FOMC 일정·성명서 원문 (2단계, 공개 자료): https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Trillion Dollar Words — FOMC 매파/비둘기 데이터셋과 모델 (2단계):
  - 데이터셋: https://huggingface.co/datasets/gtfintechlab/fomc_communication
  - 분류 모델(FOMC-RoBERTa): https://huggingface.co/gtfintechlab/FOMC-RoBERTa


## 참고 논문 (도전)

내용은 어렵지만, 이 프로젝트가 실제 연구를 따라 하고 있다는 근거입니다. 초록(요약)만 읽어도
충분합니다. 원문은 영어입니다.

- Bernanke & Kuttner (2005) — 금리와 주가의 핵심 논문
  예상치 못한 25bp 금리 인하가 주가지수를 약 1% 올린다. 중요한 것은 금리 수준이 아니라 '서프라이즈'다.
  https://www.nber.org/papers/w10402
- Gu, Kelly & Xiu (2020) — 여러 머신러닝 모델로 자산가격 예측 비교 (1·3단계의 모범)
  트리 계열과 신경망이 좋았고, 이유는 비선형 상호작용을 잘 잡아내기 때문.
  https://www.nber.org/papers/w25398
- Welch & Goyal (2008) — 예측은 생각보다 잘 안 된다는 회의론 (결과 해석의 근거)
  학계가 제안한 예측 변수 대부분이 실제로는 별 쓸모가 없었다.
  https://www.nber.org/papers/w10483
- Shah, Paturi & Chava (2023) "Trillion Dollar Words" — 2단계와 거의 같은 작업
  FOMC 문서를 매파/비둘기로 분류하는 모델을 만들고 시장 반응을 분석. 데이터셋을 공개.
  https://arxiv.org/abs/2305.07972
- Bailey & López de Prado (2014) "The Deflated Sharpe Ratio" — 백테스트의 함정
  전략을 여러 번 시도하면 우연히 좋은 것이 나온다. 시도 횟수만큼 성과를 깎아서 봐야 한다.
  (제목으로 Google Scholar 또는 SSRN에서 검색)


## 한국어로 더 찾을 때

유튜브나 검색창에 아래 단어를 넣으면 한국어 설명을 찾을 수 있습니다.

- 랜덤포레스트, XGBoost, LSTM, ARIMA 시계열
- 정확도 정밀도 재현율, 혼동행렬, ROC AUC
- p값, 가설검정
- 금리와 주가 관계, FOMC 매파 비둘기, 효율적 시장 가설
- 백테스트, 샤프지수, 최대낙폭
