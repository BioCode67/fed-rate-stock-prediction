/* ============================================================================
 *  alpha.js (화면) — 알파 만들기 / IQC 시뮬레이터
 *
 *  이 화면은 WorldQuant BRAIN을 흉내 냅니다. IQC 참가자가 실제로 하는 일이
 *  여기 다 들어 있습니다.
 *
 *      식을 쓴다 → 시뮬레이션 설정을 고른다 → 롱숏 북으로 굴린다
 *                → Sharpe·Fitness·Turnover로 채점받는다
 *
 *  두 가지 모드를 둡니다.
 *    쉬운 모드  슬라이더로 팩터에 계수를 매깁니다. 처음 오는 학생용.
 *    식 모드    rank(), ts_delta(), group_neutralize() 같은 연산자로 씁니다.
 *              IQC에서 제출하는 것이 정확히 이 형태입니다.
 *
 *  설계에서 지킨 것
 *    1) 평가는 개발 구간에서만. 채점 구간(최근 12개월)은 여기서도 잠겨 있습니다.
 *    2) 합격선(1.25 / 1.0 / 1~70%)을 눈금으로 그어 "통과인가"를 바로 보이게.
 *    3) 자기상관을 봅니다. 이미 낸 알파와 닮았으면 새 알파가 아닙니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App,
        STRAT = root.STRAT, ALPHA = root.ALPHA, EXPR = root.EXPR, SIM = root.SIM;

  const HOLDOUT = 252;          // 채점 구간(약 12개월)은 평가에서 제외

  const S = {
    mode: 'expr',               // 'easy' | 'expr'
    w: null,
    src: 'rank(mom12_1) - 0.6 * rank(vol120)',
    name: '',
    editing: null,
    years: 5,
    neutralize: 'market',
    decay: 4,
    maxWeight: 0.10,
    result: null,
    running: false,
    err: null,
    showOps: false,
    opsQuery: '',
    oos: null,                  // 채점 구간 결과
    oosRunning: false,
    peeks: 0                    // 채점 구간을 몇 번 봤는가
  };

  try { S.peeks = +(localStorage.getItem('quantlab.osPeeks') || 0); } catch (e) {}

  /* ------------------------------------------------------------------------
   *  링크로 식 주고받기
   *
   *  수업에서 "다들 이 식을 열어 보세요" 한마디로 끝나게 하려는 장치입니다.
   *  식은 주소 뒤에 붙어 다니므로 서버가 필요 없습니다.
   *  (한글 설명이 섞여도 깨지지 않게 UTF-8 → base64 로 감쌉니다)
   * ----------------------------------------------------------------------*/
  function encodeExpr(src) {
    try {
      const bytes = new TextEncoder().encode(src);
      let bin = '';
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  }
  function decodeExpr(t) {
    try {
      const b64 = t.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) { return null; }
  }
  function shareUrl() {
    const base = location.origin + location.pathname;
    return base + '#alpha!' + encodeExpr(S.src.trim()) +
      '!' + S.neutralize + '-' + S.decay + '-' + S.maxWeight + '-' + S.years;
  }
  // 주소에 식이 들어 있으면 그것으로 시작합니다: #alpha!<식>!<설정>
  (function () {
    const h = (location.hash || '').replace('#', '');
    if (h.indexOf('alpha!') !== 0) return;
    const parts = h.split('!');
    const src = decodeExpr(parts[1] || '');
    if (!src) return;
    S.src = src;
    S.mode = 'expr';
    S.name = '링크로 받은 알파';
    if (parts[2]) {
      const c = parts[2].split('-');
      if (c[0]) S.neutralize = c[0];
      if (c[1]) S.decay = +c[1] || S.decay;
      if (c[2]) S.maxWeight = +c[2] || S.maxWeight;
      if (c[3]) S.years = +c[3] || S.years;
    }
  })();

  function nf() { return STRAT.aiFeatures.length; }
  function blank() { return new Array(nf()).fill(0); }
  function ensure() { if (!S.w) S.w = blank(); }

  /* ------------------------------------------------------------------------
   *  예제 — 그냥 보고 베끼는 것이 가장 빠른 학습입니다.
   *  전부 실제 IQC에서 통하는 아이디어의 축소판입니다.
   * ----------------------------------------------------------------------*/
  const RECIPES = [
    { name: '위험조정 모멘텀', code: 'rank(mom12_1) - 0.6 * rank(vol120)',
      why: '오르되 덜 흔들린 종목. 가장 흔한 두 팩터 조합입니다. 여기서 출발하세요.' },
    { name: '단기 반전', code: '-ts_delta(close, 5) / ts_std_dev(returns, 20)',
      why: '5일 동안 많이 빠진 종목을 삽니다. 변동성으로 나눠 큰 종목이 독식하지 않게 했습니다.' },
    { name: '섹터 중립 모멘텀', code: 'group_neutralize(rank(mom12_1), sector)',
      why: '반도체가 다 오른 날 반도체를 몰아 사는 것을 막습니다. IQC에서 가장 많이 쓰는 형태입니다.' },
    { name: '거래량 급증 되돌림', code: '-rank(volume / ts_mean(volume, 20)) * rank(mom5)',
      why: '거래량이 터지면서 급등한 종목을 피합니다. 두 신호를 곱해 "둘 다일 때"만 강하게 반응합니다.' },
    { name: '추세 + 눌림목', code: 'rank(trend) * (1 - ts_rank(close, 20))',
      why: '큰 추세는 살아 있는데 최근 20일 안에서는 아래쪽에 있는 종목. 조건 두 개를 곱으로 엮습니다.' },
    { name: '저변동 + 회전율 낮추기', code: 'decay_linear(-rank(vol20), 10)',
      why: 'decay_linear로 신호를 부드럽게 만들어 회전율을 낮춥니다. Fitness를 올리는 표준 기법입니다.' },
    { name: '가격-거래량 괴리', code: '-ts_corr(rank(close), rank(volume), 20)',
      why: '오를 때 거래량이 따라오지 않는 종목을 찾습니다. 두 시계열의 상관을 신호로 쓰는 예입니다.' },
    { name: '변동성 대비 추세', code: 'zscore(trend) / (1 + rank(vol120))',
      why: '나눗셈으로 위험을 벌점처럼 붙입니다. zscore는 순위와 달리 크기 차이를 남깁니다.' }
  ];

  const PRESETS = [
    { name: '모멘텀 하나만', w: { mom12_1: 1 } },
    { name: '위험조정 모멘텀', w: { mom12_1: 1, vol120: -0.7 } },
    { name: '추세 + 되돌림', w: { trend: 1, mom5: -0.5 } },
    { name: '역발상', w: { dd: -0.8, rsi: -0.5, vol120: -0.3 } }
  ];

  function fromKeys(obj) {
    const w = blank();
    STRAT.aiFeatures.forEach(function (f, j) { if (obj[f.key] !== undefined) w[j] = obj[f.key]; });
    return w;
  }

  /* ------------------------------------------------------------------------
   *  실행
   * ----------------------------------------------------------------------*/
  function currentScorer() {
    if (S.mode === 'easy') {
      ensure();
      const w = S.w.slice();
      if (!w.some(function (x) { return x; })) throw new Error('계수가 전부 0입니다. 하나 이상 움직여 보세요.');
      return { fn: function (i) { return ALPHA.scoreWith(w, i); }, label: ALPHA.formula(w), w: w, src: null };
    }
    const chk = EXPR.check(S.src);
    if (!chk.ok) throw new Error(chk.error);
    const ctx = EXPR.newContext();
    return { fn: function (i) { return EXPR.evalAt(chk.ast, i, ctx); }, label: S.src.trim(), w: null, src: S.src.trim() };
  }

  async function run(host) {
    let sc;
    try { sc = currentScorer(); }
    catch (e) { S.err = e.message; S.result = null; draw(host); return; }

    S.err = null;
    S.running = true;
    S.oos = null;
    draw(host);

    const n = DATA.state.dates.length;
    const hi = n - 1 - HOLDOUT;                    // 채점 구간은 건드리지 않습니다
    const lo = Math.max(300, hi - S.years * 252);

    let m;
    try {
      m = await SIM.run(sc.fn, {
        lo: lo, hi: hi,
        neutralize: S.neutralize, decay: S.decay, maxWeight: S.maxWeight
      }, function (f) {
        const el = U.$('#alphaProg');
        if (el) el.style.width = Math.round(f * 100) + '%';
      });
    } catch (e) {
      S.err = e.message;
      S.running = false;
      draw(host);
      return;
    }

    // 이미 저장한 알파들과 손익이 얼마나 닮았는지
    let selfCorr = NaN, corrWith = null;
    ALPHA.load().forEach(function (a) {
      if (!a.pnl || a.id === S.editing) return;
      const c = SIM.pnlCorr(m.pnl, a.pnl);
      if (isFinite(c) && (!isFinite(selfCorr) || Math.abs(c) > Math.abs(selfCorr))) {
        selfCorr = c; corrWith = a.name;
      }
    });

    S.result = {
      m: m, label: sc.label, w: sc.w, src: sc.src,
      selfCorr: selfCorr, corrWith: corrWith,
      grade: SIM.grade(m, selfCorr),
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] },
      config: { neutralize: S.neutralize, decay: S.decay, maxWeight: S.maxWeight, years: S.years }
    };
    S.running = false;

    if (root.JOURNAL) {
      root.JOURNAL.add({
        kind: 'alpha',
        name: S.name || '(이름 없음)',
        formula: sc.label,
        mode: S.mode,
        sharpe: m.sharpe, fitness: m.fitness, turnover: m.turnover, returns: m.returns,
        maxCorr: isFinite(selfCorr) ? Math.abs(selfCorr) : undefined,
        passed: S.result.grade.pass,
        config: S.result.config
      });
    }
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  편집기
   * ----------------------------------------------------------------------*/
  function modeBar(host) {
    const seg = U.el('div', 'seg');
    [['expr', '식 모드 (IQC 방식)'], ['easy', '쉬운 모드 (슬라이더)']].forEach(function (o) {
      const b = U.el('button', S.mode === o[0] ? 'on' : '', o[1]);
      b.addEventListener('click', function () { S.mode = o[0]; S.result = null; S.err = null; draw(host); });
      seg.appendChild(b);
    });
    return seg;
  }

  function exprEditor(p) {
    const ta = U.el('textarea', 'code');
    ta.value = S.src;
    ta.spellcheck = false;
    ta.placeholder = 'rank(mom12_1) - 0.6 * rank(vol120)';
    const out = U.el('div', 'expr-out');

    function validate() {
      S.src = ta.value;
      const t = ta.value.trim();
      if (!t) { out.className = 'expr-out'; out.textContent = '식을 쓰면 여기서 문법을 검사합니다.'; return; }
      const chk = EXPR.check(t);
      if (chk.ok) {
        ta.classList.remove('bad');
        out.className = 'expr-out ok';
        out.textContent = '✓ 문법 이상 없음';
      } else {
        ta.classList.add('bad');
        out.className = 'expr-out bad';
        out.textContent = '✗ ' + chk.error;
      }
    }
    ta.addEventListener('input', validate);
    p.body.appendChild(ta);
    p.body.appendChild(out);
    validate();

    // 연산자를 클릭하면 커서 자리에 끼워 넣습니다
    p.__insert = function (text) {
      const s0 = ta.selectionStart, s1 = ta.selectionEnd;
      ta.value = ta.value.slice(0, s0) + text + ta.value.slice(s1);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s0 + text.length;
      validate();
    };
  }

  function easyEditor(p, host) {
    ensure();
    const eq = U.el('div', 'code');
    eq.style.cssText = 'min-height:auto;white-space:nowrap;overflow-x:auto';
    eq.textContent = '알파 = ' + ALPHA.formula(S.w);
    p.body.appendChild(eq);

    STRAT.aiFeatures.forEach(function (f, j) {
      const row = U.el('div');
      row.style.cssText = 'display:grid;grid-template-columns:150px 1fr 52px;gap:10px;align-items:center;padding:3px 0';
      const nm = U.el('div', 'small');
      nm.textContent = f.name;
      const sl = U.el('input');
      sl.type = 'range'; sl.min = '-2'; sl.max = '2'; sl.step = '0.1';
      sl.value = String(S.w[j]);
      const val = U.el('div', 'mono num');
      val.style.cssText = 'text-align:right;font-size:12px';
      const paint = function () {
        val.textContent = S.w[j].toFixed(1);
        val.style.color = S.w[j] > 0 ? 'var(--up)' : (S.w[j] < 0 ? 'var(--down)' : 'var(--ink-3)');
      };
      paint();
      sl.addEventListener('input', function () {
        S.w[j] = +sl.value;
        paint();
        eq.textContent = '알파 = ' + ALPHA.formula(S.w);
      });
      row.appendChild(nm); row.appendChild(sl); row.appendChild(val);
      p.body.appendChild(row);
    });

    const pre = U.el('div', 'row mt');
    PRESETS.forEach(function (ps) {
      const b = U.el('button', 'btn sm', ps.name);
      b.addEventListener('click', function () {
        S.w = fromKeys(ps.w); S.result = null; S.name = ps.name; S.editing = null; draw(host);
      });
      pre.appendChild(b);
    });
    const flip = U.el('button', 'btn sm', '부호 뒤집기');
    flip.addEventListener('click', function () {
      S.w = S.w.map(function (x) { return -x; }); S.result = null; draw(host);
    });
    pre.appendChild(flip);
    p.body.appendChild(pre);
  }

  function builderPanel(host) {
    const p = App.panel('알파 만들기 <span class="accent">ALPHA</span>',
      { sub: '종목을 줄 세우는 식을 씁니다. IQC에서 제출하는 것이 바로 이것입니다' });
    p.actions.appendChild(modeBar(host));

    if (S.mode === 'expr') exprEditor(p); else easyEditor(p, host);

    // 시뮬레이션 설정 — BRAIN의 Settings 패널과 같은 항목들입니다
    const cfg = U.el('div', 'row mt');
    const mk = function (label, opts, cur, on, title) {
      const f = U.el('div', 'field');
      const l = U.el('label', '', label);
      if (title) l.title = title;
      f.appendChild(l);
      const sel = U.el('select');
      if (title) sel.title = title;
      opts.forEach(function (o) {
        const e = U.el('option', '', o[1]); e.value = String(o[0]);
        if (String(o[0]) === String(cur)) e.selected = true;
        sel.appendChild(e);
      });
      sel.addEventListener('change', function () { on(sel.value); });
      f.appendChild(sel);
      return f;
    };
    cfg.appendChild(mk('중립화', [['market', '시장 중립'], ['sector', '섹터 중립'], ['none', '안 함']],
      S.neutralize, function (v) { S.neutralize = v; },
      '알파에서 공통 성분을 뺍니다. 시장 중립이면 지수가 오르내려도 성과가 흔들리지 않습니다.'));
    cfg.appendChild(mk('감쇠(Decay)', [[1, '없음'], [4, '4일'], [10, '10일'], [20, '20일']],
      S.decay, function (v) { S.decay = +v; },
      '최근 며칠 비중을 평균 냅니다. 회전율이 내려가 Fitness가 올라갑니다.'));
    cfg.appendChild(mk('종목 상한', [[0.05, '5%'], [0.1, '10%'], [0.25, '25%'], [1, '없음']],
      S.maxWeight, function (v) { S.maxWeight = +v; },
      '한 종목이 북에서 차지할 수 있는 최대 비중입니다.'));
    cfg.appendChild(mk('평가 기간', [[3, '3년'], [5, '5년'], [8, '8년']],
      S.years, function (v) { S.years = +v; }));

    const btn = U.el('button', 'btn primary', S.running ? '시뮬레이션 중…' : '시뮬레이션 실행');
    btn.disabled = S.running;
    btn.addEventListener('click', function () { run(host); });
    cfg.appendChild(btn);

    if (S.mode === 'expr') {
      const share = U.el('button', 'btn', '링크 복사');
      share.title = '이 식과 설정이 담긴 주소를 복사합니다. 수업에서 그대로 나눠 주세요.';
      share.addEventListener('click', function () {
        const url = shareUrl();
        const done = function () {
          share.textContent = '복사됨';
          setTimeout(function () { if (share.isConnected) share.textContent = '링크 복사'; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () {});
        } else {
          const ta = U.el('textarea');
          ta.value = url;
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          ta.remove();
        }
      });
      cfg.appendChild(share);
    }
    p.body.appendChild(cfg);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'alphaProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
    }
    if (S.err) {
      const e = U.el('div', 'note bad');
      e.innerHTML = '<b>실행할 수 없습니다.</b><br>' + U.escape(S.err);
      p.body.appendChild(e);
    }

    // 북이 만들어지는 순서를 그림으로
    const pipe = U.el('div', 'pipe mt');
    ['알파 식',
     S.neutralize === 'none' ? '중립화 없음' : (S.neutralize === 'sector' ? '섹터 중립' : '시장 중립'),
     '상한 ' + (S.maxWeight >= 1 ? '없음' : (S.maxWeight * 100) + '%'),
     '비중 정규화',
     S.decay > 1 ? '감쇠 ' + S.decay + '일' : '감쇠 없음',
     '롱숏 북'].forEach(function (t, k) {
      if (k) pipe.appendChild(U.el('span', 'p-arrow', '›'));
      pipe.appendChild(U.el('span', 'p-step' + (k === 0 || k === 5 ? ' on' : ''), t));
    });
    p.body.appendChild(pipe);

    const lock = U.el('div', 'note');
    lock.innerHTML = '평가는 <b>개발 구간(IS)에서만</b> 돌아갑니다. 최근 12개월(채점 구간·OS)은 여기서도 잠겨 있습니다. ' +
      'BRAIN도 제출 전에는 IS 성적만 보여 줍니다. 미리 보면 대회 구조 자체가 의미를 잃습니다.';
    p.body.appendChild(lock);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  채점 구간(OS)에서 확인
   *
   *  이 사이트에서 가장 중요한 순간입니다. 개발 구간에서 좋았던 알파가
   *  처음 보는 구간에서도 같은 성적을 내는가. IQC도, 실무도 이것만 봅니다.
   *
   *  다만 여기서 딜레마가 생깁니다. 채점 구간을 여러 번 보면 그 구간도
   *  결국 개발 구간이 됩니다. 못 보게 막으면 배우지 못하고, 열어 두면
   *  남용됩니다. 그래서 열어 두되 <b>몇 번 봤는지 세어 보여 줍니다.</b>
   *  실제 대회가 제출 횟수를 제한하는 것과 같은 이유입니다.
   * ----------------------------------------------------------------------*/
  async function runOOS(host) {
    let sc;
    try { sc = currentScorer(); }
    catch (e) { S.err = e.message; draw(host); return; }

    S.oosRunning = true;
    draw(host);

    const n = DATA.state.dates.length;
    const lo = n - 1 - HOLDOUT;
    const hi = n - 1;
    const cfg = S.result.config;

    let m;
    try {
      m = await SIM.run(sc.fn, {
        lo: lo, hi: hi,
        neutralize: cfg.neutralize, decay: cfg.decay, maxWeight: cfg.maxWeight
      }, function (f) {
        const el = U.$('#oosProg');
        if (el) el.style.width = Math.round(f * 100) + '%';
      });
    } catch (e) {
      S.err = e.message;
      S.oosRunning = false;
      draw(host);
      return;
    }

    S.peeks++;
    try { localStorage.setItem('quantlab.osPeeks', String(S.peeks)); } catch (e) {}

    S.oos = {
      m: m,
      grade: SIM.grade(m),
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] },
      peek: S.peeks
    };
    S.oosRunning = false;

    if (root.JOURNAL) {
      root.JOURNAL.add({
        kind: 'alpha-oos',
        name: S.name || '(이름 없음)',
        formula: S.result.label,
        is: { sharpe: S.result.m.sharpe, fitness: S.result.m.fitness, turnover: S.result.m.turnover },
        oos: { sharpe: m.sharpe, fitness: m.fitness, turnover: m.turnover },
        gap: S.result.m.sharpe - m.sharpe,
        peek: S.peeks,
        config: cfg
      });
    }
    draw(host);
  }

  function oosPanel(host) {
    const R = S.result;
    const p = App.panel('채점 구간에서 확인 <span class="accent">OUT-OF-SAMPLE</span>',
      { sub: '개발 구간에서 좋았던 것이 처음 보는 구간에서도 통하는가' });

    if (!S.oos) {
      const warn = U.el('div', 'note warn');
      warn.innerHTML =
        '여기를 누르면 <b>그동안 잠겨 있던 최근 12개월</b>에서 같은 알파를 돌립니다. ' +
        'IQC의 제출, 캐글의 Private 리더보드에 해당합니다.<br><br>' +
        '<b>주의.</b> 채점 구간을 여러 번 보면 그 구간도 결국 개발 구간이 됩니다. ' +
        '"OS에서 잘 나올 때까지 식을 고치는" 순간 이 구조는 무너집니다. ' +
        '그래서 막지는 않되 <b>몇 번 봤는지 세어 둡니다.</b> ' +
        (S.peeks ? '지금까지 <b>' + S.peeks + '번</b> 봤습니다. ' : '아직 한 번도 보지 않았습니다. ') +
        '발표할 때 이 횟수를 함께 밝히세요.';
      p.body.appendChild(warn);

      const btn = U.el('button', 'btn' + (S.peeks >= 3 ? '' : ' primary'),
        S.oosRunning ? '채점 중…' : '채점 구간에서 돌리기');
      btn.disabled = S.oosRunning;
      btn.addEventListener('click', function () { runOOS(host); });
      p.body.appendChild(btn);

      if (S.oosRunning) {
        const bar = U.el('div', 'bar');
        bar.style.marginTop = '10px';
        const i = U.el('i'); i.id = 'oosProg'; i.style.width = '0%';
        bar.appendChild(i);
        p.body.appendChild(bar);
      }
      if (S.peeks >= 3) {
        p.body.appendChild(U.el('div', 'tiny',
          '이미 여러 번 봤습니다. 지금부터 나오는 채점 구간 성적은 "처음 보는 구간"의 성적이 아닙니다.'));
      }
      return p;
    }

    const O = S.oos, m = O.m, im = R.m;
    p.body.appendChild(U.el('div', 'tiny',
      O.range.start + ' ~ ' + O.range.end + ' · ' + m.n + '거래일 · ' + O.peek + '번째 확인'));

    const rows = [
      ['Sharpe', im.sharpe, m.sharpe, function (v) { return v.toFixed(2); }, SIM.GATE.sharpe],
      ['Fitness', im.fitness, m.fitness, function (v) { return v.toFixed(2); }, SIM.GATE.fitness],
      ['회전율', im.turnover, m.turnover, function (v) { return (v * 100).toFixed(1) + '%'; }, null],
      ['연 수익률', im.returns, m.returns, function (v) { return (v * 100).toFixed(1) + '%'; }, null]
    ].map(function (r) {
      const gapEl = U.el('span', '');
      if (isFinite(r[1]) && isFinite(r[2])) {
        const d = r[2] - r[1];
        gapEl.className = Math.abs(d) < (r[4] ? 0.3 : 0.05) ? 'up' : 'down';
        gapEl.textContent = (d >= 0 ? '+' : '') + r[3](d).replace('%', '') + (r[3](0).indexOf('%') >= 0 ? '%p' : '');
      } else gapEl.textContent = '—';
      return { cells: [r[0],
        isFinite(r[1]) ? r[3](r[1]) : '—',
        isFinite(r[2]) ? r[3](r[2]) : '—',
        gapEl] };
    });
    p.body.appendChild(App.table(
      ['', { label: '개발 구간(IS)', num: true }, { label: '채점 구간(OS)', num: true }, { label: '차이', num: true }],
      rows));

    const sGap = (isFinite(im.sharpe) && isFinite(m.sharpe)) ? im.sharpe - m.sharpe : NaN;
    const held = isFinite(sGap) && Math.abs(sGap) < 0.5 && m.sharpe > 0;
    const v = U.el('div', 'verdict ' + (held ? 'pass' : 'fail'));
    v.appendChild(U.el('span', 'v-badge', held ? '재현됨' : '무너짐'));
    const vt = U.el('div', 'v-text');
    vt.innerHTML = held
      ? '<b>채점 구간에서도 비슷하게 나왔습니다.</b> Sharpe ' + im.sharpe.toFixed(2) + ' → ' +
        m.sharpe.toFixed(2) + '. 이것이 알파가 진짜라는 유일한 증거입니다. ' +
        '개발 구간 성적이 아무리 좋아도 이 표에서 무너지면 소용없고, 반대로 개발 구간이 평범해도 ' +
        '여기서 버티면 쓸 만한 알파입니다.'
      : '<b>개발 구간과 채점 구간의 차이가 큽니다.</b> Sharpe ' +
        (isFinite(im.sharpe) ? im.sharpe.toFixed(2) : '—') + ' → ' +
        (isFinite(m.sharpe) ? m.sharpe.toFixed(2) : '—') + '. ' +
        '개발 구간에만 맞는 알파를 만든 것입니다(과적합). ' +
        '설정을 여러 번 바꿔가며 가장 좋은 것을 고를수록 이 격차가 커집니다. ' +
        '캐글에서 Public 1등이 Private에서 수백 등으로 떨어지는 일이 매번 벌어지는 이유입니다.<br><br>' +
        '<b>여기서 하지 말아야 할 것:</b> 이 결과를 보고 식을 고쳐 다시 돌리는 것. ' +
        '그러면 채점 구간이 개발 구간이 됩니다. 다른 아이디어로 처음부터 다시 시작하세요.';
    v.appendChild(vt);
    p.body.appendChild(v);

    const again = U.el('button', 'btn sm', '접기');
    again.addEventListener('click', function () { S.oos = null; draw(host); });
    p.actions.appendChild(again);

    if (m.n < 120) {
      p.body.appendChild(U.el('div', 'note warn',
        '채점 구간이 ' + m.n + '거래일밖에 안 됩니다. 짧은 구간의 성적은 운의 비중이 큽니다.'));
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  채점표
   * ----------------------------------------------------------------------*/
  function gaugeOf(c) {
    const box = U.el('div', 'gauge ' + (c.pass ? 'pass' : 'fail'));
    const top = U.el('div', 'g-top');
    top.appendChild(U.el('span', 'g-name', c.label));
    top.appendChild(U.el('span', 'g-need', '기준 ' + c.need));
    box.appendChild(top);
    box.appendChild(U.el('div', 'g-val', isFinite(c.value) ? c.fmt(c.value) : '—'));

    // 눈금: 합격선을 정해진 자리에 긋고, 현재 값의 상대 위치를 채웁니다.
    const track = U.el('div', 'g-track');
    const fill = U.el('div', 'g-fill');
    let ratio, markAt;
    if (c.key === 'turnover') {
      // 1%~70%를 그대로 그리면 낮은 값이 보이지 않습니다. 제곱근으로 폅니다.
      ratio = Math.sqrt(Math.min(1, Math.max(0, (c.value || 0) / SIM.GATE.turnoverMax)));
      markAt = 1;
      const lo = U.el('div', 'g-mark');
      lo.style.left = Math.round(Math.sqrt(SIM.GATE.turnoverMin / SIM.GATE.turnoverMax) * 100) + '%';
      lo.style.opacity = '.5';
      box.__extraMark = lo;
    } else if (c.key === 'selfCorr') {
      ratio = Math.min(1, Math.abs(c.value || 0));
      markAt = SIM.GATE.selfCorr;
    } else {
      const gate = c.key === 'sharpe' ? SIM.GATE.sharpe : SIM.GATE.fitness;
      ratio = Math.max(0, Math.min(1, (c.value || 0) / (gate / 0.6)));
      markAt = 0.6;
    }
    fill.style.width = Math.round(ratio * 100) + '%';
    track.appendChild(fill);

    const mark = U.el('div', 'g-mark');
    mark.style.left = Math.round(markAt * 100) + '%';
    if (markAt >= 1) mark.style.marginLeft = '-2px';      // 오른쪽 끝에서 잘리지 않게
    track.appendChild(mark);
    if (box.__extraMark) track.appendChild(box.__extraMark);
    box.appendChild(track);

    box.appendChild(U.el('div', 'g-why', c.why));
    return box;
  }

  function scorePanel(host) {
    const R = S.result, m = R.m;
    const p = App.panel('IQC 채점표 <span class="accent">SIMULATION</span>',
      { sub: R.range.start + ' ~ ' + R.range.end + ' · ' + m.n + '거래일 · 채점 구간 제외' });

    const v = U.el('div', 'verdict ' + (R.grade.pass ? 'pass' : 'fail'));
    v.appendChild(U.el('span', 'v-badge', R.grade.pass ? '제출 가능' : '기준 미달'));
    const vt = U.el('div', 'v-text');
    const failed = R.grade.checks.filter(function (c) { return !c.pass; });
    vt.innerHTML = R.grade.pass
      ? 'WorldQuant BRAIN이라면 <b>제출할 수 있는 알파</b>입니다. 기준을 모두 넘겼습니다. ' +
        '다만 이건 개발 구간 성적입니다. 진짜는 채점 구간에서 같은 성적이 나오는가입니다.'
      : '<b>' + failed.map(function (c) { return c.label; }).join(', ') + '</b> 이(가) 기준에 못 미칩니다. ' +
        '실제 IQC라면 이 상태로는 제출 자체가 되지 않습니다. ' +
        (failed.some(function (c) { return c.key === 'turnover'; })
          ? '회전율이 문제라면 <b>감쇠(Decay)</b>를 늘리거나 신호에 <b>decay_linear</b>·<b>ts_mean</b>을 씌워 보세요. '
          : '') +
        (failed.some(function (c) { return c.key === 'fitness'; })
          ? 'Fitness는 회전율에 벌점을 주므로, 성과를 올리는 것보다 회전율을 낮추는 편이 빠를 때가 많습니다.'
          : '');
    v.appendChild(vt);
    p.body.appendChild(v);

    const grid = U.el('div', 'score');
    R.grade.checks.forEach(function (c) { grid.appendChild(gaugeOf(c)); });
    p.body.appendChild(grid);

    // 보조 지표
    const g2 = U.el('div', 'grid g4 mt');
    g2.appendChild(App.stat('연 수익률', isFinite(m.returns) ? (m.returns * 100).toFixed(1) + '%' : '—',
      '북의 절반 기준', m.returns >= 0 ? 'up' : 'down'));
    g2.appendChild(App.stat('최대낙폭', isFinite(m.mdd) ? (m.mdd * 100).toFixed(1) + '%' : '—', '누적 손익 기준'));
    g2.appendChild(App.stat('Margin', isFinite(m.margin) ? m.margin.toFixed(1) + 'bp' : '—',
      '1달러 거래당 남는 돈'));
    g2.appendChild(App.stat('보유 종목', m.longs + ' / ' + m.shorts, '롱 / 숏 평균'));
    p.body.appendChild(g2);

    // 누적 손익 곡선
    p.body.appendChild(U.el('div', 'tiny mt', '누적 손익 (롱숏 북 · 거래비용 전)'));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, {
      labels: m.dates.map(function (d) { return d.slice(2, 7); }),
      series: [{ name: '누적 손익', values: m.cum, color: C.seriesColor(1), area: true }],
      zeroLine: 0,
      yFmt: function (x) { return (x * 100).toFixed(0) + '%'; }
    });

    // 앞뒤 절반 비교 — 한 시기에만 통한 알파를 걸러냅니다
    const h = m.halves;
    const stable = isFinite(h.first) && isFinite(h.second) && h.first > 0 && h.second > 0;
    const note = U.el('div', 'note ' + (stable ? 'ok' : 'warn'));
    note.innerHTML = '기간을 반으로 갈랐을 때 Sharpe는 <b>앞 절반 ' +
      (isFinite(h.first) ? h.first.toFixed(2) : '—') + '</b>, <b>뒤 절반 ' +
      (isFinite(h.second) ? h.second.toFixed(2) : '—') + '</b> 입니다. ' +
      (stable
        ? '두 구간 모두 양수라 특정 시기에만 통한 알파는 아닙니다.'
        : '한쪽이 음수입니다. 특정 시기에만 통했을 가능성이 큽니다. ' +
          '전체 Sharpe가 좋아 보여도 이런 알파는 실제로 쓰면 무너집니다.');
    p.body.appendChild(note);

    if (isFinite(R.selfCorr) && R.corrWith) {
      const sc = U.el('div', 'note ' + (Math.abs(R.selfCorr) < SIM.GATE.selfCorr ? '' : 'warn'));
      sc.innerHTML = '내가 저장한 알파 중 <b>' + U.escape(R.corrWith) + '</b> 와 손익 상관이 <b>' +
        R.selfCorr.toFixed(2) + '</b> 입니다. ' +
        (Math.abs(R.selfCorr) < SIM.GATE.selfCorr
          ? '충분히 다릅니다. 둘 다 포트폴리오에 넣으면 분산 효과가 있습니다.'
          : 'IQC 기준(0.7)을 넘습니다. 실제 대회라면 <b>같은 알파를 두 번 낸 것</b>으로 봅니다. ' +
            '점수가 좋아도 새 알파로 인정받지 못합니다.');
      p.body.appendChild(sc);
    }

    // 저장
    const row = U.el('div', 'row mt');
    const fn = U.el('div', 'field');
    fn.appendChild(U.el('label', '', '알파 이름'));
    const nin = U.el('input');
    nin.type = 'text'; nin.maxLength = 24;
    nin.value = S.name || '내 알파';
    nin.addEventListener('input', function () { S.name = nin.value; });
    fn.appendChild(nin);
    row.appendChild(fn);

    const sv = U.el('button', 'btn primary', S.editing ? '수정 저장' : '저장하고 전략 목록에 넣기');
    sv.addEventListener('click', function () {
      const nm = (nin.value || '내 알파').trim().slice(0, 24);
      ALPHA.save({
        id: S.editing || ALPHA.newId(),
        name: nm,
        mode: S.mode,
        w: R.w, src: R.src,
        pnl: m.pnl.slice(-250).map(function (x) { return +x.toFixed(8); }),
        metrics: { sharpe: m.sharpe, fitness: m.fitness, turnover: m.turnover, returns: m.returns },
        config: R.config,
        range: R.range,
        created: new Date().toISOString()
      });
      S.name = nm;
      S.editing = null;
      draw(host);
    });
    row.appendChild(sv);
    p.body.appendChild(row);
    const bridge = U.el('div', 'note');
    bridge.innerHTML =
      '저장하면 전략 실험실과 모의투자 목록에 <b>내 알파</b>로 나타납니다. ' +
      '거기서 거래비용을 물리고 채점 구간에 제출할 수 있습니다.<br><br>' +
      '<b>두 화면의 숫자가 다른 이유.</b> 여기는 IQC 방식이라 <b>롱숏</b>입니다 — ' +
      '점수가 높은 종목을 사고 낮은 종목을 공매도해 시장 방향을 지웁니다. ' +
      '전략 실험실은 <b>롱온리</b>라 상위 N종목만 삽니다. 같은 알파라도 ' +
      '롱온리는 시장이 오르면 같이 오르고, 롱숏은 그 부분이 빠집니다. ' +
      '그래서 샤프도 회전율도 다르게 나옵니다. 어느 쪽이 맞는 게 아니라 <b>보는 렌즈가 다릅니다</b> — ' +
      'IQC·헤지펀드는 롱숏으로, 개인 투자자와 대부분의 펀드는 롱온리로 봅니다.';
    p.body.appendChild(bridge);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  알파 묶음 — IQC가 알파를 여러 개 요구하는 이유
   *
   *  하나로는 기준을 못 넘겨도, 서로 닮지 않은 것을 섞으면 넘길 수 있습니다.
   *  손실이 겹치지 않으면 변동성이 줄어들기 때문입니다. 이걸 말로 하면
   *  안 와닿는데, 자기가 만든 알파로 보면 바로 압니다.
   * ----------------------------------------------------------------------*/
  function portfolioPanel() {
    const list = ALPHA.load().filter(function (a) { return a.pnl && a.pnl.length >= 60; });
    if (list.length < 2) return null;

    const p = App.panel('알파 묶음 <span class="accent">PORTFOLIO</span>',
      { sub: list.length + '개를 같은 비중으로 합치면 어떻게 되는가' });

    // 길이가 다르면 겹치는 뒷부분만 씁니다
    const n = Math.min.apply(null, list.map(function (a) { return a.pnl.length; }));
    const series = list.map(function (a) { return a.pnl.slice(a.pnl.length - n); });

    const sharpeOf = function (arr) {
      const m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      let v = 0;
      arr.forEach(function (x) { v += (x - m) * (x - m); });
      const sd = arr.length > 1 ? Math.sqrt(v / (arr.length - 1)) : 0;
      return sd > 0 ? (m / sd) * Math.sqrt(252) : NaN;
    };
    const sdOf = function (arr) {
      const m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      let v = 0;
      arr.forEach(function (x) { v += (x - m) * (x - m); });
      return arr.length > 1 ? Math.sqrt(v / (arr.length - 1)) : 0;
    };

    // 같은 '금액'이 아니라 같은 '위험'으로 섞습니다.
    // 알파마다 변동성이 다른데 금액만 맞춰 섞으면 시끄러운 쪽이 묶음을 지배합니다.
    // 실무에서 알파를 합칠 때도 위험을 맞춰 섞습니다.
    const sds = series.map(sdOf);
    const scaled = series.map(function (x, k) {
      const f = sds[k] > 0 ? 1 / sds[k] : 0;
      return x.map(function (v) { return v * f; });
    });
    const combinedScaled = [];
    for (let i = 0; i < n; i++) {
      let s2 = 0;
      scaled.forEach(function (x) { s2 += x[i]; });
      combinedScaled.push(s2 / scaled.length);
    }
    // 그림으로 비교할 때는 원래 크기 감각으로 되돌립니다
    const avgSd = sds.reduce(function (a, b) { return a + b; }, 0) / sds.length;
    const combined = combinedScaled.map(function (v) { return v * avgSd; });

    const each = series.map(sharpeOf);
    const finite = each.filter(isFinite);
    const best = finite.length ? Math.max.apply(null, finite) : NaN;
    const avgSharpe = finite.length ? finite.reduce(function (a, b) { return a + b; }, 0) / finite.length : NaN;
    const combo = sharpeOf(combinedScaled);

    // 상관을 미리 재 둡니다(판정에 씁니다)
    let maxAbsCorr = 0, maxPair = null;
    for (let i2 = 0; i2 < list.length; i2++) {
      for (let j = i2 + 1; j < list.length; j++) {
        const c = SIM.pnlCorr(series[i2], series[j]);
        if (isFinite(c) && Math.abs(c) > maxAbsCorr) {
          maxAbsCorr = Math.abs(c);
          maxPair = list[i2].name + ' · ' + list[j].name;
        }
      }
    }

    const g = U.el('div', 'grid g3');
    g.appendChild(App.stat('가장 좋은 알파 하나', isFinite(best) ? best.toFixed(2) : '—', 'Sharpe'));
    g.appendChild(App.stat('개별 평균', isFinite(avgSharpe) ? avgSharpe.toFixed(2) : '—', 'Sharpe'));
    g.appendChild(App.stat(list.length + '개를 합치면', isFinite(combo) ? combo.toFixed(2) : '—',
      isFinite(combo) && isFinite(avgSharpe)
        ? '평균 대비 ' + (combo - avgSharpe >= 0 ? '+' : '') + (combo - avgSharpe).toFixed(2) : '',
      isFinite(combo) && isFinite(avgSharpe) && combo > avgSharpe ? 'up' : 'down'));
    p.body.appendChild(g);
    const how = U.el('div', 'tiny');
    how.innerHTML = '같은 금액이 아니라 <b>같은 위험</b>으로 섞었습니다(변동성이 큰 알파의 비중을 줄임). ' +
      '금액만 맞춰 섞으면 시끄러운 알파가 묶음을 지배해 버립니다. 실무도 이렇게 합니다.';
    p.body.appendChild(how);

    // 누적 손익 — 개별과 묶음을 같이
    const cumOf = function (arr) {
      let acc = 0;
      return arr.map(function (x) { acc += x / 0.5; return acc; });
    };
    const chartSeries = list.map(function (a, k) {
      return { name: a.name, values: cumOf(series[k]), color: C.mutedColor(), dash: [3, 3] };
    });
    chartSeries.push({ name: '묶음 (같은 위험)', values: cumOf(combined), color: C.seriesColor(1) });
    p.body.appendChild(C.legend(chartSeries.map(function (x) {
      return { name: x.name, color: x.color, dash: x.dash };
    })));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, {
      labels: new Array(n).fill(''),
      series: chartSeries, zeroLine: 0,
      yFmt: function (x) { return (x * 100).toFixed(0) + '%'; }
    });

    // 상관 행렬
    p.body.appendChild(U.el('div', 'tiny mt',
      '알파끼리 손익 상관 — 낮을수록 섞는 보람이 있습니다. 맨 왼쪽 Sharpe도 함께 보세요'));
    const rows = list.map(function (a, i2) {
      const sh = U.el('span', 'mono ' + (each[i2] > 0 ? 'up' : 'down'));
      sh.textContent = isFinite(each[i2]) ? each[i2].toFixed(2) : '—';
      const cells = [U.el('span', 'small', a.name), sh];
      list.forEach(function (b2, j) {
        if (i2 === j) { cells.push(U.el('span', 'tiny', '—')); return; }
        const c = SIM.pnlCorr(series[i2], series[j]);
        const el = U.el('span', !isFinite(c) ? '' : (Math.abs(c) >= SIM.GATE.selfCorr ? 'down' : (Math.abs(c) < 0.3 ? 'up' : '')));
        el.textContent = isFinite(c) ? c.toFixed(2) : '—';
        cells.push(el);
      });
      return { cells: cells };
    });
    p.body.appendChild(App.table(
      ['', { label: 'Sharpe', num: true }].concat(list.map(function (a) { return { label: a.name, num: true }; })),
      rows, { scroll: true }));

    // 왜 좋아졌는지/안 좋아졌는지를 실제 원인으로 구분해서 말합니다.
    // "상관이 높아서"라고 뭉뚱그리면 틀릴 때가 많습니다 — 약한 알파를 섞어
    // 희석된 경우와 닮아서 분산이 안 된 경우는 처방이 다릅니다.
    const weak = each.filter(function (x) { return isFinite(x) && x <= 0; }).length;
    const beatsAvg = isFinite(combo) && isFinite(avgSharpe) && combo > avgSharpe + 0.01;
    const beatsBest = isFinite(combo) && isFinite(best) && combo > best;

    let msg, cls;
    if (beatsBest) {
      cls = 'ok';
      msg = '<b>합친 쪽이 가장 좋은 알파 하나보다 낫습니다</b>(' + best.toFixed(2) + ' → ' + combo.toFixed(2) + '). ' +
        '수익이 커져서가 아니라 <b>변동성이 줄어서</b>입니다. 알파들의 손실이 서로 다른 날 나면 ' +
        '합쳤을 때 상쇄됩니다. 이것이 IQC가 알파를 여러 개, 그것도 <b>서로 닮지 않게</b> 내라고 하는 이유입니다.';
    } else if (beatsAvg) {
      cls = 'ok';
      msg = '<b>분산 효과는 확인됩니다.</b> 개별 평균 ' + avgSharpe.toFixed(2) + ' → 묶음 ' + combo.toFixed(2) +
        '. 다만 가장 좋은 알파 하나(' + best.toFixed(2) + ')는 아직 못 넘었습니다.<br><br>' +
        '평균보다 높다는 것이 <b>서로 손실을 상쇄했다는 증거</b>입니다. ' +
        '가장 좋은 하나까지 넘으려면, 그 알파에 견줄 만한 것을 하나 더 만들어야 합니다. ' +
        '약한 알파를 많이 넣는다고 되지 않습니다.';
    } else if (maxAbsCorr >= SIM.GATE.selfCorr) {
      cls = 'warn';
      msg = '<b>닮은 알파가 섞여 있습니다.</b> 「' + U.escape(maxPair || '') + '」의 상관이 ' +
        maxAbsCorr.toFixed(2) + '입니다(기준 ' + SIM.GATE.selfCorr + '). ' +
        '사실상 같은 알파라 섞어도 분산이 되지 않습니다. ' +
        '서로 다른 데이터(가격 / 거래량 / 섹터)와 서로 다른 시계(5일 / 20일 / 1년)를 쓰는 알파를 만들어 보세요.';
    } else if (weak) {
      cls = 'warn';
      msg = '<b>상관은 낮은데도(최대 ' + maxAbsCorr.toFixed(2) + ') 나아지지 않았습니다.</b> ' +
        '원인은 상관이 아니라 <b>알파의 질</b>입니다. Sharpe가 0 이하인 알파가 ' + weak + '개 있습니다.<br><br>' +
        '분산은 <b>각자 돈을 버는 알파들</b>을 섞을 때만 이득입니다. ' +
        '지지 않는 것과 이기는 것은 다릅니다. 손해 보는 알파를 아무리 다양하게 섞어도 손해입니다. ' +
        '위 표에서 Sharpe가 음수인 것을 지우고 다시 보세요.';
    } else {
      cls = 'warn';
      msg = '<b>합쳐도 평균보다 나아지지 않았습니다.</b> 상관도 낮고(최대 ' + maxAbsCorr.toFixed(2) + ') ' +
        '개별 알파도 음수는 없는데 이렇다면, 표본이 짧아(' + n + '일) 추정이 흔들리는 것일 수 있습니다. ' +
        '평가 기간을 늘려 다시 시뮬레이션한 뒤 저장해 보세요.';
    }
    const note = U.el('div', 'note ' + cls);
    note.innerHTML = msg;
    p.body.appendChild(note);

    // 구간이 다른 알파를 섞으면 비교가 성립하지 않습니다
    const ranges = {};
    list.forEach(function (a) { if (a.range) ranges[a.range.start + '~' + a.range.end] = 1; });
    if (Object.keys(ranges).length > 1) {
      p.body.appendChild(U.el('div', 'note warn',
        '평가 구간이 서로 다른 알파가 섞여 있습니다. 겹치는 뒷부분 ' + n + '일만 써서 계산했지만, ' +
        '날짜가 정확히 맞는다는 보장은 없습니다. 정확히 비교하려면 같은 설정으로 다시 시뮬레이션해 저장하세요.'));
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  도움말 — 예제 / 연산자 / 필드
   * ----------------------------------------------------------------------*/
  function recipePanel(host) {
    const p = App.panel('예제에서 출발하기', { sub: '누르면 편집기에 들어갑니다. 한 군데씩 고쳐 보세요' });
    const g = U.el('div', 'grid g2');
    RECIPES.forEach(function (r) {
      const card = U.el('div', 'recipe');
      card.innerHTML = '<div class="r-name">' + U.escape(r.name) + '</div>' +
        '<div class="r-code">' + U.escape(r.code) + '</div>' +
        '<div class="r-why">' + U.escape(r.why) + '</div>';
      card.addEventListener('click', function () {
        S.mode = 'expr'; S.src = r.code; S.name = r.name;
        S.editing = null; S.result = null; S.err = null;
        draw(host);
        App.scrollTop();
      });
      g.appendChild(card);
    });
    p.body.appendChild(g);
    const honest = U.el('div', 'note');
    honest.innerHTML = '<b>이 예제들이 전부 기준을 통과하지는 않습니다.</b> 일부러 그렇게 뒀습니다. ' +
      '그럴듯한 아이디어 대부분이 실제로는 통하지 않는다는 것이 이 일의 출발점입니다. ' +
      '예제를 그대로 돌려 보고, 어디를 어떻게 고치면 Sharpe·Fitness·회전율이 움직이는지 ' +
      '한 번에 한 군데씩 바꿔 보세요. 통과하는 알파를 찾는 것이 여러분의 과제입니다.';
    p.body.appendChild(honest);
    return p;
  }

  function opsPanel(host, insert) {
    const p = App.panel('연산자와 데이터 <span class="accent">REFERENCE</span>',
      { sub: 'BRAIN Fast Expression의 축소판입니다' });

    const toggle = U.el('button', 'btn sm', S.showOps ? '접기' : '펼치기');
    toggle.addEventListener('click', function () { S.showOps = !S.showOps; draw(host); });
    p.actions.appendChild(toggle);

    // 데이터 필드는 항상 보이게 (가장 자주 찾습니다)
    p.body.appendChild(U.el('div', 'tiny', '데이터 필드 — 누르면 식에 들어갑니다'));
    const fbox = U.el('div', 'row');
    fbox.style.marginBottom = '8px';
    Object.keys(EXPR.fields).forEach(function (k) {
      const b = U.el('button', 'btn sm mono', k);
      b.title = EXPR.fields[k].desc;
      b.addEventListener('click', function () { if (insert) insert(k); });
      fbox.appendChild(b);
    });
    p.body.appendChild(fbox);

    const total = Object.keys(EXPR.functions).length;
    if (!S.showOps && !S.opsQuery) {
      p.body.appendChild(U.el('div', 'tiny', '"펼치기"를 누르면 연산자 ' + total + '개의 설명을 볼 수 있습니다.'));
      return p;
    }

    // 25개가 넘어가면 훑는 것보다 찾는 것이 빠릅니다.
    const q = U.el('input');
    q.type = 'search';
    q.placeholder = '연산자 검색 (예: rank, 순위, 평균, 상관)';
    q.value = S.opsQuery;
    q.style.margin = '4px 0 8px';
    p.body.appendChild(q);

    const listBox = U.el('div');
    p.body.appendChild(listBox);

    function renderList() {
      listBox.innerHTML = '';
      const f = S.opsQuery.trim().toLowerCase();
      const cats = {};
      let shown = 0;
      Object.keys(EXPR.functions).forEach(function (k) {
        const fn = EXPR.functions[k];
        if (f && (k + ' ' + fn.sig + ' ' + fn.desc).toLowerCase().indexOf(f) < 0) return;
        (cats[fn.cat] = cats[fn.cat] || []).push({ key: k, f: fn });
        shown++;
      });
      [['횡단면', ' — 그날 종목들끼리 비교'], ['시계열', ' — 같은 종목의 과거와 비교'], ['산술', '']]
        .forEach(function (cc) {
          const cat = cc[0];
          if (!cats[cat]) return;
          const h = U.el('div', 'tiny');
          h.style.cssText = 'letter-spacing:.1em;text-transform:uppercase;margin:12px 0 4px;color:var(--amber)';
          h.textContent = cat + cc[1];
          listBox.appendChild(h);
          const box = U.el('div', 'ops');
          cats[cat].forEach(function (o) {
            const row = U.el('div', 'op-row');
            const sig = U.el('div', 'op-sig', o.f.sig);
            sig.addEventListener('click', function () { if (insert) insert(o.key + '('); });
            row.appendChild(sig);
            row.appendChild(U.el('div', 'op-desc', o.f.desc));
            box.appendChild(row);
          });
          listBox.appendChild(box);
        });
      if (!shown) listBox.appendChild(U.el('div', 'empty', '그런 이름의 연산자가 없습니다.'));
    }

    q.addEventListener('input', function () { S.opsQuery = q.value; renderList(); });
    renderList();
    return p;
  }

  function savedPanel(host) {
    const list = ALPHA.load();
    if (!list.length) return null;
    const p = App.panel('저장한 알파', { sub: list.length + '개 · 이 브라우저에 저장됩니다' });

    list.forEach(function (a) {
      const row = U.el('div');
      row.style.cssText = 'padding:9px 0;border-bottom:1px solid var(--line)';
      const head = U.el('div', 'row center');
      head.style.justifyContent = 'space-between';
      const left = U.el('div');
      left.style.minWidth = '0';
      const mt = a.metrics || {};
      left.innerHTML = '<div style="font-weight:650">' + U.escape(a.name) +
        (isFinite(mt.sharpe) ? ' <span class="tiny mono">Sharpe ' + mt.sharpe.toFixed(2) +
          ' · Fitness ' + (isFinite(mt.fitness) ? mt.fitness.toFixed(2) : '—') +
          ' · 회전율 ' + (isFinite(mt.turnover) ? (mt.turnover * 100).toFixed(0) + '%' : '—') + '</span>' : '') +
        '</div><div class="tiny mono" style="margin-top:2px;overflow-x:auto">' +
        U.escape(a.src || ALPHA.formula(a.w || [])) + '</div>';
      head.appendChild(left);

      const acts = U.el('div', 'row');
      const ed = U.el('button', 'btn sm', '불러오기');
      ed.addEventListener('click', function () {
        S.mode = a.src ? 'expr' : 'easy';
        if (a.src) S.src = a.src; else S.w = (a.w || blank()).slice();
        if (a.config) {
          S.neutralize = a.config.neutralize || S.neutralize;
          S.decay = a.config.decay || S.decay;
          S.maxWeight = a.config.maxWeight || S.maxWeight;
          S.years = a.config.years || S.years;
        }
        S.name = a.name; S.editing = a.id; S.result = null; S.err = null;
        draw(host);
        App.scrollTop();
      });
      const bt = U.el('button', 'btn sm', '백테스트 →');
      bt.addEventListener('click', function () {
        const sc = App.screens.strategy;
        if (sc && sc.select) sc.select('alpha:' + a.id);
        App.go('strategy');
      });
      const rm = U.el('button', 'btn sm', '삭제');
      rm.addEventListener('click', function () {
        if (rm.dataset.armed) { ALPHA.remove(a.id); draw(host); return; }
        rm.dataset.armed = '1'; rm.textContent = '정말?'; rm.className = 'btn sm danger';
        setTimeout(function () {
          if (!rm.isConnected) return;
          delete rm.dataset.armed; rm.textContent = '삭제'; rm.className = 'btn sm';
        }, 3000);
      });
      acts.appendChild(ed); acts.appendChild(bt); acts.appendChild(rm);
      head.appendChild(acts);
      row.appendChild(head);
      p.body.appendChild(row);
    });

    if (list.filter(function (a) { return a.pnl; }).length >= 1) {
      p.body.appendChild(U.el('div', 'tiny mt',
        '알파를 저장할 때 일별 손익도 함께 남깁니다. 다음에 만드는 알파가 이것들과 얼마나 닮았는지(자기상관) ' +
        '자동으로 비교합니다. IQC에서 같은 알파를 이름만 바꿔 내는 것을 막는 장치입니다.'));
    }
    return p;
  }

  function introPanel() {
    const p = App.panel('IQC는 알파를 이렇게 봅니다');
    p.body.innerHTML =
      '<p class="small">WorldQuant International Quant Championship에서 참가자가 제출하는 것은 ' +
      '<b>식 한 줄</b>입니다. 수익률이 얼마인지로 뽑지 않습니다. ' +
      '그 식으로 롱숏 북을 만들어 매일 굴린 다음, 아래 기준을 넘는지로 봅니다.</p>' +
      '<div class="code" style="min-height:auto;white-space:pre-wrap">' +
      'Sharpe   ≥ 1.25    수익 / 변동성 (연율)\n' +
      'Fitness  ≥ 1.00    Sharpe × √(|수익률| / 회전율)\n' +
      'Turnover 1 ~ 70%   하루에 북의 몇 %를 갈아치우나\n' +
      '자기상관  &lt; 0.70    내가 이미 낸 알파와 얼마나 닮았나</div>' +
      '<p class="small" style="margin-top:10px">Fitness가 왜 저렇게 생겼는지가 핵심입니다. ' +
      '회전율이 분모에 있어서 <b>많이 사고팔아 낸 성과는 깎입니다.</b> ' +
      '실제 운용에서 회전율이 곧 비용이기 때문입니다. ' +
      '그래서 IQC 상위권은 "더 잘 맞히는 법"만큼 "덜 갈아타는 법"을 고민합니다.</p>' +
      '<div class="note">순서를 지키세요. <b>가설을 말로 먼저 정하고</b>, 그다음 식을 씁니다. ' +
      '계수를 흔들어 Sharpe가 오르는 조합을 찾는 것은 아주 쉽고, 그렇게 찾은 값은 ' +
      '채점 구간에서 거의 사라집니다. 시도할 때마다 연구 노트에 남으니 나중에 확인해 보세요.</div>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    const bp = builderPanel(host);
    host.appendChild(bp);
    if (S.result) {
      host.appendChild(scorePanel(host));
      host.appendChild(oosPanel(host));
    }
    if (S.mode === 'expr') {
      host.appendChild(recipePanel(host));
      host.appendChild(opsPanel(host, bp.__insert));
    }
    const sp = savedPanel(host);
    if (sp) host.appendChild(sp);
    const pp = portfolioPanel();
    if (pp) host.appendChild(pp);
    if (!S.result) host.appendChild(introPanel());
  }

  App.register('alpha', {
    render: draw,
    // 다른 화면(배우기의 알파 사전 등)에서 식을 들고 넘어올 때 씁니다.
    load: function (src, name) {
      S.mode = 'expr';
      S.src = src;
      S.name = name || '';
      S.editing = null;
      S.result = null;
      S.oos = null;
      S.err = null;
      App.go('alpha');
    }
  });
})(window.QL = window.QL || {});
