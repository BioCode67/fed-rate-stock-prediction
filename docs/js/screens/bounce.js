/* ============================================================================
 *  bounce.js — 낙폭 반등 연구실
 *
 *  질문: "많이 떨어진 종목은 정말 반등하는가? 반등한다면 며칠 뒤에 파는 게 좋은가?"
 *
 *  이 화면은 다른 화면들과 질문의 종류가 다릅니다.
 *  알파 만들기·전략 실험실은 "매일 전 종목의 순위를 매겨 롱숏으로 담는" 방식이고,
 *  여기는 "어떤 사건이 일어난 뒤 며칠 동안 무슨 일이 벌어지는가"를 봅니다.
 *  학계에서 이벤트 스터디(event study)라고 부르는 방식입니다.
 *
 *  ★ 이 화면에서 제일 중요한 것은 반등 확률이 아니라 '기준선과의 차이'입니다.
 *
 *    "낙폭 후 20일 반등 확률 62%" — 이 숫자만 보면 대단해 보입니다.
 *    그런데 아무 날이나 아무 종목이나 사도 20일 뒤 오를 확률이 58%라면?
 *    낙폭은 4%p만 보탠 것이고, 그 정도는 거래비용에 묻힙니다.
 *    그래서 모든 표에 기준선을 나란히 놓았습니다. 기준선 없는 확률은 숫자 장난입니다.
 *
 *  ★ 생존 편향이 이 화면에서 가장 치명적입니다.
 *    데이터에는 '지금 나스닥100에 남아 있는 종목'만 있습니다.
 *    크게 떨어진 뒤 회복하지 못하고 지수에서 빠지거나 상장폐지된 회사는 아예 없습니다.
 *    즉 우리는 이미 '살아남은 종목의 낙폭'만 보고 있습니다.
 *    여기서 나오는 반등 확률은 실제보다 반드시 높습니다. 화면에도 그렇게 적어 둡니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, STRAT = root.STRAT;
  const IND = STRAT.IND;

  const HOLDOUT = 252;                     // 채점 구간(약 12개월)은 기본 분석에서 뺍니다
  const HORIZONS = [1, 3, 5, 10, 20, 40, 60];
  const DDWIN = 126;                       // 낙폭을 재는 창(약 6개월 고점 대비)
  const BASE_STEP = 3;                     // 기준선 표본은 3일 간격으로 (계산량을 줄입니다)

  const S = {
    threshold: -0.20,        // 낙폭 기준 (고점 대비)
    filter: 'none',          // 'none' | 'rsi' | 'vol'
    cooldown: 60,            // 같은 하락에서 신호가 반복되지 않게 막는 기간
    years: 5,
    cost: 0.002,             // 왕복 거래비용 가정
    result: null,
    running: false,
    prog: 0,
    oos: null,
    oosRunning: false,
    peeks: 0
  };

  try { S.peeks = +(localStorage.getItem('quantlab.bouncePeeks') || 0); } catch (e) {}

  /* ------------------------------------------------------------------------
   *  신호 찾기
   *
   *  i일 종가까지의 정보만 씁니다. 낙폭도 RSI도 i일까지만 봅니다.
   *  쿨다운이 왜 필요한가: 한 번 크게 빠지면 그 뒤 수십 일 동안 매일 '낙폭 -20%'가
   *  성립합니다. 그대로 두면 하나의 하락이 표본 50개로 부풀어 통계가 거짓말을 합니다.
   * ----------------------------------------------------------------------*/
  function findSignals(lo, hi) {
    const out = [];
    const tickers = DATA.state.tickers.filter(function (t) { return !DATA.isBenchmark(t); });

    tickers.forEach(function (t) {
      const s = DATA.series(t);
      if (!s) return;
      let last = -1e9;
      for (let i = lo; i <= hi; i++) {
        if (i - last < S.cooldown) continue;
        const d = IND.drawdown(s, i, DDWIN);
        if (!isFinite(d) || d > S.threshold) continue;

        if (S.filter === 'rsi') {
          const r = IND.rsi(s, i, 14);
          if (!isFinite(r) || r >= 30) continue;
        } else if (S.filter === 'vol') {
          const v = DATA.state.volume[t];
          if (!v) continue;
          let a = 0, ca = 0, b = 0, cb = 0;
          for (let k = Math.max(0, i - 4); k <= i; k++) if (isFinite(v[k])) { a += v[k]; ca++; }
          for (let k = Math.max(0, i - 59); k <= i; k++) if (isFinite(v[k])) { b += v[k]; cb++; }
          if (!(ca && cb && b > 0 && (a / ca) / (b / cb) - 1 > 0.5)) continue;
        }

        out.push({ t: t, i: i, dd: d });
        last = i;
      }
    });
    return out;
  }

  // i일에 사서 i+h일에 판 수익률 (둘 다 종가 기준)
  function fwd(s, i, h) {
    const a = IND.px(s, i), b = IND.px(s, i + h);
    return (isFinite(a) && isFinite(b) && a > 0) ? b / a - 1 : NaN;
  }

  /* ------------------------------------------------------------------------
   *  기준선 — "아무 날이나 아무 종목이나 샀다면"
   *
   *  이게 없으면 반등 확률 62%가 좋은 건지 나쁜 건지 알 수 없습니다.
   *  같은 기간, 같은 종목 풀에서 무작위로 산 경우의 성적입니다.
   * ----------------------------------------------------------------------*/
  function baseline(lo, hi, h) {
    const out = [];
    const tickers = DATA.state.tickers.filter(function (t) { return !DATA.isBenchmark(t); });
    tickers.forEach(function (t) {
      const s = DATA.series(t);
      if (!s) return;
      for (let i = lo; i + h <= hi; i += BASE_STEP) {
        const r = fwd(s, i, h);
        if (isFinite(r)) out.push(r);
      }
    });
    return out;
  }

  function winRate(a) {
    if (!a.length) return NaN;
    let w = 0;
    for (let k = 0; k < a.length; k++) if (a[k] > 0) w++;
    return w / a.length;
  }

  async function analyse(lo, hi) {
    const sig = findSignals(lo, hi);
    await U.yield_();

    const rows = [];
    for (let k = 0; k < HORIZONS.length; k++) {
      const h = HORIZONS[k];

      // 신호 그룹 — i+h 가 분석 구간을 넘지 않는 것만 씁니다(미래를 당겨 쓰지 않기 위해)
      const grp = [];
      sig.forEach(function (x) {
        if (x.i + h > hi) return;
        const r = fwd(DATA.series(x.t), x.i, h);
        if (isFinite(r)) grp.push(r);
      });

      const base = baseline(lo, hi, h);
      const w = U.welchT(grp, base);
      const mg = grp.length ? U.mean(grp) : NaN;
      const mb = base.length ? U.mean(base) : NaN;

      rows.push({
        h: h,
        n: grp.length,
        win: winRate(grp),
        winBase: winRate(base),
        mean: mg,
        med: grp.length ? U.quantile(grp, 0.5) : NaN,
        base: mb,
        excess: mg - mb,
        net: mg - mb - S.cost,
        t: w.t,
        p: w.p,
        values: grp,
        baseValues: base
      });

      S.prog = (k + 1) / HORIZONS.length;
      const el = U.$('#bounceProg');
      if (el) el.style.width = Math.round(S.prog * 100) + '%';
      await U.yield_();
    }

    // 섹터별로도 갈라 봅니다 — 어떤 업종의 낙폭이 잘 돌아오는가
    const bestRow = rows.reduce(function (a, b) {
      return (isFinite(b.net) && (!isFinite(a.net) || b.net > a.net)) ? b : a;
    }, rows[0]);

    const bySector = {};
    sig.forEach(function (x) {
      if (x.i + bestRow.h > hi) return;
      const r = fwd(DATA.series(x.t), x.i, bestRow.h);
      if (!isFinite(r)) return;
      const sec = DATA.sector(x.t);
      (bySector[sec] = bySector[sec] || []).push(r);
    });

    const sectors = Object.keys(bySector)
      .map(function (k) {
        return { sector: k, n: bySector[k].length, mean: U.mean(bySector[k]), win: winRate(bySector[k]) };
      })
      .filter(function (x) { return x.n >= 10; })
      .sort(function (a, b) { return b.mean - a.mean; });

    return {
      rows: rows, best: bestRow, sectors: sectors,
      nSignals: sig.length,
      nTickers: Object.keys(sig.reduce(function (m, x) { m[x.t] = 1; return m; }, {})).length,
      avgDD: sig.length ? U.mean(sig.map(function (x) { return x.dd; })) : NaN,
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] },
      config: {
        threshold: S.threshold, filter: S.filter, cooldown: S.cooldown,
        years: S.years, cost: S.cost
      }
    };
  }

  async function run(host) {
    S.running = true; S.result = null; S.oos = null; S.prog = 0;
    draw(host);

    const n = DATA.state.dates.length;
    const hi = n - 1 - HOLDOUT;                 // 채점 구간은 건드리지 않습니다
    const lo = Math.max(DDWIN + 10, hi - S.years * 252);

    S.result = await analyse(lo, hi);
    S.running = false;

    if (root.JOURNAL) {
      root.JOURNAL.add({
        kind: 'bounce',
        name: '낙폭 ' + Math.round(S.threshold * 100) + '% · ' + filterLabel(S.filter),
        threshold: S.threshold,
        nSignals: S.result.nSignals,
        bestH: S.result.best.h,
        excess: S.result.best.excess,
        net: S.result.best.net,
        tval: S.result.best.t,
        config: S.result.config
      });
    }
    draw(host);
  }

  async function runOOS(host) {
    S.oosRunning = true;
    draw(host);

    const n = DATA.state.dates.length;
    const lo = n - 1 - HOLDOUT;
    const hi = n - 1;
    const r = await analyse(lo, hi);

    S.peeks++;
    try { localStorage.setItem('quantlab.bouncePeeks', String(S.peeks)); } catch (e) {}
    S.oos = r;
    S.oosRunning = false;

    if (root.JOURNAL) {
      root.JOURNAL.add({
        kind: 'bounce-oos',
        name: '낙폭 ' + Math.round(S.threshold * 100) + '%',
        is: { h: S.result.best.h, excess: S.result.best.excess },
        oos: { h: r.best.h, excess: r.best.excess },
        peek: S.peeks
      });
    }
    draw(host);
  }

  function filterLabel(f) {
    return f === 'rsi' ? 'RSI<30 동반' : (f === 'vol' ? '거래량 급증 동반' : '조건 없음');
  }

  /* ------------------------------------------------------------------------
   *  설정 패널
   * ----------------------------------------------------------------------*/
  function setupPanel(host) {
    const p = App.panel('낙폭 반등 연구실 <span class="accent">EVENT STUDY</span>',
      { sub: '많이 떨어진 종목은 정말 돌아오는가 · 돌아온다면 며칠 뒤에 파는 것이 좋은가' });

    const grid = U.el('div', 'grid g4');

    const mk = function (label, opts, cur, on, hint) {
      const f = U.el('div', 'field');
      f.appendChild(U.el('label', '', label));
      const sel = U.el('select');
      opts.forEach(function (o) {
        const op = U.el('option', '', o[1]);
        op.value = o[0];
        if (String(o[0]) === String(cur)) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { on(sel.value); });
      f.appendChild(sel);
      if (hint) f.appendChild(U.el('div', 'tiny', hint));
      return f;
    };

    grid.appendChild(mk('낙폭 기준 (6개월 고점 대비)',
      [[-0.10, '-10%'], [-0.15, '-15%'], [-0.20, '-20%'], [-0.30, '-30%'], [-0.40, '-40%']],
      S.threshold, function (v) { S.threshold = +v; }, '깊게 잡을수록 표본이 줄어듭니다'));

    grid.appendChild(mk('추가 조건',
      [['none', '없음'], ['rsi', 'RSI 30 미만'], ['vol', '거래량 급증']],
      S.filter, function (v) { S.filter = v; }, '조건을 더할수록 표본이 줄어듭니다'));

    grid.appendChild(mk('재진입 금지 기간',
      [[20, '20일'], [60, '60일'], [120, '120일']],
      S.cooldown, function (v) { S.cooldown = +v; }, '같은 하락이 여러 번 세어지는 것을 막습니다'));

    grid.appendChild(mk('분석 기간',
      [[3, '3년'], [5, '5년'], [8, '8년']],
      S.years, function (v) { S.years = +v; }, '채점 구간 1년은 제외됩니다'));

    grid.appendChild(mk('왕복 거래비용',
      [[0, '0% (비용 무시)'], [0.001, '0.1%'], [0.002, '0.2%'], [0.005, '0.5%']],
      S.cost, function (v) { S.cost = +v; }, '초과수익에서 이만큼 빼고 봅니다'));

    p.body.appendChild(grid);

    const btn = U.el('button', 'btn primary mt', S.running ? '분석 중…' : '분석 실행');
    btn.disabled = S.running;
    btn.addEventListener('click', function () { run(host); });
    p.body.appendChild(btn);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'bounceProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
    }

    return p;
  }

  /* ------------------------------------------------------------------------
   *  결과
   * ----------------------------------------------------------------------*/
  function resultPanel() {
    const R = S.result;
    const p = App.panel('보유 기간별 성적',
      { sub: R.range.start + ' ~ ' + R.range.end + ' · 신호 ' + U.comma(R.nSignals) + '건 · 채점 구간 제외' });

    const g = U.el('div', 'grid g4');
    g.appendChild(App.stat('신호 개수', U.comma(R.nSignals), '쿨다운 ' + S.cooldown + '일 적용'));
    g.appendChild(App.stat('해당 종목', R.nTickers + '개', '전체 98종목 중'));
    g.appendChild(App.stat('평균 낙폭', isFinite(R.avgDD) ? (R.avgDD * 100).toFixed(1) + '%' : '—', '신호 시점 기준'));
    g.appendChild(App.stat('최적 보유', R.best.h + '일',
      '비용 차감 초과수익 ' + (isFinite(R.best.net) ? (R.best.net * 100).toFixed(2) + '%p' : '—'),
      R.best.net > 0 ? 'up' : 'down'));
    p.body.appendChild(g);

    if (R.nSignals < 30) {
      const w = U.el('div', 'note warn');
      w.innerHTML = '<b>표본이 ' + R.nSignals + '건뿐입니다.</b> 이 정도로는 어떤 결론도 낼 수 없습니다. ' +
        '낙폭 기준을 얕게 잡거나(-10%), 추가 조건을 없애거나, 기간을 늘리세요.';
      p.body.appendChild(w);
    }

    const rows = R.rows.map(function (r) {
      const isBest = r === R.best;
      const cells = [
        (isBest ? '<b>' + r.h + '일</b>' : r.h + '일'),
        U.comma(r.n),
        isFinite(r.win) ? (r.win * 100).toFixed(1) + '%' : '—',
        isFinite(r.winBase) ? '<span class="muted">' + (r.winBase * 100).toFixed(1) + '%</span>' : '—',
        isFinite(r.mean) ? (r.mean * 100).toFixed(2) + '%' : '—',
        isFinite(r.base) ? '<span class="muted">' + (r.base * 100).toFixed(2) + '%</span>' : '—',
        '<span class="' + (r.excess > 0 ? 'up' : 'down') + '">' +
          (isFinite(r.excess) ? (r.excess > 0 ? '+' : '') + (r.excess * 100).toFixed(2) + '%p' : '—') + '</span>',
        '<span class="' + (r.net > 0 ? 'up' : 'down') + '">' +
          (isFinite(r.net) ? (r.net > 0 ? '+' : '') + (r.net * 100).toFixed(2) + '%p' : '—') + '</span>',
        isFinite(r.t) ? r.t.toFixed(2) : '—'
      ];
      return { cells: cells, __cls: isBest ? 'hl' : '' };
    });

    p.body.appendChild(App.table(
      ['보유', { label: '표본', num: true }, { label: '반등확률', num: true },
        { label: '기준선', num: true }, { label: '평균수익', num: true },
        { label: '기준선', num: true }, { label: '초과', num: true },
        { label: '비용 차감', num: true }, { label: 't값', num: true }],
      rows, { scroll: true }));

    p.body.appendChild(U.el('div', 'tiny',
      '기준선 = 같은 기간 같은 종목들을 아무 날에나 샀을 때. 초과 = 낙폭 그룹 − 기준선. ' +
      't값은 두 집단 평균 차이의 Welch 검정값입니다(|t|>2면 우연으로 보기 어렵다고들 하지만, 아래 주의를 읽으세요).'));

    // 곡선
    p.body.appendChild(U.el('div', 'tiny mt', '보유 기간별 평균 수익 — 낙폭 그룹과 기준선'));
    p.body.appendChild(C.legend([
      { name: '낙폭 후 매수', color: C.seriesColor(1) },
      { name: '아무 날이나 매수 (기준선)', color: C.mutedColor() }
    ]));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, {
      labels: R.rows.map(function (r) { return r.h + '일'; }),
      series: [
        { name: '낙폭 후 매수', values: R.rows.map(function (r) { return r.mean; }), color: C.seriesColor(1) },
        { name: '기준선', values: R.rows.map(function (r) { return r.base; }), color: C.mutedColor() }
      ],
      zeroLine: 0,
      yFmt: function (x) { return (x * 100).toFixed(1) + '%'; }
    });

    // 분포 — 평균만 보면 속습니다
    p.body.appendChild(U.el('div', 'tiny mt',
      R.best.h + '일 보유 시 수익률 분포 — 평균 하나로는 알 수 없는 것'));
    const hv = U.el('canvas', 'chart');
    p.body.appendChild(hv);
    C.hist(hv, [
      { name: '낙폭 후 매수', values: R.best.values, color: C.seriesColor(1) },
      { name: '기준선', values: R.best.baseValues, color: C.mutedColor() }
    ], { xFmt: function (x) { return (x * 100).toFixed(0) + '%'; } });
    p.body.appendChild(U.el('div', 'tiny',
      '두 분포가 거의 겹쳐 보인다면, 평균 차이가 조금 있어도 실제로는 구별하기 어려운 것입니다. ' +
      '중앙값(' + (isFinite(R.best.med) ? (R.best.med * 100).toFixed(2) + '%' : '—') +
      ')과 평균(' + (isFinite(R.best.mean) ? (R.best.mean * 100).toFixed(2) + '%' : '—') +
      ')이 많이 다르면, 소수의 큰 반등이 평균을 끌어올리고 있다는 뜻입니다.'));

    return p;
  }

  function sectorPanel() {
    const R = S.result;
    if (!R.sectors.length) return null;
    const p = App.panel('업종별로 갈라 보기',
      { sub: R.best.h + '일 보유 기준 · 표본 10건 이상인 업종만' });

    p.body.appendChild(C.legend([{ name: '평균 수익률', color: C.seriesColor(1) }]));
    const cv = U.el('canvas', 'chart');
    cv.style.height = Math.max(160, R.sectors.length * 26) + 'px';
    p.body.appendChild(cv);
    C.bars(cv, {
      items: R.sectors.map(function (x) {
        return {
          label: x.sector + ' (' + x.n + ')',
          value: x.mean,
          color: x.mean > 0 ? C.seriesColor(1) : C.seriesColor(3)
        };
      }),
      baseValue: 0,
      vFmt: function (v) { return (v * 100).toFixed(2) + '%'; }
    });

    const note = U.el('div', 'note');
    note.innerHTML =
      '업종을 갈라 보면 어딘가는 반드시 좋아 보입니다. <b>13개로 나누면 그중 하나가 우연히 좋을 확률은 아주 높습니다.</b> ' +
      '여기서 제일 좋은 업종을 골라 "이 업종의 낙폭은 잘 반등한다"고 결론 내리는 것이 ' +
      '가장 흔한 오류입니다. 표본 수(괄호 안)를 먼저 보세요. 30건 미만이면 읽지 마세요.';
    p.body.appendChild(note);
    return p;
  }

  function honestyPanel() {
    const R = S.result;
    const p = App.panel('이 결과를 믿기 전에 <span class="accent">READ THIS</span>',
      { sub: '이 화면에서 가장 중요한 패널입니다' });

    const add = function (title, html, cls) {
      const n = U.el('div', 'note' + (cls ? ' ' + cls : ''));
      n.innerHTML = '<b>' + title + '</b><br>' + html;
      p.body.appendChild(n);
    };

    add('생존 편향 — 이 화면에서 가장 큰 문제',
      '데이터에는 <b>지금 나스닥100에 남아 있는 98종목</b>만 있습니다. ' +
      '크게 떨어진 뒤 회복하지 못해 지수에서 빠지거나 상장폐지된 회사는 <b>아예 들어 있지 않습니다</b>. ' +
      '즉 우리는 "떨어졌지만 결국 살아남은 종목"만 보고 반등 확률을 재고 있습니다. ' +
      '여기 나온 반등 확률은 <b>실제보다 반드시 높습니다.</b> 얼마나 높은지는 이 데이터로 알 수 없습니다.', 'warn');

    add('표본이 서로 독립이 아닙니다',
      '시장 전체가 빠지는 날에는 수십 종목이 동시에 신호를 냅니다. ' +
      '그 표본들은 사실상 <b>하나의 사건</b>인데 통계는 여러 개로 셉니다. ' +
      '그래서 위 표의 t값은 <b>실제보다 크게 나옵니다</b>. |t|가 2를 넘었다고 바로 유의하다고 하면 안 됩니다.', 'warn');

    add('여러 번 바꿔 보면 반드시 좋은 조합이 나옵니다',
      '낙폭 기준 5가지 × 추가 조건 3가지 × 쿨다운 3가지 = <b>45가지</b>입니다. ' +
      '45번 돌려 제일 좋은 것을 고르면, 아무 신호가 없는 데이터에서도 그럴듯한 결과가 나옵니다. ' +
      '연구 노트에 시도 횟수가 남습니다. <b>발표할 때 몇 번째 조합인지 함께 밝히세요.</b>');

    add('"최적 보유 기간"은 예측이 아니라 과거 평균입니다',
      '위에서 ' + R.best.h + '일이 가장 좋게 나왔다고 해서 <b>다음에도 ' + R.best.h + '일이 최적이라는 뜻이 아닙니다.</b> ' +
      '보유 기간 7가지 중 가장 좋은 것을 고른 것이므로, 그 자체가 이미 한 번의 선택입니다. ' +
      '아래 채점 구간에서 같은 기간이 다시 최적으로 나오는지 확인해 보세요.');

    add('체결 가정',
      '신호는 그날 <b>종가</b>까지의 정보로 판단하고, 매수·매도도 종가로 가정했습니다. ' +
      '실제로는 그 가격에 살 수 없습니다. 거래비용은 위 설정에서 ' +
      (S.cost * 100).toFixed(1) + '%를 왕복으로 뺐습니다. 슬리피지와 세금은 들어 있지 않습니다.');

    return p;
  }

  function oosPanel(host) {
    const R = S.result;
    const p = App.panel('채점 구간에서 확인 <span class="accent">OUT-OF-SAMPLE</span>',
      { sub: '개발 구간에서 찾은 규칙이 처음 보는 1년에서도 통하는가' });

    if (!S.oos) {
      const w = U.el('div', 'note warn');
      w.innerHTML =
        '여기를 누르면 <b>그동안 잠겨 있던 최근 12개월</b>에서 같은 조건으로 다시 셉니다.<br><br>' +
        '<b>주의.</b> 채점 구간을 여러 번 보면 그 구간도 결국 개발 구간이 됩니다. ' +
        '조건을 바꿔가며 여기서 잘 나올 때까지 돌리는 순간 이 구조는 무너집니다. ' +
        (S.peeks ? '지금까지 <b>' + S.peeks + '번</b> 봤습니다.' : '아직 한 번도 보지 않았습니다.');
      p.body.appendChild(w);

      const btn = U.el('button', 'btn' + (S.peeks >= 3 ? '' : ' primary'),
        S.oosRunning ? '확인 중…' : '채점 구간에서 돌리기');
      btn.disabled = S.oosRunning;
      btn.addEventListener('click', function () { runOOS(host); });
      p.body.appendChild(btn);
      return p;
    }

    const O = S.oos;
    const isRow = R.rows.find(function (r) { return r.h === R.best.h; });
    const osRow = O.rows.find(function (r) { return r.h === R.best.h; });

    p.body.appendChild(U.el('div', 'tiny',
      O.range.start + ' ~ ' + O.range.end + ' · 신호 ' + U.comma(O.nSignals) + '건 · ' + S.peeks + '번째 확인'));

    p.body.appendChild(App.table(
      ['항목 (보유 ' + R.best.h + '일 고정)', { label: '개발 구간', num: true },
        { label: '채점 구간', num: true }, { label: '차이', num: true }],
      [
        ['반등확률',
          isFinite(isRow.win) ? (isRow.win * 100).toFixed(1) + '%' : '—',
          isFinite(osRow && osRow.win) ? (osRow.win * 100).toFixed(1) + '%' : '—',
          (isRow && osRow && isFinite(isRow.win) && isFinite(osRow.win))
            ? ((osRow.win - isRow.win) * 100).toFixed(1) + '%p' : '—'],
        ['기준선 대비 초과',
          isFinite(isRow.excess) ? (isRow.excess * 100).toFixed(2) + '%p' : '—',
          isFinite(osRow && osRow.excess) ? (osRow.excess * 100).toFixed(2) + '%p' : '—',
          (isRow && osRow && isFinite(isRow.excess) && isFinite(osRow.excess))
            ? ((osRow.excess - isRow.excess) * 100).toFixed(2) + '%p' : '—'],
        ['표본 수', U.comma(isRow.n), osRow ? U.comma(osRow.n) : '—', '']
      ]));

    const held = osRow && isFinite(osRow.excess) && osRow.excess > 0;
    const n = U.el('div', 'note ' + (held ? 'ok' : 'warn'));
    n.innerHTML = held
      ? '채점 구간에서도 초과수익이 양수로 남았습니다. 다만 표본이 ' + (osRow ? osRow.n : 0) + '건뿐이고 ' +
        '1년치라 우연일 수 있습니다. <b>양수라는 것과 통한다는 것은 다릅니다.</b>'
      : '<b>채점 구간에서는 초과수익이 사라졌습니다.</b> 개발 구간에서 보인 것은 그 기간에만 맞는 규칙이었을 가능성이 큽니다. ' +
        '여기서 하지 말아야 할 것 — 조건을 바꿔 다시 돌리는 것. 그러면 채점 구간이 개발 구간이 됩니다.';
    p.body.appendChild(n);

    const alsoBest = O.best.h;
    p.body.appendChild(U.el('div', 'tiny',
      '참고 — 채점 구간에서 가장 좋았던 보유 기간은 ' + alsoBest + '일입니다. ' +
      (alsoBest === R.best.h
        ? '개발 구간과 같습니다. 이건 의미 있는 신호입니다.'
        : '개발 구간의 ' + R.best.h + '일과 다릅니다. "최적 보유 기간"이 구간마다 달라진다는 뜻입니다.')));

    return p;
  }

  function introPanel() {
    const p = App.panel('무엇을 하는 화면인가');
    const d = U.el('div');
    d.innerHTML =
      '<p>"많이 떨어진 종목을 사면 반등하지 않을까?" — 누구나 한 번은 하는 생각입니다. ' +
      '이 화면은 그 생각을 <b>실제 데이터로 검증</b>합니다.</p>' +
      '<p>방법은 이렇습니다. 6개월 고점 대비 일정 비율 이상 떨어진 시점을 모두 찾고, ' +
      '그 시점에 샀다면 1·3·5·10·20·40·60일 뒤에 각각 얼마가 되었는지를 셉니다. ' +
      '학계에서 <b>이벤트 스터디</b>라고 부르는 방식입니다.</p>' +
      '<p><b>여기서 가장 중요한 것.</b> 반등 확률 62%라는 숫자 하나는 아무 의미가 없습니다. ' +
      '아무 날이나 샀어도 58%였다면 낙폭이 보탠 것은 4%p뿐이고, 그건 거래비용에 묻힙니다. ' +
      '그래서 이 화면은 모든 숫자 옆에 <b>기준선</b>을 나란히 놓습니다. ' +
      '보셔야 할 것은 확률이 아니라 <b>기준선과의 차이</b>입니다.</p>' +
      '<p>그리고 이 화면에는 <b>생존 편향</b>이라는 큰 함정이 있습니다. ' +
      '떨어진 뒤 돌아오지 못한 회사는 데이터에서 이미 사라졌습니다. ' +
      '분석을 돌리면 그 이야기를 다시 자세히 적어 두겠습니다.</p>';
    p.body.appendChild(d);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  그리기
   * ----------------------------------------------------------------------*/
  function draw(host) {
    host.innerHTML = '';
    host.appendChild(setupPanel(host));

    if (S.result) {
      host.appendChild(resultPanel());
      const sp = sectorPanel();
      if (sp) host.appendChild(sp);
      host.appendChild(honestyPanel());
      host.appendChild(oosPanel(host));
    } else if (!S.running) {
      host.appendChild(introPanel());
    }
  }

  App.register('bounce', { render: draw });
})(window.QL = window.QL || {});
