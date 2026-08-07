/* ============================================================================
 *  factor.js — 팩터 분석실
 *
 *  퀀트 리서처가 전략을 만들기 **전에** 하는 일이 이것입니다.
 *  "이 지표가 정말로 미래 수익률과 관련이 있는가?"를 먼저 확인합니다.
 *  여기서 통과하지 못한 팩터로 전략을 만들면 시간 낭비입니다.
 *
 *  보는 것
 *    IC (Information Coefficient)
 *      날마다 '팩터 순위'와 '실제 미래 수익률 순위'가 얼마나 같은 방향인지.
 *      상관계수라서 -1 ~ +1 사이입니다.
 *        0.02 ~ 0.05  실무에서 쓸 만한 신호 (방향 정확도 51~53% 수준)
 *        0.05 ~ 0.10  아주 좋은 신호
 *        0.30 이상    정상적인 시장 데이터에서는 나오지 않습니다. 누수를 의심하세요.
 *    ICIR = IC 평균 / IC 표준편차 — 꾸준한지를 봅니다.
 *    t값 — 그 IC가 우연이 아닐 가능성. |t| > 2 면 우연으로 보기 어렵습니다.
 *    분위 수익 — 팩터로 5등분했을 때 상위 그룹과 하위 그룹의 실제 수익 차이.
 *    팩터 상관 — 팩터끼리 얼마나 닮았는지. 닮은 팩터를 여러 개 섞는 건 의미가 없습니다.
 *
 *  ★ WorldQuant IQC에서 말하는 '알파'가 바로 이 팩터입니다.
 *    대회는 알파를 만들고 그 IC와 안정성으로 평가합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, STRAT = root.STRAT;

  const S = { horizon: 21, years: 5, results: null, running: false, selected: 0 };

  // 두 배열의 상관계수
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
    idx.forEach(function (orig, k) { r[orig] = 2 * k / (arr.length - 1) - 1; });
    return r;
  }

  async function analyse(host) {
    S.running = true;
    draw(host);

    const F = STRAT.aiFeatures;
    const n = DATA.state.dates.length;
    const hi = n - 1 - S.horizon;
    const lo = Math.max(300, hi - S.years * 252);
    const step = 5;                          // 5일 간격으로 표본 추출

    const nf = F.length;
    const icSeries = [];                     // [팩터][날짜]
    for (let j = 0; j < nf; j++) icSeries.push([]);
    const icDates = [];
    const quint = [];                        // [팩터][5분위] 누적 수익
    for (let j = 0; j < nf; j++) quint.push([0, 0, 0, 0, 0]);
    const quintN = new Array(nf).fill(0);
    // 팩터 간 상관 (같은 날 종목별 팩터값끼리)
    const pairSum = [], pairN = [];
    for (let j = 0; j < nf; j++) { pairSum.push(new Array(nf).fill(0)); pairN.push(new Array(nf).fill(0)); }

    let done = 0;
    const total = Math.floor((hi - lo) / step);

    for (let i = lo; i < hi; i += step) {
      const Fi = STRAT.featuresAt(i);
      const tk = Fi.tickers;
      if (tk.length < 20) continue;

      // 미래 수익률
      const fwd = [], keep = [];
      tk.forEach(function (t, k) {
        const s = DATA.series(t);
        const a = s[i], b = s[i + S.horizon];
        if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) return;
        fwd.push(b / a - 1);
        keep.push(k);
      });
      if (fwd.length < 20) continue;

      // 시장(그날 평균)을 빼서 '상대 성과'만 남깁니다
      const mean = fwd.reduce(function (x, y) { return x + y; }, 0) / fwd.length;
      const excess = fwd.map(function (v) { return v - mean; });
      const fwdRank = rankOf(excess);

      icDates.push(DATA.state.dates[i]);
      const colsToday = [];
      for (let j = 0; j < nf; j++) {
        const col = keep.map(function (k) { return Fi.X[k][j]; });
        colsToday.push(col);
        icSeries[j].push(corr(col, fwdRank));

        // 분위별 실제 수익
        const order = col.map(function (v, k) { return k; })
          .sort(function (x, y) { return col[x] - col[y]; });
        const per = Math.floor(order.length / 5);
        if (per >= 2) {
          for (let q = 0; q < 5; q++) {
            let sum = 0;
            for (let k = q * per; k < (q + 1) * per; k++) sum += excess[order[k]];
            quint[j][q] += sum / per;
          }
          quintN[j]++;
        }
      }
      // 팩터 상관
      for (let a = 0; a < nf; a++) {
        for (let b2 = a + 1; b2 < nf; b2++) {
          const c = corr(colsToday[a], colsToday[b2]);
          if (isFinite(c)) { pairSum[a][b2] += c; pairN[a][b2]++; }
        }
      }

      done++;
      if (done % 20 === 0) {
        const el = U.$('#facProg');
        if (el) el.style.width = Math.round((done / total) * 100) + '%';
        await U.yield_();
      }
    }

    const stats = F.map(function (f, j) {
      const v = icSeries[j].filter(function (x) { return isFinite(x); });
      const m = v.reduce(function (a, b) { return a + b; }, 0) / (v.length || 1);
      let sd = 0;
      v.forEach(function (x) { sd += (x - m) * (x - m); });
      sd = Math.sqrt(sd / Math.max(1, v.length - 1));
      return {
        key: f.key, name: f.name,
        ic: m, icStd: sd,
        icir: sd > 0 ? m / sd : NaN,
        t: sd > 0 ? m / (sd / Math.sqrt(v.length)) : NaN,
        posRate: v.filter(function (x) { return x > 0; }).length / (v.length || 1),
        n: v.length,
        series: icSeries[j],
        quint: quint[j].map(function (x) { return quintN[j] ? x / quintN[j] : NaN; }),
        spread: quintN[j] ? (quint[j][4] - quint[j][0]) / quintN[j] : NaN
      };
    });

    const cm = [];
    for (let a = 0; a < nf; a++) {
      cm.push([]);
      for (let b2 = 0; b2 < nf; b2++) {
        if (a === b2) cm[a].push(1);
        else {
          const x = a < b2 ? pairSum[a][b2] / (pairN[a][b2] || 1) : pairSum[b2][a] / (pairN[b2][a] || 1);
          cm[a].push(x);
        }
      }
    }

    S.results = { stats: stats, dates: icDates, corr: cm, lo: lo, hi: hi };
    S.running = false;
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  화면
   * ----------------------------------------------------------------------*/
  function setupPanel(host) {
    const p = App.panel('팩터 분석 <span class="accent">ALPHA RESEARCH</span>',
      { sub: '전략을 만들기 전에 "이 지표가 정말 통하는가"를 먼저 확인합니다' });

    const row = U.el('div', 'row');
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
    row.appendChild(mk('예측 시계', [[5, '5일 뒤'], [21, '1개월 뒤'], [63, '3개월 뒤']],
      S.horizon, function (v) { S.horizon = +v; S.results = null; }));
    row.appendChild(mk('분석 기간', [[3, '3년'], [5, '5년'], [8, '8년']],
      S.years, function (v) { S.years = +v; S.results = null; }));
    const btn = U.el('button', 'btn primary', S.running ? '분석 중…' : '팩터 분석 실행');
    btn.disabled = S.running;
    btn.addEventListener('click', function () { analyse(host); });
    row.appendChild(btn);
    p.body.appendChild(row);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'facProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
    }

    p.body.appendChild(U.el('div', 'note',
      'IC는 "팩터 순위와 실제 미래 수익 순위가 얼마나 같은 방향인가"입니다. ' +
      '0.02~0.05면 실무에서 쓸 만하고, 0.3을 넘으면 정상적인 시장에서는 나올 수 없는 값이라 ' +
      '데이터 누수를 의심해야 합니다. WorldQuant IQC에서 말하는 알파가 바로 이 팩터입니다.'));
    return p;
  }

  function tablePanel(host) {
    const R = S.results;
    const p = App.panel('팩터 성적표', { sub: 'IC 절대값이 클수록 신호가 강합니다 (부호는 방향)', tight: true });
    const rows = R.stats.slice().sort(function (a, b) { return Math.abs(b.ic) - Math.abs(a.ic); }).map(function (f, i) {
      const strong = Math.abs(f.ic) >= 0.02 && Math.abs(f.t) > 2;
      const name = U.el('span');
      name.innerHTML = (strong ? '<span class="up">●</span> ' : '<span class="flat">○</span> ') + U.escape(f.name);
      const idx = R.stats.indexOf(f);
      return {
        __cls: S.selected === idx ? 'sel' : '',
        __click: function () { S.selected = idx; draw(host); },
        cells: [
          name,
          U.el('span', f.ic > 0 ? 'up' : 'down', f.ic.toFixed(4)),
          f.icStd.toFixed(4),
          isFinite(f.icir) ? f.icir.toFixed(3) : '—',
          U.el('span', Math.abs(f.t) > 2 ? 'up' : 'flat', isFinite(f.t) ? f.t.toFixed(2) : '—'),
          (f.posRate * 100).toFixed(0) + '%',
          U.el('span', f.spread > 0 ? 'up' : 'down', (f.spread * 100).toFixed(2) + '%')
        ]
      };
    });
    p.body.appendChild(App.table(
      ['팩터', { label: 'IC 평균', num: true }, { label: 'IC 표준편차', num: true },
       { label: 'ICIR', num: true }, { label: 't값', num: true },
       { label: 'IC>0 비율', num: true }, { label: '상-하위 분위차', num: true }], rows));
    const note = U.el('div', 'note');
    note.style.margin = '10px 12px';
    note.innerHTML = '● 표시는 <b>IC 0.02 이상이면서 |t| &gt; 2</b> 인 팩터입니다. ' +
      'IC 부호가 음수여도 괜찮습니다 — 반대로 쓰면 되니까요(예: 변동성은 낮을수록 좋다). ' +
      '행을 누르면 아래에서 자세히 볼 수 있습니다.';
    p.body.appendChild(note);
    return p;
  }

  function detailPanel() {
    const R = S.results;
    const f = R.stats[S.selected] || R.stats[0];
    const p = App.panel('팩터 상세 <span class="accent">' + U.escape(f.name) + '</span>',
      { sub: 'IC 흐름과 분위별 실제 수익' });

    const g = U.el('div', 'grid g4');
    g.appendChild(App.stat('IC 평균', f.ic.toFixed(4),
      Math.abs(f.ic) >= 0.02 ? '쓸 만한 수준' : '아주 약함', f.ic > 0 ? 'up' : 'down'));
    g.appendChild(App.stat('ICIR', isFinite(f.icir) ? f.icir.toFixed(3) : '—', '꾸준함'));
    g.appendChild(App.stat('t값', isFinite(f.t) ? f.t.toFixed(2) : '—',
      Math.abs(f.t) > 2 ? '우연으로 보기 어려움' : '우연일 수 있음'));
    g.appendChild(App.stat('상-하위 분위차', (f.spread * 100).toFixed(2) + '%',
      S.horizon + '일 기준', f.spread > 0 ? 'up' : 'down'));
    p.body.appendChild(g);

    // IC 흐름 (이동평균)
    const W = Math.max(3, Math.round(f.series.length / 25));
    const roll = [];
    let sum = 0, cnt = 0;
    for (let i = 0; i < f.series.length; i++) {
      const v = f.series[i];
      if (isFinite(v)) { sum += v; cnt++; }
      if (i >= W) { const old = f.series[i - W]; if (isFinite(old)) { sum -= old; cnt--; } }
      roll.push(cnt > 0 ? sum / cnt : null);
    }
    p.body.appendChild(U.el('div', 'tiny mt', 'IC 흐름 (' + W + '개 이동평균) — 0선 위아래를 오가면 신호가 불안정한 것입니다'));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, {
      labels: R.dates.map(function (d) { return d.slice(2, 7); }),
      series: [{ name: 'IC', values: roll, color: C.seriesColor(0), area: true }],
      zeroLine: 0, yFmt: function (v) { return v.toFixed(3); }
    });

    // 분위별 수익
    p.body.appendChild(U.el('div', 'tiny mt', '분위별 평균 초과수익 (1분위 = 팩터값 낮음, 5분위 = 높음)'));
    const cv2 = U.el('canvas', 'chart sm');
    p.body.appendChild(cv2);
    C.bars(cv2, {
      items: f.quint.map(function (v, i) {
        return { label: (i + 1) + '분위', value: v || 0, color: (v || 0) >= 0 ? C.seriesColor(2) : C.seriesColor(7) };
      }),
      baseValue: 0, padL: 70,
      vFmt: function (v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; }
    });
    p.body.appendChild(U.el('div', 'note',
      '왼쪽에서 오른쪽으로 계단처럼 올라가면(또는 내려가면) 좋은 팩터입니다. ' +
      '들쭉날쭉하면 상위 몇 종목에서만 우연히 맞은 것일 수 있습니다.'));
    return p;
  }

  function corrPanel() {
    const R = S.results;
    const p = App.panel('팩터 상관관계', { sub: '닮은 팩터를 여러 개 섞는 것은 의미가 없습니다', tight: true });
    const names = R.stats.map(function (f) { return f.name; });
    const short = names.map(function (n) { return n.length > 9 ? n.slice(0, 8) + '…' : n; });

    const headers = [''].concat(short.map(function (n) { return { label: n, num: true }; }));
    const rows = R.corr.map(function (row, i) {
      const cells = [U.el('span', 'tiny', short[i])];
      row.forEach(function (v, j) {
        const s = U.el('span');
        s.textContent = isFinite(v) ? v.toFixed(2) : '—';
        if (i === j) s.className = 'flat';
        else if (Math.abs(v) > 0.7) s.className = 'down';       // 너무 닮음
        else if (Math.abs(v) < 0.3) s.className = 'up';         // 서로 다른 정보
        cells.push(s);
      });
      return { cells: cells };
    });
    p.body.appendChild(App.table(headers, rows, { scroll: true }));
    const note = U.el('div', 'note');
    note.style.margin = '10px 12px';
    note.innerHTML = '<span class="up">초록</span> = 상관 0.3 미만 (서로 다른 정보를 담고 있어 함께 쓰면 좋음)<br>' +
      '<span class="down">빨강</span> = 상관 0.7 초과 (거의 같은 팩터. 둘 다 넣어도 분산 효과가 없음)<br>' +
      '멀티팩터 전략을 만들 때는 <b>상관이 낮은 팩터끼리</b> 조합해야 합니다. ' +
      '이것이 실무에서 팩터를 고르는 첫 번째 기준입니다.';
    p.body.appendChild(note);
    return p;
  }

  function readingPanel() {
    const R = S.results;
    const strong = R.stats.filter(function (f) { return Math.abs(f.ic) >= 0.02 && Math.abs(f.t) > 2; });
    const best = R.stats.slice().sort(function (a, b) { return Math.abs(b.ic) - Math.abs(a.ic); })[0];
    const p = App.panel('이 결과는 이렇게 읽습니다');
    p.body.innerHTML =
      '<div class="note ' + (strong.length ? 'ok' : 'warn') + '">' +
      (strong.length
        ? '통계적으로 의미 있는 팩터가 <b>' + strong.length + '개</b> 있습니다: ' +
          strong.map(function (f) { return U.escape(f.name) + '(IC ' + f.ic.toFixed(3) + ')'; }).join(', ') + '. '
        : '<b>|t| &gt; 2 를 넘는 팩터가 없습니다.</b> 이 기간·이 예측 시계에서는 어떤 팩터도 우연 이상이라고 말하기 어렵습니다. ') +
      '가장 강한 팩터는 <b>' + U.escape(best.name) + '</b> (IC ' + best.ic.toFixed(4) + ', t ' +
      (isFinite(best.t) ? best.t.toFixed(2) : '—') + ')입니다.' +
      '</div>' +
      '<p class="small">다음에 할 것:<br>' +
      '· 예측 시계를 바꿔 보세요. 5일에서 안 통하던 팩터가 3개월에서 통하기도 합니다.<br>' +
      '· 상관이 낮은 팩터끼리 묶어 <b>전략 실험실</b>의 멀티팩터와 비교해 보세요.<br>' +
      '· IC가 높아도 <b>회전율이 높으면 비용에 먹힙니다.</b> 전략 실험실의 손익분기 비용을 함께 보세요.<br>' +
      '· IC 흐름이 0선을 자주 넘나든다면, 평균은 양수여도 실제로 운용하기 어렵습니다.</p>';
    return p;
  }

  function introPanel() {
    const p = App.panel('팩터란');
    p.body.innerHTML =
      '<p class="small">팩터(=알파, =시그널)는 <b>종목을 줄 세우는 하나의 기준</b>입니다. ' +
      '"최근 1년 많이 오른 종목", "덜 출렁이는 종목" 같은 것들이죠. ' +
      '퀀트는 전략을 만들기 전에 이 팩터가 <b>미래 수익률과 실제로 관련이 있는지</b>부터 확인합니다.</p>' +
      '<p class="small">이 화면은 그 검증 과정을 그대로 보여 줍니다. ' +
      '팩터 ' + STRAT.aiFeatures.length + '개에 대해 날짜마다 IC를 계산하고, 분위별 수익과 팩터 간 상관까지 함께 봅니다. ' +
      'AI 전략들이 학습에 쓰는 팩터와 정확히 같은 것들입니다.</p>' +
      '<ul class="small" style="padding-left:18px;line-height:1.8">' +
      STRAT.aiFeatures.map(function (f) { return '<li>' + U.escape(f.name) + '</li>'; }).join('') +
      '</ul>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(setupPanel(host));
    if (S.results) {
      host.appendChild(tablePanel(host));
      host.appendChild(detailPanel());
      host.appendChild(corrPanel());
      host.appendChild(readingPanel());
    } else if (!S.running) {
      host.appendChild(introPanel());
    }
  }

  App.register('factor', { render: draw });
})(window.QL = window.QL || {});
