/* ============================================================================
 *  alpha.js (화면) — 알파 만들기
 *
 *  여기까지 학생은 남이 만든 전략을 골라 쓰기만 했습니다. 이제 직접 만듭니다.
 *  대회에서 실제로 제출하는 것이 바로 이 '식 한 줄'입니다.
 *
 *  중요한 설계 두 가지
 *    1) 평가는 개발 구간에서만. 채점 구간(최근 12개월)은 여기서도 잠겨 있습니다.
 *       여기서 채점 구간을 보게 하면 뒤에 있는 대회 구조가 통째로 무너집니다.
 *    2) 기존 팩터와의 상관을 반드시 보여 줍니다. 열심히 만든 알파가 사실은
 *       모멘텀과 상관 0.95인 경우가 아주 흔합니다. 그건 새 알파가 아닙니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, STRAT = root.STRAT, ALPHA = root.ALPHA;

  const HOLDOUT = 252;          // 채점 구간(약 12개월)은 평가에서 제외

  const S = {
    w: null,                    // 현재 편집 중인 계수
    name: '',
    editing: null,              // 수정 중인 알파 id
    years: 5,
    horizon: 21,
    result: null,
    running: false
  };

  function nf() { return STRAT.aiFeatures.length; }
  function blank() { return new Array(nf()).fill(0); }

  const PRESETS = [
    { name: '모멘텀 하나만', w: { mom12_1: 1 },
      why: '가장 오래 검증된 팩터 하나. 여기서 출발해 무엇을 더하면 나아지는지 봅니다.' },
    { name: '위험조정 모멘텀', w: { mom12_1: 1, vol120: -0.7 },
      why: '오르되 덜 흔들린 종목. 실무에서 가장 흔한 두 팩터 조합입니다.' },
    { name: '추세 + 되돌림', w: { trend: 1, mom5: -0.5 },
      why: '큰 추세는 따라가되 단기 급등은 피합니다. 방향이 다른 둘을 섞는 예.' },
    { name: '역발상', w: { dd: -0.8, rsi: -0.5, vol120: -0.3 },
      why: '많이 빠지고 많이 팔린 종목을 삽니다. 모멘텀과 반대로 갑니다.' }
  ];

  function fromKeys(obj) {
    const w = blank();
    STRAT.aiFeatures.forEach(function (f, j) { if (obj[f.key] !== undefined) w[j] = obj[f.key]; });
    return w;
  }

  function ensure() { if (!S.w) S.w = blank(); }

  /* ------------------------------------------------------------------------
   *  평가 — IC / 분위 / 회전율 / 기존 팩터와의 상관
   * ----------------------------------------------------------------------*/
  function corr(a, b) {
    const n = a.length;
    if (n < 3) return NaN;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    return (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : NaN;
  }

  function rankOf(arr) {
    const idx = arr.map(function (v, i) { return i; });
    idx.sort(function (x, y) { return arr[x] - arr[y]; });
    const r = new Array(arr.length);
    idx.forEach(function (o, k) { r[o] = 2 * k / (arr.length - 1) - 1; });
    return r;
  }

  async function evaluate(host) {
    ensure();
    if (!S.w.some(function (x) { return x; })) return;
    S.running = true;
    draw(host);

    const w = S.w.slice();
    const n = DATA.state.dates.length;
    const hi = n - 1 - HOLDOUT - S.horizon;         // 채점 구간을 건드리지 않습니다
    const lo = Math.max(300, hi - S.years * 252);
    const step = 5;
    const K = 10;                                   // 회전율은 상위 10종목 기준

    const ics = [];
    const quint = [0, 0, 0, 0, 0];
    let quintN = 0;
    const fcorrSum = new Array(nf()).fill(0), fcorrN = new Array(nf()).fill(0);
    let prevTop = null, turnSum = 0, turnN = 0;
    let done = 0;
    const total = Math.max(1, Math.floor((hi - lo) / step));

    for (let i = lo; i < hi; i += step) {
      const F = STRAT.featuresAt(i);
      if (F.tickers.length < 20) continue;

      const fwd = [], keep = [];
      F.tickers.forEach(function (t, k) {
        const s = DATA.series(t);
        const a = s[i], b = s[i + S.horizon];
        if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) return;
        fwd.push(b / a - 1);
        keep.push(k);
      });
      if (fwd.length < 20) continue;

      const mean = fwd.reduce(function (x, y) { return x + y; }, 0) / fwd.length;
      const excess = fwd.map(function (v) { return v - mean; });
      const fwdRank = rankOf(excess);

      // 알파 점수
      const av = keep.map(function (k) {
        const row = F.X[k];
        let v = 0;
        for (let j = 0; j < w.length; j++) if (w[j]) v += w[j] * row[j];
        return v;
      });
      ics.push(corr(av, fwdRank));

      // 5분위 초과수익
      const order = av.map(function (v, k) { return k; }).sort(function (x, y) { return av[x] - av[y]; });
      const per = Math.floor(order.length / 5);
      if (per >= 2) {
        for (let q = 0; q < 5; q++) {
          let sum = 0;
          for (let k = q * per; k < (q + 1) * per; k++) sum += excess[order[k]];
          quint[q] += sum / per;
        }
        quintN++;
      }

      // 기존 팩터와 얼마나 닮았나
      for (let j = 0; j < nf(); j++) {
        const col = keep.map(function (k) { return F.X[k][j]; });
        const c = corr(av, col);
        if (isFinite(c)) { fcorrSum[j] += c; fcorrN[j]++; }
      }

      // 회전율 (한 달 간격으로만)
      if ((i - lo) % 21 === 0) {
        const top = {};
        order.slice(-K).forEach(function (k) { top[F.tickers[keep[k]]] = 1; });
        if (prevTop) {
          let same = 0;
          Object.keys(top).forEach(function (t) { if (prevTop[t]) same++; });
          turnSum += 1 - same / K;
          turnN++;
        }
        prevTop = top;
      }

      done++;
      if (done % 20 === 0) {
        const el = U.$('#alphaProg');
        if (el) el.style.width = Math.round(done / total * 100) + '%';
        await U.yield_();
      }
    }

    const v = ics.filter(function (x) { return isFinite(x); });
    const m = v.reduce(function (a, b) { return a + b; }, 0) / (v.length || 1);
    let sd = 0;
    v.forEach(function (x) { sd += (x - m) * (x - m); });
    sd = Math.sqrt(sd / Math.max(1, v.length - 1));

    S.result = {
      ic: m, icStd: sd,
      icir: sd > 0 ? m / sd : NaN,
      t: sd > 0 ? m / (sd / Math.sqrt(v.length)) : NaN,
      posRate: v.filter(function (x) { return x > 0; }).length / (v.length || 1),
      n: v.length,
      series: ics,
      quint: quint.map(function (x) { return quintN ? x / quintN : NaN; }),
      spread: quintN ? (quint[4] - quint[0]) / quintN : NaN,
      fcorr: fcorrSum.map(function (x, j) { return fcorrN[j] ? x / fcorrN[j] : NaN; }),
      turnover: turnN ? turnSum / turnN : NaN,
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] },
      w: w
    };

    // 연구 노트에 기록 — 계수를 몇 번 흔들었는지가 나중에 가장 중요합니다.
    if (root.JOURNAL) {
      root.JOURNAL.add({
        kind: 'alpha',
        name: S.name || '(이름 없음)',
        formula: ALPHA.formula(w),
        horizon: S.horizon,
        years: S.years,
        ic: S.result.ic, t: S.result.t, icir: S.result.icir,
        spread: S.result.spread, turnover: S.result.turnover,
        maxCorr: Math.max.apply(null, S.result.fcorr.map(function (x) { return isFinite(x) ? Math.abs(x) : 0; }))
      });
    }
    S.running = false;
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  편집기
   * ----------------------------------------------------------------------*/
  function builderPanel(host) {
    ensure();
    const p = App.panel('알파 만들기 <span class="accent">ALPHA</span>',
      { sub: '종목을 줄 세우는 식을 직접 씁니다. 대회에서 제출하는 것이 바로 이것입니다' });

    // 지금 식
    const eq = U.el('div', 'mono');
    eq.style.cssText = 'padding:10px 12px;border:1px solid var(--line-strong);background:var(--panel-2);' +
      'font-size:13px;overflow-x:auto;white-space:nowrap;margin-bottom:12px';
    eq.textContent = '알파 = ' + ALPHA.formula(S.w);
    p.body.appendChild(eq);

    // 계수 슬라이더
    STRAT.aiFeatures.forEach(function (f, j) {
      const row = U.el('div');
      row.style.cssText = 'display:grid;grid-template-columns:150px 1fr 52px;gap:10px;align-items:center;padding:3px 0';

      const nm = U.el('div', 'small');
      nm.textContent = f.name;
      const sl = U.el('input');
      sl.type = 'range'; sl.min = '-2'; sl.max = '2'; sl.step = '0.1';
      sl.value = String(S.w[j]);
      const val = U.el('div', 'mono num');
      val.style.cssText = 'text-align:right;font-size:12px;color:' +
        (S.w[j] > 0 ? 'var(--up)' : (S.w[j] < 0 ? 'var(--down)' : 'var(--ink-3)'));
      val.textContent = S.w[j].toFixed(1);

      sl.addEventListener('input', function () {
        S.w[j] = +sl.value;
        val.textContent = S.w[j].toFixed(1);
        val.style.color = S.w[j] > 0 ? 'var(--up)' : (S.w[j] < 0 ? 'var(--down)' : 'var(--ink-3)');
        eq.textContent = '알파 = ' + ALPHA.formula(S.w);
      });

      row.appendChild(nm); row.appendChild(sl); row.appendChild(val);
      p.body.appendChild(row);
    });

    p.body.appendChild(U.el('div', 'tiny mt',
      '계수가 양수면 "그 값이 큰 종목을 산다", 음수면 "작은 종목을 산다"는 뜻입니다. ' +
      '9개 팩터는 모두 그날 종목들 사이의 순위(-1~1)로 바뀌어 있어 단위가 같습니다. 그래서 그냥 더하면 됩니다.'));

    // 실행 설정 + 버튼
    const cfg = U.el('div', 'row mt');
    const mk = function (label, opts, cur, on) {
      const f = U.el('div', 'field');
      f.appendChild(U.el('label', '', label));
      const sel = U.el('select');
      opts.forEach(function (o) {
        const e = U.el('option', '', o[1]); e.value = String(o[0]);
        if (String(o[0]) === String(cur)) e.selected = true;
        sel.appendChild(e);
      });
      sel.addEventListener('change', function () { on(sel.value); });
      f.appendChild(sel);
      return f;
    };
    cfg.appendChild(mk('예측 시계', [[5, '5일 뒤'], [21, '1개월 뒤'], [63, '3개월 뒤']],
      S.horizon, function (x) { S.horizon = +x; }));
    cfg.appendChild(mk('평가 기간', [[3, '3년'], [5, '5년'], [8, '8년']],
      S.years, function (x) { S.years = +x; }));

    const run = U.el('button', 'btn primary', S.running ? '평가 중…' : '알파 평가하기');
    run.disabled = S.running;
    run.addEventListener('click', function () { evaluate(host); });
    cfg.appendChild(run);

    const flip = U.el('button', 'btn', '부호 뒤집기');
    flip.title = 'IC가 음수로 나왔을 때 씁니다. 다만 이것도 한 번의 시도로 셉니다.';
    flip.addEventListener('click', function () {
      S.w = S.w.map(function (x) { return -x; });
      S.result = null;
      draw(host);
    });
    cfg.appendChild(flip);

    const clr = U.el('button', 'btn', '비우기');
    clr.addEventListener('click', function () { S.w = blank(); S.result = null; S.editing = null; S.name = ''; draw(host); });
    cfg.appendChild(clr);
    p.body.appendChild(cfg);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'alphaProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
    }

    p.body.appendChild(U.el('div', 'note',
      '평가는 <b>개발 구간에서만</b> 돌아갑니다. 최근 12개월(채점 구간)은 여기서도 잠겨 있습니다. ' +
      '여기서 미리 보면 대회 구조 자체가 의미를 잃습니다.'));

    // 프리셋
    const pre = U.el('div', 'row mt');
    PRESETS.forEach(function (ps) {
      const b = U.el('button', 'btn sm', ps.name);
      b.title = ps.why;
      b.addEventListener('click', function () {
        S.w = fromKeys(ps.w); S.result = null; S.name = ps.name; S.editing = null; draw(host);
      });
      pre.appendChild(b);
    });
    p.body.appendChild(U.el('div', 'tiny mt', '출발점이 필요하면:'));
    p.body.appendChild(pre);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  평가 결과
   * ----------------------------------------------------------------------*/
  function resultPanel(host) {
    const R = S.result;
    const p = App.panel('평가 결과', { sub: R.range.start + ' ~ ' + R.range.end + ' · 채점 구간 제외' });

    const g = U.el('div', 'grid g4');
    // IC가 음수면 '틀리게 맞히고 있다'는 뜻입니다. 초록으로 칠하면 안 됩니다.
    const icCls = R.ic > 0.02 ? 'up' : (R.ic < -0.02 ? 'down' : '');
    g.appendChild(App.stat('IC 평균', R.ic.toFixed(4),
      '방향 정확도 약 ' + (50 + R.ic * 50).toFixed(1) + '%', icCls));
    g.appendChild(App.stat('t값', isFinite(R.t) ? R.t.toFixed(2) : '—',
      Math.abs(R.t) > 2 ? '우연으로 보기 어려움' : '우연일 수 있음',
      Math.abs(R.t) > 2 ? 'up' : ''));
    g.appendChild(App.stat('ICIR', isFinite(R.icir) ? R.icir.toFixed(3) : '—', '꾸준한 정도'));
    g.appendChild(App.stat('상·하위 격차',
      isFinite(R.spread) ? ((R.spread >= 0 ? '+' : '') + (R.spread * 100).toFixed(2) + '%') : '—',
      '상위 20% − 하위 20%', R.spread >= 0 ? 'up' : 'down'));
    p.body.appendChild(g);

    // 분위 막대
    const cv = U.el('canvas', 'chart sm');
    p.body.appendChild(cv);
    const QL = ['하위 20%', '2분위', '3분위', '4분위', '상위 20%'];
    C.bars(cv, {
      items: R.quint.map(function (v, i) {
        return { label: QL[i], value: v || 0, color: (v || 0) >= 0 ? C.seriesColor(2) : C.seriesColor(7) };
      }),
      baseValue: 0, padL: 80,
      vFmt: function (v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; }
    });
    p.body.appendChild(U.el('div', 'tiny',
      '왼쪽에서 오른쪽으로 우상향해야 알파가 제 역할을 한 것입니다. ' +
      '상위 한 칸만 튀어 있으면 소수 종목의 운일 수 있습니다.'));

    // 회전율
    const t2 = U.el('div', 'grid g2 mt');
    t2.appendChild(App.stat('월 회전율(상위 10종목)',
      isFinite(R.turnover) ? (R.turnover * 100).toFixed(0) + '%' : '—',
      '한 달마다 갈아치우는 비율'));
    // 상·하위 격차가 음수면 비용을 논할 것도 없습니다. 공짜여도 손해입니다.
    const bre = isFinite(R.spread) && R.spread > 0 && isFinite(R.turnover) && R.turnover > 0
      ? R.spread / (2 * R.turnover) : NaN;
    t2.appendChild(App.stat('버틸 수 있는 편도 비용',
      isFinite(bre) ? (bre * 100).toFixed(2) + '%' : '없음',
      isFinite(bre) ? '이보다 비싸면 남는 게 없습니다' : '비용 0에서도 남는 게 없습니다',
      isFinite(bre) && bre > 0.001 ? 'up' : 'down'));
    p.body.appendChild(t2);

    // 기존 팩터와의 상관 — 가장 자주 놓치는 부분
    // 가장 닮은 팩터가 맨 위로 오게 정렬합니다 — 그게 봐야 할 줄입니다.
    const rows = STRAT.aiFeatures.map(function (f, j) { return { f: f, j: j, c: R.fcorr[j] }; })
      .sort(function (a, b) { return (isFinite(b.c) ? Math.abs(b.c) : 0) - (isFinite(a.c) ? Math.abs(a.c) : 0); })
      .map(function (x) {
        const cell = U.el('span', Math.abs(x.c) > 0.9 ? 'down' : (Math.abs(x.c) < 0.5 ? 'up' : ''));
        cell.textContent = isFinite(x.c) ? x.c.toFixed(2) : '—';
        return { cells: [x.f.name, (R.w[x.j] || 0).toFixed(1), cell] };
      });
    p.body.appendChild(U.el('div', 'tiny mt', '기존 팩터와 얼마나 닮았나 (횡단면 상관 평균 · 닮은 순)'));
    p.body.appendChild(App.table(['팩터', { label: '내 계수', num: true }, { label: '상관', num: true }], rows));

    const maxC = Math.max.apply(null, R.fcorr.map(function (x) { return isFinite(x) ? Math.abs(x) : 0; }));
    const worst = R.fcorr.map(function (x, j) { return { j: j, a: isFinite(x) ? Math.abs(x) : 0 }; })
      .sort(function (a, b) { return b.a - a.a; })[0];

    const good = R.t > 2 && maxC < 0.9;
    const verdict = U.el('div', 'note ' + (good ? 'ok' : 'warn'));
    let msg = '';
    if (Math.abs(R.ic) > 0.15) {
      msg = '<b>IC가 비정상적으로 높습니다(' + R.ic.toFixed(3) + ').</b> 정상적인 주가 데이터에서 나오는 값이 아닙니다. ' +
        '미래 정보가 섞였는지 의심해야 합니다.';
    } else if (R.t < -2) {
      msg = '<b>IC가 뚜렷하게 음수입니다(' + R.ic.toFixed(4) + ', t=' + R.t.toFixed(2) + ').</b> ' +
        '이 알파는 점수가 높은 종목이 오히려 <b>덜</b> 올랐다는 뜻입니다. 잘 맞히고 있는데 방향이 반대입니다.<br><br>' +
        '계수의 부호를 전부 뒤집으면 IC는 +' + Math.abs(R.ic).toFixed(4) + '이 됩니다. 그렇게 해도 됩니다. ' +
        '다만 <b>그것도 하나의 시도</b>입니다. 결과를 보고 나서 방향을 정했다면, ' +
        '그 t값은 이미 부풀려진 값입니다. 뒤집기 전에 왜 반대 방향이 말이 되는지 먼저 설명할 수 있어야 합니다. ' +
        '이 구간에서 모멘텀이 통하지 않은 것인지, 아니면 원래 반대인지는 다른 구간에서도 확인해 보세요.';
    } else if (Math.abs(R.t) <= 2) {
      msg = '<b>t값이 ' + R.t.toFixed(2) + '입니다.</b> 이 알파가 통한다고 말하기 어렵습니다. ' +
        '계수를 이리저리 바꿔 t값을 2 위로 올리는 것은 쉽지만, 그렇게 찾은 값은 대개 채점 구간에서 사라집니다. ' +
        '먼저 <b>왜 이 조합이 통해야 하는지</b> 말이 되는지 생각해 보세요.';
    } else if (maxC >= 0.9) {
      msg = '<b>t값은 통과했지만(' + R.t.toFixed(2) + ') 새로운 알파는 아닙니다.</b> ' +
        '「' + STRAT.aiFeatures[worst.j].name + '」과 상관이 ' + R.fcorr[worst.j].toFixed(2) + '입니다. ' +
        '사실상 그 팩터를 다시 쓴 것이라, 기존 포트폴리오에 더해도 분산되지 않습니다. ' +
        '실무에서 알파를 심사할 때 성과보다 먼저 보는 항목입니다.';
    } else {
      msg = '<b>쓸 만합니다.</b> t값 ' + R.t.toFixed(2) + ', 기존 팩터와 최대 상관 ' + maxC.toFixed(2) +
        '. 통계적으로 우연이라 보기 어렵고, 기존 팩터의 재탕도 아닙니다. ' +
        '이제 전략 실험실에서 거래비용까지 물려 보고, 채점 구간에서도 재현되는지 확인하세요.';
    }
    verdict.innerHTML = msg;
    p.body.appendChild(verdict);

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
      ALPHA.save({ id: S.editing || ALPHA.newId(), name: nm, w: S.w.slice(), created: new Date().toISOString() });
      S.name = nm;
      S.editing = null;
      draw(host);
    });
    row.appendChild(sv);
    p.body.appendChild(row);
    p.body.appendChild(U.el('div', 'tiny', '저장하면 전략 실험실 목록에 "내 알파"로 나타나고, 고전 팩터·AI와 같은 조건에서 백테스트됩니다.'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  저장한 알파
   * ----------------------------------------------------------------------*/
  function savedPanel(host) {
    const list = ALPHA.load();
    if (!list.length) return null;
    const p = App.panel('저장한 알파', { sub: list.length + '개 · 이 브라우저에 저장됩니다' });

    list.forEach(function (a) {
      const row = U.el('div');
      row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--line)';
      const head = U.el('div', 'row center');
      head.style.justifyContent = 'space-between';
      const left = U.el('div');
      left.innerHTML = '<div style="font-weight:650">' + U.escape(a.name) + '</div>' +
        '<div class="tiny mono" style="margin-top:2px">' + U.escape(ALPHA.formula(a.w)) + '</div>';
      head.appendChild(left);

      const acts = U.el('div', 'row');
      const ed = U.el('button', 'btn sm', '불러오기');
      ed.addEventListener('click', function () {
        S.w = a.w.slice(); S.name = a.name; S.editing = a.id; S.result = null;
        draw(host);
        U.$('#main').scrollTop = 0;
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
    return p;
  }

  function introPanel() {
    const p = App.panel('알파란 무엇인가');
    p.body.innerHTML =
      '<p class="small">퀀트에서 <b>알파</b>는 종목을 줄 세우는 식 하나입니다. 그게 전부입니다.</p>' +
      '<div class="mono" style="padding:10px 12px;border-left:2px solid var(--amber);background:var(--panel-2);' +
      'font-size:12.5px;margin:10px 0">알파 = 1.0×모멘텀(12-1개월) − 0.7×변동성(6개월)</div>' +
      '<p class="small">"지난 1년 많이 올랐고, 그러면서 덜 흔들린 종목을 산다"는 뜻입니다. ' +
      'WorldQuant IQC 같은 대회에서 참가자가 제출하는 것이 정확히 이런 식 한 줄입니다. ' +
      '성과보다 <b>IC·안정성·기존 팩터와의 독립성</b>으로 평가받습니다.</p>' +
      '<p class="small">좋은 알파의 조건은 셋입니다.<br>' +
      '· <b>말이 될 것</b> — 왜 통해야 하는지 한 문장으로 설명할 수 있어야 합니다. 숫자를 맞춘 결과가 아니라 가설이 먼저입니다.<br>' +
      '· <b>우연이 아닐 것</b> — |t| &gt; 2.<br>' +
      '· <b>새로울 것</b> — 이미 쓰고 있는 팩터와 상관이 낮아야 보탬이 됩니다.</p>' +
      '<div class="note">계수를 이리저리 흔들어 t값이 올라가는 조합을 찾는 것은 쉽습니다. ' +
      '그게 바로 이 사이트가 계속 경고하는 다중검정입니다. ' +
      '<b>먼저 가설을 말로 정하고, 그다음 계수를 넣으세요.</b> 순서가 반대면 배우는 게 없습니다.</div>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(builderPanel(host));
    if (S.result) host.appendChild(resultPanel(host));
    const sp = savedPanel(host);
    if (sp) host.appendChild(sp);
    if (!S.result) host.appendChild(introPanel());
  }

  App.register('alpha', { render: draw });
})(window.QL = window.QL || {});
