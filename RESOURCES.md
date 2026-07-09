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


## 우리가 쓰는 모델·개념, 한 문단 요약

자료를 보기 전에 큰 그림을 잡아두면 훨씬 이해가 빠릅니다. 아래는 각 개념을 최대한 쉽게
풀어 쓴 것입니다. 정확한 설명은 위 강의들에서 보충하세요.

- ARIMA (전통 통계 시계열)
  과거 값들의 흐름만 보고 다음 값을 추정하는 고전적인 방법입니다. "어제와 그제가 이랬으니
  내일은 대략 이쯤"이라고 보는 식입니다. 특징(feature)을 따로 쓰지 않고 수익률 시계열 하나만
  봅니다. 먼 미래로 갈수록 예측이 평균 근처로 수렴하는 경향이 있습니다.

- 랜덤포레스트 (배깅 계열)
  여러 개의 "결정 트리(스무고개 같은 규칙 나무)"를 각각 조금씩 다른 데이터로 만든 뒤, 그들의
  다수결로 결정합니다. 한 나무가 실수해도 여럿이 모이면 안정적이 됩니다. 이렇게 여럿을 모아
  평균 내는 방식을 배깅(bagging)이라고 합니다.

- XGBoost (부스팅 계열)
  나무를 한 번에 여럿 만드는 대신, 앞선 나무가 틀린 부분을 다음 나무가 집중해서 보완하도록
  순서대로 쌓아 올립니다. 이렇게 약점을 이어서 메우는 방식을 부스팅(boosting)이라고 합니다.
  보통 표 형태(정형) 데이터에서 성능이 좋습니다.

- LSTM (딥러닝, 순환신경망)
  시간 순서가 있는 데이터를 위해 만들어진 신경망으로, "며칠 전 정보를 기억"하면서 다음을
  예측합니다. 우리 코드에서는 SEQ_LEN일치 과거를 한 덩어리로 보고 방향을 예측합니다. 학습에
  시간이 가장 오래 걸리는 모델입니다.

- GARCH (변동성 모델)
  방향(오를까/내릴까)이 아니라 "얼마나 출렁일까(변동성)"를 다룹니다. 큰 충격이 온 다음 날엔
  변동성이 크고, 잠잠하면 계속 잠잠한 "변동성은 뭉쳐서 온다"는 성질을 잡아냅니다. 1-c에서 씁니다.

- 이벤트 스터디 (2단계)
  표본이 적을 때(예: 연 8회뿐인 FOMC 발표) 쓰는 정석적인 방법입니다. 특정 사건 전후로 주가가
  어떻게 움직였는지를 모아 평균을 비교합니다. 머신러닝 학습 대신 통계 검정을 씁니다.

- 워크포워드·백테스트 (1단계-b, 3단계)
  과거 데이터로 "이 전략을 실제로 썼다면?"을 모의실험하는 것이 백테스트입니다. 워크포워드는
  한 번 학습하고 끝내지 않고, 시간이 지나며 새 데이터로 다시 학습하는 더 현실적인 방식입니다.


## 파이썬 기초 (한)

코드가 낯설다면 문법부터.

- 점프 투 파이썬 (위키독스, 무료 전자책)
  가장 널리 쓰이는 한국어 파이썬 입문서입니다.
  https://wikidocs.net/book/1
- 테디노트 (TeddyNote)
  파이썬, 판다스(pandas), 시각화, 데이터 분석 실습을 다룹니다. 코드를 따라 하기 좋습니다.
  - 유튜브: https://www.youtube.com/channel/UCt2wAAXgm87ACiQnDHQEW6Q
  - 실습 코드 저장소: https://github.com/teddylee777/machine-learning
- 생활코딩 (opentutorials.org)
  파이썬을 포함한 프로그래밍 기초를 아주 쉽게 설명하는 무료 강의 사이트입니다. 깃허브·git
  사용법을 배우고 싶다면 이곳의 "지옥에서 온 git"도 추천합니다.
  https://opentutorials.org


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


## 책으로 공부하고 싶다면 (한)

영상보다 책이 편하면 아래를 추천합니다. 서점이나 도서관에서 제목으로 찾을 수 있습니다.

- 혼자 공부하는 머신러닝+딥러닝 (박해선, 한빛미디어)
  입문자에게 가장 무난한 한국어 교재입니다. 저자가 무료 동영상 강의도 제공합니다
  (한빛미디어 유튜브에서 책 제목으로 검색).
- 파이썬 라이브러리를 활용한 머신러닝 (안드레아스 뮐러, 한빛미디어)
  우리가 쓰는 scikit-learn을 중심으로 한 실전 입문서입니다.
- 핸즈온 머신러닝 (오렐리앙 제롱, 한빛미디어)
  실무에서 표준으로 꼽히는 책입니다. 두껍지만 예제가 훌륭합니다. 조금 익숙해진 뒤 보세요.
- 파이썬으로 배우는 알고리즘 트레이딩 (조대표)
  위 "알고리즘 트레이딩·백테스트" 항목 참고. 전문이 무료로 공개되어 있습니다.


## 용어와 자료 연결

README의 "용어 정리"에서 특정 개념이 어렵게 느껴지면, 아래 자료로 바로 찾아가세요.

- 정확도 / 정밀도 / 재현율 / F1: StatQuest "The Confusion Matrix", 김성범 [핵심 머신러닝]
- 혼동행렬: StatQuest "The Confusion Matrix"
- ROC-AUC: StatQuest "ROC and AUC"
- 랜덤포레스트: StatQuest "Random Forests", 김성범 [핵심 머신러닝]
- XGBoost(부스팅): StatQuest "Gradient Boost / XGBoost", 김성범 [핵심 머신러닝]
- 신경망 / LSTM: 3Blue1Brown 신경망, 모두를 위한 딥러닝, 혁펜하임
- p값 / 가설검정: Khan Academy 통계, 데이터 사이언스 스쿨
- ARIMA / 시계열 / 정상성: Forecasting: Principles and Practice, 데이터 사이언스 스쿨
- GARCH / 변동성: arch 문서, 검색어 "변동성 군집"
- 금리 / 연준 / 매파·비둘기: 한국은행 경제교육, Bernanke & Kuttner 논문
- 샤프지수 / 최대낙폭 / 백테스트: 파이썬으로 배우는 알고리즘 트레이딩, Investopedia


## StatQuest에서 꼭 볼 영상 (영)

전체 목록(https://statquest.org/video-index/)에서 아래 제목을 찾아 보세요. 한 편에 10분 안팎이고,
우리 프로젝트에 바로 쓰이는 내용입니다.

- Machine Learning Fundamentals: The Confusion Matrix
- ROC and AUC, Clearly Explained!
- Decision Trees
- Random Forests Part 1: Building, Using and Evaluating
- Gradient Boost 시리즈, XGBoost 시리즈
- Cross Validation
- The Central Limit Theorem, p-values (통계 기초)


## 3Blue1Brown 신경망 시리즈 순서 (영)

재생목록(https://www.youtube.com/playlist?list=PLZZWrBYkx7Otcjr3eCLZDCgfpqnxMY29s)을 순서대로 보면 됩니다.

- 1편: 신경망이란 무엇인가 (https://www.youtube.com/watch?v=aircAruvnKk)
- 2편: 경사하강법, 신경망은 어떻게 배우는가 (https://www.youtube.com/watch?v=IHZwWFHWa-w)
- 3편 이후: 역전파(backpropagation)의 원리
그림으로 이해하는 것이 목적이므로, 수식이 나와도 흐름만 따라가면 충분합니다.


## 발표·보고서를 쓸 때

- 논문을 인용할 때는 저자와 연도를 함께 적습니다. 예: Bernanke & Kuttner(2005).
- 이 프로젝트에서 외부 수치로 인용할 수 있는 것은 "예상치 못한 25bp 인하 → 주가지수 약 1% 상승"
  (Bernanke & Kuttner)뿐입니다. 나머지 수치는 우리가 직접 코드를 돌려 얻은 결과만 씁니다.
- 그래프는 코드가 그려주는 것을 그대로 캡처해 쓰면 됩니다. 축 제목·범례가 한글로 나오도록
  koreanize-matplotlib를 설치하세요.
- 결과가 기대와 다르게 나와도 그대로 보고합니다. "예측이 어렵다"는 결론도 훌륭한 발견입니다.
- 표를 캡처할 때는 코드가 출력한 정렬된 표를 그대로 쓰면 보기 좋습니다.


## 공부하다 막힐 때

- 모르는 용어가 나오면 먼저 README의 "용어 정리"를 보세요.
- 그래도 막히면 검색어로 짧은 한국어 영상을 먼저 보고, 개념을 잡은 뒤 코드로 돌아오세요.
- 코드가 에러를 내면 에러 메시지의 마지막 줄을 그대로 검색해 보는 것도 좋은 방법입니다.
- 무엇이든 모르는 것은 당연합니다. 멘토에게 편하게 물어보세요.
