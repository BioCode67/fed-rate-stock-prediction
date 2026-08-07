/* ============================================================================
 *  learn.js — 배우기
 *
 *  대회에 나가려면 도구를 다루는 것만으로 부족합니다. 심사위원이 보는 것은
 *  "얼마나 벌었나"가 아니라 "그 숫자를 믿을 수 있는가"입니다.
 *  이 화면은 그 판단 기준을 배우는 곳입니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  const S = { tab: 'flow', query: '' };

  /* ------------------------------------------------------------------------
   *  1) 퀀트 투자의 흐름
   * ----------------------------------------------------------------------*/
  const FLOW = [
    {
      step: '1', title: '가설을 세운다',
      body: '"많이 오른 종목이 더 오를 것이다(모멘텀)" 처럼 <b>말로 설명되는 이유</b>가 먼저입니다. ' +
        '데이터를 뒤져서 잘 맞는 규칙을 찾는 순서로 하면, 우연히 맞은 규칙을 붙잡게 됩니다. ' +
        '이것이 실무와 학생 프로젝트를 가르는 첫 번째 갈림길입니다.',
      here: '전략 실험실의 각 전략 설명이 그 가설입니다.'
    },
    {
      step: '2', title: '팩터로 만든다',
      body: '가설을 숫자로 바꿉니다. "많이 올랐다" → "최근 12개월 수익률에서 최근 1개월을 뺀 값". ' +
        '그리고 날짜마다 종목들 사이의 <b>순위</b>로 바꿉니다(횡단면 정규화). ' +
        '그래야 시장이 폭락한 날에도 값의 크기가 변하지 않아 안정적으로 비교됩니다.',
      here: '팩터 분석 탭에서 팩터 9개를 확인할 수 있습니다.'
    },
    {
      step: '3', title: '팩터가 통하는지 검증한다',
      body: 'IC(팩터 순위와 미래 수익 순위의 상관)를 봅니다. 0.02~0.05면 실무에서 쓸 만합니다. ' +
        '여기서 걸러내지 않고 바로 전략을 만들면, 통하지도 않는 신호로 백테스트만 예쁘게 만들게 됩니다.',
      here: '팩터 분석 탭 → 팩터 성적표의 IC·t값·분위 수익.'
    },
    {
      step: '4', title: '전략으로 조립한다',
      body: '점수 상위 N종목을 사고, 정해진 주기마다 갈아탑니다. ' +
        '상관이 낮은 팩터끼리 묶으면(멀티팩터) 한 팩터가 안 통하는 시기를 다른 팩터가 메웁니다.',
      here: '전략 실험실 → 전략을 여러 개 골라 같은 조건에서 비교.'
    },
    {
      step: '5', title: '비용을 물린다',
      body: '백테스트에서 살아남은 전략의 절반은 거래비용에서 죽습니다. ' +
        '회전율(한 번에 포트폴리오의 몇 %를 갈아엎는가)이 높을수록 취약합니다. ' +
        '<b>손익분기 비용</b>을 반드시 확인하세요.',
      here: '전략 실험실 → 거래비용 민감도 표.'
    },
    {
      step: '6', title: '처음 보는 구간에서 확인한다',
      body: '개발에 쓰지 않은 구간(홀드아웃)에서 같은 전략을 돌립니다. ' +
        '여기서 성적이 절반으로 떨어지면 과적합입니다. <b>대회 순위는 이 구간에서 결정됩니다.</b>',
      here: '전략 실험실 → 제출 버튼을 누르면 채점 구간에서 자동 재실행.'
    },
    {
      step: '7', title: '실제로 굴려 본다',
      body: '전략이 시키는 대로 매매하며 버틸 수 있는지 봅니다. ' +
        '1년 내내 마이너스인 구간을 실제로 견디는 것은 백테스트와 전혀 다른 일입니다.',
      here: '모의투자 탭에서 실제 나스닥 데이터로 하루씩 진행.'
    }
  ];

  /* ------------------------------------------------------------------------
   *  2) 흔한 함정 — 실무에서 실제로 겪는 것들
   * ----------------------------------------------------------------------*/
  const TRAPS = [
    {
      name: '미래 정보 사용 (Look-ahead bias)',
      what: '오늘 예측하는 데 오늘 종가 이후의 정보를 쓰는 것. 백테스트 성적이 비현실적으로 좋아집니다.',
      how: '이 사이트는 리밸런싱 날 종가까지의 정보로만 점수를 매기고, 수익은 <b>다음 날부터</b> 반영합니다.',
      sign: '정확도 70%, IC 0.3 같은 값이 나오면 거의 확실히 이것입니다.'
    },
    {
      name: '생존 편향 (Survivorship bias)',
      what: '지금 살아남은 종목만으로 과거를 검증하는 것. 망한 회사가 빠져 있어 성적이 부풀려집니다.',
      how: '이 사이트의 나스닥100은 <b>현재 구성 종목</b>입니다. 즉 생존 편향이 있습니다. 숨기지 않고 화면에 표시합니다.',
      sign: '"과거 20년 연 20%" 같은 백테스트는 대부분 여기에 걸려 있습니다.'
    },
    {
      name: '과적합 (Overfitting)',
      what: '과거 데이터에만 잘 맞는 규칙을 만드는 것. 파라미터를 많이 만질수록 심해집니다.',
      how: '개발 구간과 채점 구간을 나누고, 제출 후에만 채점 구간을 엽니다.',
      sign: '개발 구간 연 30%, 채점 구간 연 3%처럼 격차가 크면 과적합입니다.'
    },
    {
      name: '다중검정 (Multiple testing)',
      what: '설정을 20번 바꿔 돌리면 그중 하나는 우연히 "5% 유의"로 나옵니다. 그걸 발견이라 부르면 안 됩니다.',
      how: '이 사이트는 백테스트 실행 횟수를 세어 8번을 넘으면 경고합니다.',
      sign: '"여러 조합을 시도해 최고를 골랐다"는 말 자체가 신호입니다. 시도 횟수를 반드시 보고하세요.'
    },
    {
      name: '거래비용 무시',
      what: '수수료·세금·슬리피지를 빼지 않은 수익률. 회전율이 높은 전략은 여기서 전멸합니다.',
      how: '갈아탈 때 바뀐 비중만큼 비용을 뗍니다. 비용 민감도와 손익분기 비용을 함께 보여 줍니다.',
      sign: '비용 0%에서만 좋은 전략은 실전에서 쓸 수 없습니다.'
    },
    {
      name: '벤치마크 없는 자랑',
      what: '"연 20% 벌었다"는 말은 같은 기간 지수가 25% 올랐으면 실패입니다.',
      how: '모든 성과를 QQQ 매수후보유·동일가중과 나란히 놓습니다.',
      sign: '벤치마크를 밝히지 않은 성과는 평가할 수 없습니다.'
    },
    {
      name: '수익률만 보기',
      what: '수익률 1위 전략이 최대낙폭 -60%라면 실제로는 못 버팁니다.',
      how: '샤프지수·MDD·회전율·t값을 함께 표시합니다.',
      sign: '"무엇으로 줄 세울지"를 실험 전에 정해 두어야 결과에 끌려다니지 않습니다.'
    },
    {
      name: '표본이 짧다',
      what: '6개월 성적은 대부분 운입니다. 시장 국면 하나만 겪은 것이기 때문입니다.',
      how: '순위표는 최소 60거래일을 요구하고, 전략은 여러 해에 걸쳐 검증합니다.',
      sign: '상승장만 포함된 구간에서는 아무 전략이나 좋아 보입니다.'
    },
    {
      name: '데이터 스누핑 (남의 결과 베끼기)',
      what: '이미 알려진 팩터를 그대로 쓰면, 그 팩터는 이미 시장에 반영돼 있을 수 있습니다.',
      how: '모멘텀·저변동성 같은 고전 팩터가 최근 구간에서 잘 안 통하는 것을 직접 확인해 보세요.',
      sign: '논문에서 통한 기간과 지금이 다르면 결과도 다릅니다.'
    },
    {
      name: '체리피킹 (좋은 기간만 보여 주기)',
      what: '전체는 마이너스인데 잘 나온 구간만 잘라 보여 주는 것.',
      how: '롤링 12개월 수익률로 <b>언제 무너졌는지</b>까지 함께 보여 줍니다.',
      sign: '발표에서 시작·종료 날짜를 바꿔가며 설명한다면 의심하세요.'
    }
  ];

  /* ------------------------------------------------------------------------
   *  3) 실습 과제 — 순서대로 해 보면 대회 준비가 됩니다
   * ----------------------------------------------------------------------*/
  const TASKS = [
    { id: 't1', title: '시장을 훑어본다',
      body: '마켓 탭에서 1년 수익률로 정렬해 보세요. 나스닥100 안에서도 종목별 차이가 얼마나 큰지 확인합니다. ' +
        '이 차이를 맞히는 것이 우리가 할 일입니다.' },
    { id: 't2', title: '팩터가 통하는지 확인한다',
      body: '팩터 분석 탭에서 예측 시계를 5일 / 1개월 / 3개월로 바꿔가며 실행해 보세요. ' +
        '같은 팩터라도 시계에 따라 IC가 달라집니다. |t| > 2 를 넘는 팩터가 몇 개인지 세어 보세요.' },
    { id: 't3', title: '겹치지 않는 팩터를 찾는다',
      body: '팩터 상관관계 표에서 상관 0.3 미만인 짝을 찾아보세요. 그 둘을 조합하면 분산 효과가 있습니다. ' +
        '반대로 0.7이 넘는 짝은 사실상 같은 팩터입니다.' },
    { id: 't3b', title: '내 알파를 쓴다',
      body: '알파 만들기 탭에서 <b>가설을 말로 먼저 정하고</b>(예: "오르되 덜 흔들린 종목이 낫다") ' +
        '계수를 넣어 평가해 보세요. t값이 2를 넘었더라도 <b>기존 팩터와의 상관</b>을 반드시 확인하세요. ' +
        '0.9가 넘으면 이름만 새로울 뿐 그 팩터를 다시 쓴 것입니다.' },
    { id: 't4', title: '전략을 비교한다',
      body: '전략 실험실에서 고전 팩터 3개와 AI 3개를 동시에 돌려 보세요. ' +
        '수익률 1위와 샤프 1위가 같은지 확인하고, 다르면 왜 다른지 설명해 보세요.' },
    { id: 't5', title: '비용으로 무너뜨려 본다',
      body: '편도 비용을 0.05% → 0.3%로 올려 다시 돌려 보세요. 어떤 전략이 먼저 죽는지, ' +
        '그 전략의 회전율은 얼마였는지 연결해 보세요.' },
    { id: 't6', title: '과적합을 눈으로 확인한다',
      body: '개발 구간에서 가장 좋았던 전략을 제출해 채점 구간 성적을 확인하세요. ' +
        '개발 구간과 채점 구간의 차이가 곧 과적합의 크기입니다.' },
    { id: 't7', title: '직접 굴려 본다',
      body: '모의투자 탭에서 3년 전으로 돌아가 60거래일 이상 진행해 보세요. ' +
        '전략대로 하는 것과 눈으로 보고 판단하는 것이 얼마나 다른지 느낄 수 있습니다.' },
    { id: 't8', title: '기록을 남긴다',
      body: '순위표에 제출하세요. 성과만이 아니라 설정과 고른 종목이 함께 저장됩니다. ' +
        '대회 지원서나 포트폴리오에 "재현 가능한 결과"로 쓸 수 있습니다.' },
    { id: 't9', title: '내가 몇 번 시도했는지 센다',
      body: '연구 노트 탭에서 <b>시도할수록 최고 기록은 올라간다</b> 차트를 확인하고, ' +
        '연구 노트를 <b>.md로 내려받아</b> 발표 자료에 붙이세요. ' +
        '"저는 이 설정을 N번 바꿔 봤고, 그중 가장 좋았던 것이 채점 구간에서 이만큼 재현됐습니다" — ' +
        '대회와 면접에서 가장 신뢰를 얻는 문장입니다.' }
  ];

  /* ------------------------------------------------------------------------
   *  4) 용어집
   * ----------------------------------------------------------------------*/
  const GLOSSARY = [
    ['IC (Information Coefficient)', '예측 순위와 실제 수익률 순위의 상관계수. 퀀트에서 신호의 질을 재는 표준 지표. 0.02~0.05면 실무에서 쓸 만하고, 0.3 이상은 누수 의심.'],
    ['ICIR', 'IC 평균 ÷ IC 표준편차. 신호가 꾸준한지를 봅니다. 평균이 높아도 들쭉날쭉하면 운용하기 어렵습니다.'],
    ['알파 (Alpha)', '시장 수익을 넘어서는 초과수익. 또는 그것을 만들어내는 신호 자체. WorldQuant IQC에서 참가자가 만드는 것이 바로 이 알파입니다. 이 사이트의 알파 만들기 탭에서 직접 써 볼 수 있습니다.'],
    ['베타 (Beta)', '시장이 1% 움직일 때 이 종목이 몇 % 움직이는가. 베타만 높이면 상승장에서는 좋아 보이지만 실력이 아닙니다.'],
    ['샤프지수 (Sharpe Ratio)', '수익 ÷ 변동성. 위험 한 단위당 얼마를 벌었는지. 1을 넘으면 우수, 0.5 안팎이 흔합니다.'],
    ['소르티노 (Sortino)', '샤프와 비슷하지만 하락할 때의 변동성만 셉니다. 오르는 쪽 변동은 문제가 아니라는 관점.'],
    ['최대낙폭 (MDD)', '고점 대비 가장 크게 떨어진 폭. -50%면 원금을 회복하려면 +100%가 필요합니다.'],
    ['회전율 (Turnover)', '한 번 리밸런싱할 때 포트폴리오의 몇 %를 바꾸는가. 100%면 전부 갈아엎는다는 뜻. 비용에 직결됩니다.'],
    ['횡단면 (Cross-section)', '같은 날짜에 여러 종목을 비교하는 것. 시계열(한 종목의 시간 흐름)과 대비되는 개념. 퀀트 주식 운용의 기본 틀입니다.'],
    ['워크포워드 (Walk-forward)', '과거로 학습 → 그 다음 구간 예측 → 구간을 넘겨 다시 학습. 실제 운용과 같은 순서로 검증하는 방법.'],
    ['purge / embargo', '학습 구간과 검증 구간 사이를 잘라내는 것. 정답이 N일 뒤를 보므로 겹치는 부분(purge)과 여유분(embargo)을 비웁니다.'],
    ['홀드아웃 (Hold-out)', '개발에 쓰지 않고 남겨 둔 구간. 대회의 채점 구간이 이것입니다.'],
    ['과적합 (Overfitting)', '과거에만 잘 맞는 규칙을 만드는 것. 파라미터를 만질수록, 시도를 반복할수록 심해집니다.'],
    ['다중검정 (Multiple testing)', '여러 번 시도하면 그중 하나는 우연히 좋아 보이는 문제. 시도 횟수를 반드시 함께 보고해야 합니다.'],
    ['생존 편향 (Survivorship bias)', '살아남은 것만 보고 판단하는 착각. 상장폐지된 종목이 빠지면 성과가 부풀려집니다.'],
    ['룩어헤드 (Look-ahead bias)', '그 시점에 알 수 없었던 정보를 쓰는 것. 백테스트 성적이 비현실적으로 좋아집니다.'],
    ['슬리피지 (Slippage)', '주문한 가격과 실제 체결 가격의 차이. 거래량이 적은 종목일수록 큽니다.'],
    ['벤치마크 (Benchmark)', '비교 기준. 나스닥 종목을 다룬다면 QQQ가 자연스러운 기준입니다.'],
    ['정보비율 (IR)', '초과수익 ÷ 초과수익의 변동성. 벤치마크 대비 실력을 보는 샤프지수.'],
    ['분위 분석 (Quantile)', '팩터로 종목을 5등분해 각 그룹의 수익을 비교. 계단처럼 단조롭게 증가하면 좋은 팩터입니다.'],
    ['리밸런싱 (Rebalancing)', '정해진 주기마다 포트폴리오를 다시 짜는 것. 잦을수록 신호를 빨리 반영하지만 비용이 늘어납니다.'],
    ['t값 (t-statistic)', '결과가 우연일 가능성을 보는 통계량. |t| > 2 면 우연으로 보기 어렵습니다. 단, 여러 번 시도했다면 이 기준도 느슨해집니다.'],
    ['롱숏 (Long-Short)', '오를 종목은 사고 내릴 종목은 공매도하는 방식. 시장 방향과 무관한 수익을 노립니다.'],
    ['팩터 노출 (Factor exposure)', '내 포트폴리오가 어떤 팩터에 얼마나 기울어 있는가. 의도하지 않은 쏠림을 발견하는 데 씁니다.']
  ];

  /* ------------------------------------------------------------------------
   *  5) 대회 준비
   * ----------------------------------------------------------------------*/
  const COMPETITIONS = [
    { name: 'WorldQuant IQC', when: '매년 3월 접수 / 3~9월 진행', who: '대학(원)생·졸업생 1~4인 팀',
      what: 'BRAIN 플랫폼에서 알파(팩터)를 만들고 백테스트합니다. 이 사이트의 팩터 분석과 알파 만들기가 그대로 연습이 됩니다.',
      prize: '총상금 US$100,000 · 싱가포르 결승 · 채용 우대',
      tip: 'BRAIN은 상시 가입·연습이 가능합니다. 지금부터 알파를 쌓아 두면 접수 시점에 유리합니다.' },
    { name: 'IMC Prosperity', when: '매년 봄', who: 'STEM 전공 학생, 최대 5인',
      what: '파이썬 알고리즘으로 여러 자산을 거래합니다. 호가·체결 시뮬레이션이라 시장미시구조 감각이 필요합니다.',
      prize: '총상금 US$50,000',
      tip: '거래비용·슬리피지를 다뤄 본 경험이 직접 도움이 됩니다.' },
    { name: 'Citadel Datathon', when: '지역별 수시', who: '학부 재학생(졸업예정일 조건)',
      what: '팀으로 큰 금융 데이터셋에서 문제를 풀고 리포트를 냅니다.',
      prize: '채용 패스트트랙',
      tip: '모델 성능보다 분석의 논리와 발표가 중요합니다. "이 결과를 왜 믿는가"를 설명하는 훈련이 핵심입니다.' },
    { name: 'Kaggle 금융 대회', when: '비정기', who: '누구나',
      what: 'Jane Street(거래 판단), Optiver(변동성 예측) 등. 잡음 속에서 과적합을 피하는 능력이 곧 순위입니다.',
      prize: '대회당 $100K 규모',
      tip: 'Public/Private 리더보드 구조가 이 사이트의 개발/채점 구간과 같습니다.' },
    { name: 'DB GAPS 투자대회', when: '매년 4~5월 접수', who: '대학(원)생 3인 팀',
      what: '국내 자산으로 3개월 모의투자.',
      prize: '1등 500만원 · 입사 우대 · 장학금',
      tip: '알고리즘이 아니라 직접 운용입니다. 여기서 전략을 검증한 뒤 근거를 갖고 들어가면 강합니다.' },
    { name: '증권사 대학생 모의투자대회', when: '방학마다', who: '대학생',
      what: '국내·해외주식 사이버머니 거래.',
      prize: '장학금·인턴 기회',
      tip: '가장 문턱이 낮습니다. 수상 이력을 먼저 만들기 좋습니다.' }
  ];

  /* ------------------------------------------------------------------------
   *  화면
   * ----------------------------------------------------------------------*/
  function tabs(host) {
    const p = App.panel('배우기 <span class="accent">LEARN</span>',
      { sub: '대회 심사위원이 보는 것은 "얼마나 벌었나"가 아니라 "그 숫자를 믿을 수 있는가"입니다' });
    const seg = U.el('div', 'seg');
    [['flow', '퀀트의 흐름'], ['traps', '흔한 함정'], ['tasks', '실습 과제'],
     ['iqc', 'IQC 로드맵'], ['comp', '대회 준비'], ['gloss', '용어집']].forEach(function (o) {
      const b = U.el('button', S.tab === o[0] ? 'on' : '', o[1]);
      b.addEventListener('click', function () { S.tab = o[0]; draw(host); });
      seg.appendChild(b);
    });
    p.body.appendChild(seg);
    return p;
  }

  function flowPanel() {
    const p = App.panel('퀀트 투자는 이 순서로 합니다');
    FLOW.forEach(function (f) {
      const box = U.el('div');
      box.style.cssText = 'display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)';
      const num = U.el('div', 'mono');
      num.style.cssText = 'flex:0 0 28px;height:28px;border:1px solid var(--amber);color:var(--amber);' +
        'display:grid;place-items:center;font-size:13px';
      num.textContent = f.step;
      const txt = U.el('div');
      txt.innerHTML = '<div style="font-weight:650;margin-bottom:3px">' + U.escape(f.title) + '</div>' +
        '<div class="small">' + f.body + '</div>' +
        '<div class="tiny" style="margin-top:4px;color:var(--amber)">→ ' + U.escape(f.here) + '</div>';
      box.appendChild(num); box.appendChild(txt);
      p.body.appendChild(box);
    });
    return p;
  }

  function trapsPanel() {
    const p = App.panel('흔한 함정 ' + TRAPS.length + '가지',
      { sub: '백테스트가 좋게 나왔다면 먼저 이 목록을 확인하세요' });
    TRAPS.forEach(function (t, i) {
      const box = U.el('div');
      box.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--line)';
      box.innerHTML =
        '<div style="font-weight:650"><span class="mono tiny" style="color:var(--ink-3)">' +
        String(i + 1).padStart(2, '0') + '</span> ' + U.escape(t.name) + '</div>' +
        '<div class="small" style="margin-top:3px">' + t.what + '</div>' +
        '<div class="tiny" style="margin-top:4px">이 사이트의 대응: ' + t.how + '</div>' +
        '<div class="tiny" style="margin-top:2px;color:var(--warn)">신호: ' + U.escape(t.sign) + '</div>';
      p.body.appendChild(box);
    });
    return p;
  }

  function tasksPanel(host) {
    const p = App.panel('실습 과제', { sub: '순서대로 해 보면 대회 준비가 됩니다' });
    let doneMap = {};
    try { doneMap = JSON.parse(localStorage.getItem('quantlab.tasks') || '{}'); } catch (e) {}

    const bar = U.el('div', 'bar');
    bar.style.marginBottom = '10px';
    const fill = U.el('i');
    bar.appendChild(fill);
    const counter = U.el('div', 'tiny');
    p.body.appendChild(counter);
    p.body.appendChild(bar);

    // 체크할 때마다 화면 전체를 다시 그리면 스크롤이 튀므로, 진행률만 갱신합니다.
    function refreshProgress() {
      const done = TASKS.filter(function (t) { return doneMap[t.id]; }).length;
      counter.textContent = done + ' / ' + TASKS.length + ' 완료';
      fill.style.width = Math.round(done / TASKS.length * 100) + '%';
    }

    TASKS.forEach(function (t, i) {
      const box = U.el('label');
      box.style.cssText = 'display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer';
      const cb = U.el('input');
      cb.type = 'checkbox'; cb.checked = !!doneMap[t.id];
      cb.style.marginTop = '3px';
      const txt = U.el('div');
      const title = U.el('div');
      title.style.fontWeight = '650';
      title.textContent = (i + 1) + '. ' + t.title;
      const applyStyle = function () {
        title.style.color = cb.checked ? 'var(--ink-3)' : '';
        title.style.textDecoration = cb.checked ? 'line-through' : '';
      };
      applyStyle();
      cb.addEventListener('change', function () {
        doneMap[t.id] = cb.checked;
        try { localStorage.setItem('quantlab.tasks', JSON.stringify(doneMap)); } catch (e) {}
        applyStyle();
        refreshProgress();
      });
      txt.appendChild(title);
      txt.appendChild(U.el('div', 'small', t.body));
      box.appendChild(cb); box.appendChild(txt);
      p.body.appendChild(box);
    });
    refreshProgress();
    return p;
  }

  /* ------------------------------------------------------------------------
   *  IQC 로드맵 — 이 사이트에서 대회까지 어떻게 이어지는가
   * ----------------------------------------------------------------------*/
  const IQC_STAGES = [
    { n: 1, title: 'BRAIN 계정 만들기', when: '지금 당장',
      body: 'platform.worldquantbrain.com 에서 무료로 가입합니다. 대회 기간이 아니어도 ' +
        '상시 연습이 가능하고, 여기서 쌓은 알파가 그대로 대회 실적이 됩니다. ' +
        '가입에 학교 이메일이면 충분합니다.',
      here: '이 사이트의 <b>알파 만들기</b>가 BRAIN 시뮬레이터와 같은 구조입니다. ' +
        '식 문법도 일부러 같은 이름을 썼습니다(rank, ts_delta, group_neutralize…).' },
    { n: 2, title: '연산자에 익숙해지기', when: '1~2주',
      body: '처음에는 rank()와 ts_ 계열 몇 개만 써도 충분합니다. ' +
        '중요한 것은 연산자를 많이 아는 게 아니라, <b>하나를 바꿨을 때 점수가 어떻게 움직이는지</b>를 ' +
        '몸으로 아는 것입니다.',
      here: '<b>예제에서 출발하기</b>의 여덟 개를 그대로 돌려 보고, 숫자를 한 군데씩만 바꿔 보세요. ' +
        'decay를 4 → 20으로 올리면 회전율과 Fitness가 어떻게 움직이는지 꼭 확인하세요.' },
    { n: 3, title: '통과 기준 감 잡기', when: '2~4주',
      body: 'Sharpe 1.25 / Fitness 1.0 / 회전율 1~70%. 처음에는 대부분 못 넘깁니다. ' +
        '정상입니다. 못 넘기는 알파를 많이 만들어 보는 것이 유일한 길입니다.',
      here: '채점표의 눈금이 BRAIN의 합격선과 같은 값입니다. ' +
        '회전율이 걸리면 decay_linear·ts_mean으로 신호를 부드럽게 만드세요. ' +
        'Fitness는 성과를 올리는 것보다 회전율을 낮추는 편이 빠를 때가 많습니다.' },
    { n: 4, title: '서로 다른 알파를 여러 개', when: '1~3개월',
      body: 'IQC는 알파 하나로 겨루지 않습니다. 여러 개를 내되 <b>서로 닮으면 안 됩니다</b>. ' +
        '자기상관 0.7을 넘으면 같은 알파를 두 번 낸 것으로 봅니다.',
      here: '알파를 저장하면 일별 손익도 함께 남습니다. 다음 알파를 시뮬레이션할 때 ' +
        '<b>자기상관</b>이 자동으로 계산돼 나옵니다. 0.7 미만인 알파를 5개 모으는 것을 목표로 하세요.' },
    { n: 5, title: '팀 만들기', when: '접수 1개월 전',
      body: '1~4인 팀입니다. 혼자보다 팀이 유리합니다. 서로 다른 아이디어를 내야 ' +
        '자기상관이 낮은 알파 묶음이 나오기 때문입니다.',
      here: '반 내부 대회 순위표에서 격차가 작은 사람을 찾으세요. ' +
        '개발 구간에서 1등인 사람보다, <b>개발과 채점 성적이 비슷한</b> 사람이 좋은 팀원입니다.' },
    { n: 6, title: '지원서 쓰기', when: '3월경 접수',
      body: '"무엇을 시도했고, 무엇이 안 됐고, 왜 그렇게 판단했는가"를 씁니다. ' +
        '성과만 나열한 지원서는 약합니다.',
      here: '<b>연구 노트</b>를 .md로 내려받아 그대로 붙이세요. 시도 횟수와 실패한 시도까지 ' +
        '들어 있는 기록이 가장 강한 근거입니다.' }
  ];

  function iqcPanel(host) {
    const p = App.panel('IQC 로드맵 <span class="accent">WORLDQUANT</span>',
      { sub: '이 사이트에서 실제 대회까지 어떻게 이어지는가' });

    const intro = U.el('div', 'note');
    intro.innerHTML = '<b>International Quant Championship</b>은 WorldQuant가 매년 여는 대학생 퀀트 대회입니다. ' +
      '총상금 US$100,000, 싱가포르 결승, 채용 우대. 참가자는 BRAIN 플랫폼에서 <b>알파(식 한 줄)</b>를 만들어 냅니다. ' +
      '이 사이트의 알파 만들기 화면은 그 과정을 축소해 옮긴 것입니다.';
    p.body.appendChild(intro);

    IQC_STAGES.forEach(function (st) {
      const box = U.el('div');
      box.style.cssText = 'display:grid;grid-template-columns:34px 1fr;gap:12px;padding:12px 0;' +
        'border-bottom:1px solid var(--line)';
      const num = U.el('div', 'mono');
      num.style.cssText = 'width:30px;height:30px;display:grid;place-items:center;font-size:13px;' +
        'border:1px solid var(--amber);color:var(--amber)';
      num.textContent = String(st.n);
      const txt = U.el('div');
      txt.innerHTML = '<div style="font-weight:650">' + U.escape(st.title) +
        ' <span class="tiny" style="font-weight:400">· ' + U.escape(st.when) + '</span></div>' +
        '<div class="small" style="margin-top:4px">' + st.body + '</div>' +
        '<div class="tiny" style="margin-top:6px;padding-left:9px;border-left:2px solid var(--amber-dim)">' +
        '여기서 연습: ' + st.here + '</div>';
      box.appendChild(num); box.appendChild(txt);
      p.body.appendChild(box);
    });

    const go = U.el('button', 'btn primary mt', '알파 만들기 열기 →');
    go.addEventListener('click', function () { App.go('alpha'); });
    p.body.appendChild(go);

    const caveat = U.el('div', 'note warn');
    caveat.innerHTML = '<b>다른 점도 알아 두세요.</b> BRAIN은 전 세계 수천 종목(TOP3000 등)과 ' +
      '재무·뉴스·애널리스트 데이터를 씁니다. 여기는 나스닥100 약 100종목과 가격·거래량뿐입니다. ' +
      '연산자와 채점 방식은 같지만 <b>데이터의 폭이 다릅니다.</b> ' +
      '여기서 통한 알파가 거기서도 통한다는 보장은 없습니다. 반대로 여기서 못 넘긴 기준을 ' +
      '거기서는 넘길 수도 있습니다. 이 화면은 <b>감을 잡는 곳</b>이지 대체품이 아닙니다.';
    p.body.appendChild(caveat);
    return p;
  }

  function compPanel() {
    const p = App.panel('나가 볼 만한 대회', { sub: '일정은 해마다 바뀌므로 공식 페이지에서 다시 확인하세요' });
    COMPETITIONS.forEach(function (c) {
      const box = U.el('div');
      box.style.cssText = 'padding:11px 0;border-bottom:1px solid var(--line)';
      box.innerHTML =
        '<div style="font-weight:650">' + U.escape(c.name) +
        ' <span class="tiny" style="font-weight:400">· ' + U.escape(c.when) + '</span></div>' +
        '<div class="small" style="margin-top:3px">' + U.escape(c.what) + '</div>' +
        '<div class="tiny" style="margin-top:4px">대상: ' + U.escape(c.who) + ' · 혜택: ' + U.escape(c.prize) + '</div>' +
        '<div class="tiny" style="margin-top:3px;color:var(--amber)">준비 팁: ' + U.escape(c.tip) + '</div>';
      p.body.appendChild(box);
    });
    p.body.appendChild(U.el('div', 'note',
      '큰 대회는 대부분 봄(3~5월)에 접수합니다. 가을에는 데이터 분석 계열 대회로 실적을 쌓고, ' +
      '겨울 방학에 증권사 모의투자로 감각을 익힌 뒤, 봄에 IQC·GAPS·Prosperity에 도전하는 순서가 현실적입니다.'));
    return p;
  }

  function glossPanel(host) {
    const p = App.panel('용어집', { sub: '모르는 말이 나오면 여기서 찾으세요' });
    const q = U.el('input');
    q.type = 'search'; q.placeholder = '검색 (예: 샤프, IC, 과적합)'; q.value = S.query;
    q.style.marginBottom = '10px';
    q.addEventListener('input', function () {
      S.query = q.value;
      list.innerHTML = '';
      render();
    });
    p.body.appendChild(q);
    const list = U.el('div');
    p.body.appendChild(list);

    function render() {
      const f = S.query.trim().toLowerCase();
      GLOSSARY.filter(function (g) {
        return !f || g[0].toLowerCase().indexOf(f) >= 0 || g[1].toLowerCase().indexOf(f) >= 0;
      }).forEach(function (g) {
        const box = U.el('div');
        box.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--line)';
        box.innerHTML = '<div style="font-weight:650">' + U.escape(g[0]) + '</div>' +
          '<div class="small">' + U.escape(g[1]) + '</div>';
        list.appendChild(box);
      });
      if (!list.children.length) list.appendChild(U.el('div', 'empty', '찾는 용어가 없습니다.'));
    }
    render();
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(tabs(host));
    if (S.tab === 'flow') host.appendChild(flowPanel());
    else if (S.tab === 'traps') host.appendChild(trapsPanel());
    else if (S.tab === 'tasks') host.appendChild(tasksPanel(host));
    else if (S.tab === 'iqc') host.appendChild(iqcPanel(host));
    else if (S.tab === 'comp') host.appendChild(compPanel());
    else host.appendChild(glossPanel(host));
  }

  App.register('learn', { render: draw });
})(window.QL = window.QL || {});
