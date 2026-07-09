# 참고자료 (수준별 정리)

주식·머신러닝·통계가 처음이어도 볼 수 있도록 쉬운 것부터 어려운 것까지 모았습니다.
한국어 자료를 중심으로 담았고, 필요한 곳에만 영어 자료를 넣었습니다. 처음부터 다 볼 필요는
없습니다. 지금 하는 단계에 맞는 것부터, 관심 가는 것부터 보면 됩니다.

영어 영상은 유튜브 설정에서 자막을 켜고 자동 번역(한국어)을 선택하면 한글 자막으로 볼 수 있습니다.
아래에서 (한)은 한국어 자료, (영)은 영어 자료입니다.


## 공부 순서 (추천 로드맵)

한 번에 다 하려 하지 말고 아래 순서로 조금씩 넓혀가면 됩니다.

1. 파이썬을 처음 본다면: 점프 투 파이썬으로 문법에 익숙해지기
2. 머신러닝이 뭔지 감 잡기: 김성범 [핵심 머신러닝] 앞부분 몇 개
3. 우리가 쓰는 지표 이해: StatQuest의 혼동행렬, ROC/AUC 영상
4. 신경망 감 잡기: 3Blue1Brown 1편, 모두를 위한 딥러닝 앞부분
5. 우리 주제(금리·주가) 배경: 한국은행 경제교육, 아래 금융 자료
6. 여유가 되면: 시계열(ARIMA/GARCH), 백테스트, 논문으로 확장

지금 코드의 어떤 단계를 하고 있는지에 따라 아래 "단계별 추천"을 먼저 봐도 좋습니다.


## 먼저 볼 것 세 가지

시간이 없다면 이 세 개만 봐도 프로젝트의 절반은 이해됩니다.

1. 김성범 교수 [핵심 머신러닝] (한) — 우리가 쓰는 모델을 한국어로 설명
   https://www.youtube.com/playlist?list=PLpIPLT0Pf7IoTxTCi2MEQ94MZnHaxrP0j
2. 모두를 위한 딥러닝 (김성훈 교수) (한) — 신경망과 딥러닝의 기초
   https://hunkim.github.io/ml/
3. But what is a neural network? (3Blue1Brown) (영, 자막 가능) — 신경망을 그림으로 보여주는 명강의
   https://www.youtube.com/watch?v=aircAruvnKk


## 단계(Phase)별 추천 자료

코드의 각 단계를 공부할 때 함께 보면 좋은 자료입니다.

- 1-a (네 모델 비교)
  - 김성범 [핵심 머신러닝]: 의사결정나무, 랜덤포레스트, 부스팅 편 (한)
  - StatQuest: The Confusion Matrix, ROC and AUC (영)
  - 3Blue1Brown 신경망 1편, 모두를 위한 딥러닝: LSTM 이해 (한/영)
- 1-b (백테스트)
  - 파이썬으로 배우는 알고리즘 트레이딩 (한, 무료)
  - 검색어: 샤프지수, 최대낙폭(MDD), 백테스트 과최적화
  - Deflated Sharpe Ratio 논문 (영, 아래 논문 항목)
- 1-c (GARCH 변동성)
  - Forecasting: Principles and Practice (영, 무료 온라인 교재)
  - arch 라이브러리 문서 (영)
  - 검색어: 변동성 군집, ARCH GARCH 쉽게
- 2 (연준 성명서 이벤트 스터디)
  - Trillion Dollar Words 데이터셋·모델 (아래 데이터 항목)
  - 이수안컴퓨터연구소: 자연어처리(NLP) 관련 강의 (한)
  - Bernanke & Kuttner 논문, federalreserve.gov 원문
- 3 (종목 순위 예측)
  - Gu, Kelly & Xiu 논문 (영, 아래 논문 항목)
  - Kaggle Time Series 강의 (영)
  - 데이터 사이언스 스쿨: 회귀·머신러닝 부분 (한)


## 파이썬 기초 (한)

코드가 낯설다면 문법부터.

- 점프 투 파이썬 (위키독스, 무료 전자책)
  가장 널리 쓰이는 한국어 파이썬 입문서입니다.
  https://wikidocs.net/book/1
- 테디노트 (TeddyNote)
  파이썬, 판다스(pandas), 시각화, 데이터 분석 실습을 다룹니다. 코드를 따라 하기 좋습니다.
  - 유튜브: https://www.youtube.com/channel/UCt2wAAXgm87ACiQnDHQEW6Q
  - 실습 코드 저장소: https://github.com/teddylee777/machine-learning


## 머신러닝 개념 (한, 영상)

- 김성범 교수 [핵심 머신러닝] (고려대 산업경영공학부)
  랜덤포레스트, 부스팅, 의사결정나무 등 우리가 실제로 쓰는 모델을 차근차근 설명합니다.
  통계 배경도 함께 다뤄 개념의 뿌리까지 이해하기 좋습니다.
  - 재생목록: https://www.youtube.com/playlist?list=PLpIPLT0Pf7IoTxTCi2MEQ94MZnHaxrP0j
  - 채널: https://www.youtube.com/channel/UCueLU1pCvFlM8Y8sth7a6RQ
- 이수안컴퓨터연구소
  머신러닝, 딥러닝, 데이터 분석, 자연어처리를 폭넓게 다루는 채널입니다. 주제별 영상이 많아
  필요한 부분만 골라 보기 좋습니다.
  - 유튜브: https://www.youtube.com/@suanlab
  - 사이트: https://suanlab.com
- 혁펜하임 (AI & 딥러닝 강의)
  KAIST 출신 강사의 채널로, 수학·파이썬 기초부터 딥러닝까지 단계별로 설명합니다.
  https://www.youtube.com/@hyukppen


## 딥러닝·신경망 (한 / 영)

LSTM(1-a의 딥러닝 모델)을 이해하는 데 도움이 됩니다.

- 모두를 위한 딥러닝 (김성훈 교수) (한)
  딥러닝 입문으로 가장 널리 쓰이는 한국어 강의입니다.
  - 강의 사이트: https://hunkim.github.io/ml/
  - 유튜브 재생목록: https://www.youtube.com/playlist?list=PLlMkM4tgfjnLSOjrEJN31gZATbcj_MpUm
- 혁펜하임: 딥러닝 재생목록 (한)
  https://www.youtube.com/playlist?list=PL_iJu012NOxdDZEygsVG4jS8srnSdIgdn
- 3Blue1Brown: 신경망 시리즈 (영, 자막 가능)
  수식 없이 애니메이션으로 신경망의 원리를 보여줍니다.
  - 재생목록: https://www.youtube.com/playlist?list=PLZZWrBYkx7Otcjr3eCLZDCgfpqnxMY29s
  - 1편(신경망이란): https://www.youtube.com/watch?v=aircAruvnKk
  - 2편(경사하강법): https://www.youtube.com/watch?v=IHZwWFHWa-w


## 머신러닝 개념 (영, 영상·실습)

- StatQuest with Josh Starmer
  혼동행렬, ROC/AUC, 랜덤포레스트, XGBoost 등 우리가 쓰는 개념을 짧고 친절하게 설명합니다.
  - 채널: https://www.youtube.com/@statquest
  - 전체 영상 목록: https://statquest.org/video-index/
- Kaggle Learn (브라우저에서 바로 실습)
  파이썬 → 머신러닝 입문 순서로 무료 실습 과정을 제공합니다.
  https://www.kaggle.com/learn


## 통계·확률·검정

정확도, 기준선, p값, t검정 같은 개념의 바탕입니다.

- Khan Academy 통계와 확률 (한)
  p값, 가설검정, 평균·표준편차 등 우리 프로젝트의 t검정과 기준선 개념의 기초입니다.
  https://ko.khanacademy.org/math/statistics-probability
- 데이터 사이언스 스쿨 (김도형) (한)
  통계, 회귀분석, 머신러닝, 시계열을 글로 정리한 무료 사이트입니다. 저자가 퀀트(금융 데이터
  분석가) 출신이라 우리 주제와도 잘 맞습니다.
  https://datascienceschool.net/


## 시계열·ARIMA·GARCH

1-a의 ARIMA와 1-c의 GARCH를 더 깊이 보고 싶을 때.

- 데이터 사이언스 스쿨: 시계열 분석 부분 (한)
  https://datascienceschool.net/
- Forecasting: Principles and Practice (Hyndman) (영, 무료 온라인 교재)
  시계열 예측의 표준 교재로, 온라인에 전문이 무료 공개되어 있습니다.
  - 3판: https://otexts.com/fpp3/
  - 파이썬 판: https://otexts.com/fpppy/
- Kaggle: Time Series 강의 (영, 무료 실습)
  https://www.kaggle.com/learn/time-series
- arch 라이브러리 문서 (영) — GARCH 구현
  https://arch.readthedocs.io
- 한국어로 더 찾을 때: `ARIMA 시계열 쉽게`, `변동성 군집 GARCH`, `정상성 stationarity`


## 금융·금리·연준 (한)

금리와 주가, 연준(FOMC)에 대한 배경 지식.

- 한국은행 경제교육
  통화정책, 금융시장, 금리 등을 다루는 공신력 있는 무료 자료입니다. "알기 쉬운 경제이야기"로
  시작해 E-learning으로 넘어가면 됩니다.
  - 경제교육 메인: https://www.bok.or.kr/portal/submain/submain/ecEdu.do?viewType=SUBMAIN&menuNo=200131
  - 일반인 온라인 학습: https://www.bok.or.kr/portal/main/contents.do?menuNo=201316
- 한국어로 더 찾을 때: `금리와 주가 관계`, `연준 FOMC 매파 비둘기`, `효율적 시장 가설 쉽게`,
  `기준금리 통화정책 쉽게`


## 알고리즘 트레이딩·백테스트 (한)

1-b(백테스트)와 관련이 깊습니다.

- 파이썬으로 배우는 알고리즘 트레이딩 (조대표) (한, 무료 온라인)
  파이썬 기초부터 데이터 분석, 자동매매까지 다루는 입문서입니다. 전문이 위키독스에 공개되어
  있습니다. 우리 프로젝트의 금융 데이터·백테스트 감각을 익히는 데 좋습니다.
  - 위키독스: https://wikidocs.net/book/110
- 한국어로 더 찾을 때: `백테스트 과최적화`, `샤프지수 최대낙폭`, `거래비용 슬리피지`


## 자연어처리(NLP) — 2단계 관련

연준 성명서의 논조 분석과 관련됩니다.

- 이수안컴퓨터연구소: 자연어처리 관련 강의 (한)
  https://www.youtube.com/@suanlab
- Trillion Dollar Words 데이터셋·모델 (아래 데이터 항목 참고)
- 한국어로 더 찾을 때: `자연어처리 입문`, `감성분석 sentiment`, `BERT 쉽게`


## 실습 환경·도구 문서

코드에서 무엇을 어디서 가져오는지 확인할 때. 대부분 영어 공식 문서입니다.

- Google Colab (우리가 코드를 실행하는 곳): https://colab.research.google.com
- scikit-learn (RandomForest·평가지표 등): https://scikit-learn.org/stable/
- statsmodels (ARIMA 등 통계 시계열): https://www.statsmodels.org
- XGBoost 공식 문서: https://xgboost.readthedocs.io
- arch (GARCH): https://arch.readthedocs.io
- yfinance (야후 파이낸스 주가): https://github.com/ranaroussi/yfinance


## 데이터 출처

- FRED (미국 경제 데이터, 주가·금리): https://fred.stlouisfed.org
  - API 키 발급: https://fred.stlouisfed.org/docs/api/api_key.html
- 연준 FOMC 일정·성명서 원문 (2단계, 공개 자료): https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Trillion Dollar Words — FOMC 매파/비둘기 데이터셋과 모델 (2단계)
  - 데이터셋: https://huggingface.co/datasets/gtfintechlab/fomc_communication
  - 분류 모델(FOMC-RoBERTa): https://huggingface.co/gtfintechlab/FOMC-RoBERTa
- 투자 용어 사전 (영, 자동번역 추천): https://www.investopedia.com
  - 찾아볼 단어: interest rate, Federal Reserve, hawkish/dovish, Sharpe ratio, drawdown


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


## 한국어로 더 찾을 때 (검색어 모음)

유튜브나 검색창에 아래 단어를 넣으면 한국어 설명을 찾을 수 있습니다.

- 모델: `랜덤포레스트 쉽게`, `XGBoost 설명`, `LSTM 쉽게`, `ARIMA 시계열`, `GARCH 변동성`
- 지표: `정확도 정밀도 재현율`, `혼동행렬 이란`, `ROC AUC 쉽게`, `MCC 상관계수`
- 통계: `p값 뜻`, `가설검정 쉽게`, `t검정`, `다중검정 문제`
- 금융: `금리와 주가 관계`, `연준 FOMC 매파 비둘기`, `효율적 시장 가설`, `기준금리`
- 실무: `백테스트`, `샤프지수 최대낙폭`, `생존편향 survivorship`, `거래비용`


## 공부하다 막힐 때

- 모르는 용어가 나오면 먼저 README의 "용어 정리"를 보세요.
- 그래도 막히면 검색어로 짧은 한국어 영상을 먼저 보고, 개념을 잡은 뒤 코드로 돌아오세요.
- 코드가 에러를 내면 에러 메시지의 마지막 줄을 그대로 검색해 보는 것도 좋은 방법입니다.
- 무엇이든 모르는 것은 당연합니다. 멘토에게 편하게 물어보세요.
