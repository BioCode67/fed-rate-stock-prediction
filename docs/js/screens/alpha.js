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
    showOps: false
  };

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
        created: new Date().toISOString()
      });
      S.name = nm;
      S.editing = null;
      draw(host);
    });
    row.appendChild(sv);
    p.body.appendChild(row);
    p.body.appendChild(U.el('div', 'tiny',
      '저장하면 전략 실험실과 모의투자 목록에 "내 알파"로 나타납니다. ' +
      '거기서 거래비용을 물리고 채점 구간에 제출할 수 있습니다.'));
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

    if (!S.showOps) {
      p.body.appendChild(U.el('div', 'tiny', '"펼치기"를 누르면 연산자 ' +
        Object.keys(EXPR.functions).length + '개의 설명을 볼 수 있습니다.'));
      return p;
    }

    const cats = {};
    Object.keys(EXPR.functions).forEach(function (k) {
      const f = EXPR.functions[k];
      (cats[f.cat] = cats[f.cat] || []).push({ key: k, f: f });
    });
    [['횡단면', ' — 그날 종목들끼리 비교'], ['시계열', ' — 같은 종목의 과거와 비교'], ['산술', '']]
      .forEach(function (cc) {
        const cat = cc[0];
        if (!cats[cat]) return;
        const h = U.el('div', 'tiny');
        h.style.cssText = 'letter-spacing:.1em;text-transform:uppercase;margin:12px 0 4px;color:var(--amber)';
        h.textContent = cat + cc[1];
        p.body.appendChild(h);
        const box = U.el('div', 'ops');
        cats[cat].forEach(function (o) {
          const row = U.el('div', 'op-row');
          const sig = U.el('div', 'op-sig', o.f.sig);
          sig.addEventListener('click', function () { if (insert) insert(o.key + '('); });
          row.appendChild(sig);
          row.appendChild(U.el('div', 'op-desc', o.f.desc));
          box.appendChild(row);
        });
        p.body.appendChild(box);
      });
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
    if (S.result) host.appendChild(scorePanel(host));
    if (S.mode === 'expr') {
      host.appendChild(recipePanel(host));
      host.appendChild(opsPanel(host, bp.__insert));
    }
    const sp = savedPanel(host);
    if (sp) host.appendChild(sp);
    if (!S.result) host.appendChild(introPanel());
  }

  App.register('alpha', { render: draw });
})(window.QL = window.QL || {});
