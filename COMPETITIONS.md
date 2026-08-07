# 나가 볼 만한 퀀트·투자 경진대회 정리

조사 기준일: **2026년 8월 7일**. 일정은 해마다 바뀌므로 반드시 공식 페이지에서 다시 확인하세요.
아래 표의 "다음 기회"는 이 기준일에서 본 것입니다.

지금 시점에서 중요한 사실 하나: **큰 대회는 대부분 봄(3~5월)에 접수합니다.**
2026년 봄 대회(IQC, DB GAPS, IMC Prosperity)는 이미 접수가 끝났습니다.
그래서 전략은 이렇게 잡는 것이 좋습니다.

1. **지금~가을**: 이 프로젝트를 완성도 있게 다듬어 포트폴리오로 만들고, 가을 대회(데이터 분석 계열)에 참가
2. **겨울**: 증권사 모의투자 대회(방학마다 열림)로 실전 감각 + 수상 이력
3. **2027년 봄**: IQC·DB GAPS·IMC Prosperity 같은 본진 대회에 준비된 상태로 참가


## 한눈에 보기

| 대회 | 성격 | 대상 | 다음 기회(추정) | 규모 |
|---|---|---|---|---|
| WorldQuant IQC | 알파(팩터) 개발·백테스트 | 대학생/대학원생/졸업생 1~4인 | 2027년 3월 접수 | 총상금 US$100,000 |
| IMC Prosperity | 알고리즘 트레이딩 시뮬레이션 | STEM 전공 학생, 최대 5인 | 2027년 봄 | 총상금 US$50,000 |
| Citadel Datathon | 금융 데이터 분석 | 학부생(졸업예정일 조건) | 연중 지역별 수시 | 채용 연계 |
| Kaggle 금융 대회 | 시계열 예측 ML | 누구나 | 상시(대회별) | 대회당 $100K 규모 |
| DB GAPS 투자대회 | 자산배분 모의투자 3개월 | 대학(원)생 3인 팀 | 2027년 4월 접수 | 1등 500만원 |
| 키움 대학생 모의투자대회 | 국내·해외주식 모의투자 | 대학생·휴학생 | 방학마다(겨울) | 장학금·인턴 |
| DACON 금융 AI | 금융 데이터 ML 경진 | 누구나 | 수시 개최 | 수백만원대 |
| KRX 금융 빅데이터 | 아이디어·분석 | 개인/팀(최대 5인) | 공고 확인 | 상금·시상 |


## 1. WorldQuant IQC (국제 퀀트 모의투자 대회) — **우리 프로젝트와 가장 잘 맞습니다**

- **하는 일**: WorldQuant의 온라인 플랫폼 **BRAIN**에서 시장 데이터와 연산자를 조합해
  주식 포지션을 만드는 모델(**알파**)을 개발하고 백테스트합니다.
- **형식**: 3라운드, 같은 대학 소속 1~4인 팀. 상위 팀은 전국전(준결승) → 국가대표팀은 싱가포르 국제 결승전.
- **2026년 일정(참고)**: 등록 3/3~5/13, 예선 3/17~5/18, 국가대표전 5/26~7월 중순, 글로벌 결승 7/21~9월 중순
- **혜택**: 총상금 US$100,000, 싱가포르 결승 출전, WorldQuant 인턴·정규직 채용 우대
- **공식**: https://wqbrain.kr

> **지금 할 일**: 대회는 내년 봄이지만 **BRAIN 플랫폼은 상시 가입·연습이 가능합니다.**
> 우리가 만든 `quant/` 파이프라인의 팩터(모멘텀·변동성·금리민감도…)가 곧 IQC에서 말하는 알파입니다.
> 지금부터 BRAIN에서 알파를 쌓아 두면 내년 봄에 바로 강한 상태로 시작합니다.


## 2. IMC Prosperity (글로벌 트레이딩 챌린지)

- **하는 일**: 파이썬으로 알고리즘을 짜서 여러 자산을 거래하고 리스크를 관리합니다.
  알고리즘 라운드 + 손으로 푸는 퍼즐 라운드가 섞여 5라운드로 진행됩니다.
- **대상**: STEM 전공 학생, 팀당 최대 5인
- **규모**: 총상금 US$50,000
- **특징**: 실제 호가·체결을 시뮬레이션하므로 **시장미시구조**(슬리피지, 체결) 감각이 필요합니다.
  우리 백테스트에 이미 거래비용·슬리피지가 들어 있어 개념 연결이 쉽습니다.
- **공식**: https://prosperity.imc.com/


## 3. Citadel / Citadel Securities Datathon

- **하는 일**: 팀을 이뤄 큰 금융 데이터셋에서 정해진 문제를 풉니다. 며칠 안에 분석 → 리포트 제출.
- **대상**: 학부 재학생(만 18세 이상), 졸업 예정일 조건이 있습니다(예: 2026년 12월~2028년 6월).
- **혜택**: 수상자는 채용 절차 우대(패스트트랙)
- **특징**: 지역별로 여러 번 열리므로 **연중 기회가 있습니다.** 모델 성능보다 **분석의 논리와 발표**가 중요합니다.
  우리 README의 "결과 읽는 법", 누수 점검 습관이 그대로 강점이 됩니다.
- **공식**: https://www.citadelsecurities.com/careers/programs-and-events/datathons/


## 4. Kaggle 금융 시계열 대회

- **대표 사례**: Jane Street Market Prediction / Jane Street Real-Time Market Data Forecasting (총상금 $100K),
  Optiver Realized Volatility Prediction
- **특징**: 상시 열리지는 않지만 열릴 때 규모가 큽니다. **잡음이 큰 금융 데이터에서 과적합을 피하는 능력**이 곧 순위입니다.
- **우리 프로젝트와의 연결**: Optiver 대회는 **변동성 예측**입니다. 우리 `phase1c`/변동성 탭의 GARCH가 정확히 그 주제입니다.
  Jane Street 대회는 **거래 여부 판단**이라 우리 백테스트의 임계값(threshold) 개념과 같습니다.
- **공식**: https://www.kaggle.com/competitions


## 5. DB GAPS 투자대회 (국내)

- **하는 일**: 국내 주요 자산으로 포트폴리오를 구성해 **3개월간 모의투자**. 팀당 계좌 1개.
- **대상**: 대학(원)생 **3인 팀** (재학·휴학생, 대학원은 4학기까지)
- **2026년 일정(참고)**: 접수 4/13~5/8 12시, 사전설명회 5월 중순
- **혜택**: 1등 500만원, 상위 10팀 선정, DB증권 입사 시 서류 우대, 재단 장학금 지원 자격
- **공식**: https://dbgaps.dbsec.co.kr/


## 6. 증권사 대학생 모의투자대회 (겨울방학이 가장 가까운 기회)

- **키움증권 대학생 모의투자대회**: 방학마다(여름·겨울) 개최. 국내·해외주식 사이버머니 거래.
  리그 순위에 따라 장학금·인턴 기회·수료증.
- **한국투자증권 BanKIS 대학생 모의투자대회**: 모의투자 프로그램 운영.
- **특징**: 알고리즘이 아니라 **직접 매매**입니다. 다만 우리 사이트로 전략을 먼저 검증하고 들어가면
  "왜 이 종목을 샀는지"를 데이터로 설명할 수 있어 후기·인터뷰에서 강합니다.


## 7. 국내 데이터 분석 경진대회 (DACON·KRX 등)

- **DACON 금융 AI Challenge**: 금융 데이터로 모델 성능을 겨루는 대회. 2026년 대회는 7/13 마감(227팀, 상금 750만원)이었습니다.
  DACON은 수시로 새 대회를 엽니다 → https://dacon.io
- **KRX 금융 빅데이터 활용 아이디어 경진대회**: 금융 빅데이터로 서비스·아이디어를 제안하는 형식.
  개인(학생·직장인)·기업 모두 참가, 팀 최대 5인.
  **아이디어+구현물** 형식이라 우리가 만드는 웹사이트를 그대로 출품할 수 있는 유형입니다.


## 우리 프로젝트를 대회용으로 바꾸는 법

지금 저장소에 이미 있는 것과, 대회에서 요구하는 것을 맞춰 보면 이렇습니다.

| 대회에서 보는 것 | 우리가 이미 가진 것 | 더 필요한 것 |
|---|---|---|
| 알파(팩터) 설계 | 팩터 20여 개 + 횡단면 정규화 (`quant/features.py`) | 실제 나스닥 데이터로 검증 |
| 과적합을 피했는가 | purge·embargo 워크포워드, 순열검정 | 여러 기간·여러 시장 재현 |
| 비용 후에도 남는가 | 거래비용·슬리피지·회전율 반영 백테스트 | 실제 호가 스프레드 반영 |
| 설명 능력 | 한국어 해설·용어집·"결과 읽는 법" | 발표자료·데모 사이트 |
| 결과 재현성 | 시드 고정, config 저장 | 공개 배포 + 실행 안내 |

**가장 큰 강점이 될 부분**: 대부분의 참가자는 "정확도 높은 모델"을 보여 줍니다.
우리는 **"신호를 0으로 두면 IC가 0으로 나오는지 확인했다"**는 검증 과정을 보여 줄 수 있습니다.
심사위원이 가장 신뢰하는 것이 이 종류의 자기검증입니다. 실제로 이 검증이 우리 데이터 생성기의
결함을 잡아냈다는 사례까지 있으니, 그 이야기를 그대로 쓰면 됩니다.


## 출처

- [2026 월드퀀트 국제 퀀트 모의투자 대회(IQC) — 콘테스트코리아](https://www.contestkorea.com/sub/view.php?int_gbn=1&Txt_bcode=030310001&str_no=202603100088)
- [WorldQuant IQC 안내 — 고려대 국제처](https://korstudy.korea.ac.kr/bbs/cdc/522/267664/artclView.do)
- [IMC Prosperity 공식](https://prosperity.imc.com/)
- [IMC Prosperity — IMC Trading 소개](https://www.imc.com/us/articles/prosperity-4-imc-global-trading-challenge)
- [Citadel Securities Datathon](https://www.citadelsecurities.com/careers/programs-and-events/datathons/)
- [Citadel Datathon](https://www.citadel.com/careers/programs-and-events/datathons/)
- [Quantitative Finance Events in 2026 — OpenQuant](https://openquant.co/blog/quantitative-finance-events-2026)
- [Jane Street Real-Time Market Data Forecasting — Kaggle](https://www.kaggle.com/competitions/jane-street-real-time-market-data-forecasting)
- [Optiver Realized Volatility Prediction — Kaggle](https://www.kaggle.com/competitions/optiver-realized-volatility-prediction/discussion/264644)
- [2026 제12회 DB GAPS 투자대회 — 고려대 경력개발센터](https://career.korea.ac.kr/bbs/cdc/522/268677/artclView.do)
- [2026 DB GAPS 투자대회 공식](https://dbgaps.dbsec.co.kr/)
- [제36회 국내&해외주식 대학생 모의투자대회 — 콘테스트코리아](https://contestkorea.com/sub/view.php?Txt_gbn=1&Txt_bcode=031810001&str_no=202412310010)
- [BanKIS 대학생 모의투자대회 — 한국투자증권](https://m.koreainvestment.com/main/research/virtual/_static/TF07dq020000.jsp)
- [DACON 대회 목록](https://dacon.io/competitions)
- [제1회 KRX 금융 빅데이터 활용 아이디어 경진대회 — DACON](https://www.dacon.io/en/competitions/official/235914/overview/description)
