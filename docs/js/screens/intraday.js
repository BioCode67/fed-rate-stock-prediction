/* ============================================================================
 *  intraday.js — 장중 화면 (30분봉)
 *
 *  일봉만 보면 보이지 않는 것들이 있습니다.
 *
 *   1. 하루 안에서도 변동성이 균일하지 않습니다.
 *      개장 직후와 마감 직전에 크게 흔들리고 점심 무렵에 잠잠해집니다(U자 패턴).
 *      이건 우연이 아니라 전 세계 주식시장에서 반복 관찰되는 현상입니다.
 *   2. 밤사이 갭이 생깁니다.
 *      실적 발표·뉴스가 장 마감 후에 나오기 때문에, 어제 종가와 오늘 시가 사이에
 *      건너뛴 구간이 생깁니다. "종가에 산다"는 가정으로는 이 구간을 잡을 수 없습니다.
 *   3. 그래서 슬리피지가 생깁니다.
 *      백테스트는 종가에 원하는 만큼 체결된다고 가정하지만, 실제로는 그 가격에
 *      원하는 수량을 다 살 수 없습니다.
 *
 *  이 화면은 "우리 백테스트의 가정이 어디까지 현실적인가"를 확인하는 곳입니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App;

  const S = { data: null, ticker: null, days: 10, loading: false, error: null };

  function load(host) {
    if (S.data || S.loading) return;
    S.loading = true;
    fetch((DATA.dev ? 'data-dev/' : 'data/') + 'intraday.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('분봉 파일이 없습니다 (HTTP ' + r.status + ')');
        return r.json();
      })
      .then(function (j) {
        S.data = j;
        S.loading = false;
        const keys = Object.keys(j.series || {});
        S.ticker = keys.indexOf('AAPL') >= 0 ? 'AAPL' : keys[0];
        draw(host);
      })
      .catch(function (e) {
        S.error = e.message;
        S.loading = false;
        draw(host);
      });
  }

  /* ------------------------------------------------------------------------
   *  계산
   * ----------------------------------------------------------------------*/
  // 시간대별 평균 |수익률| — U자 패턴이 보이는지
  function byTimeOfDay(series) {
    const buckets = {};
    for (let i = 1; i < series.times.length; i++) {
      const a = series.close[i - 1], b = series.close[i];
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) continue;
      // 날짜가 바뀌는 지점은 건너뜁니다(그건 갭이지 장중 변동이 아닙니다)
      if (series.times[i].slice(0, 10) !== series.times[i - 1].slice(0, 10)) continue;
      const hm = series.times[i].slice(11, 16);
      (buckets[hm] = buckets[hm] || []).push(Math.abs(b / a - 1));
    }
    return Object.keys(buckets).sort().map(function (hm) {
      const v = buckets[hm];
      return { time: hm, avg: v.reduce(function (x, y) { return x + y; }, 0) / v.length, n: v.length };
    });
  }

  // 밤사이 갭: 어제 마지막 봉 → 오늘 첫 봉
  function overnightGaps(series) {
    const gaps = [];
    for (let i = 1; i < series.times.length; i++) {
      if (series.times[i].slice(0, 10) === series.times[i - 1].slice(0, 10)) continue;
      const a = series.close[i - 1], b = series.close[i];
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) continue;
      gaps.push({ date: series.times[i].slice(0, 10), gap: b / a - 1 });
    }
    return gaps;
  }

  // 장중 수익률(첫 봉 → 마지막 봉)과 밤사이 수익률을 나눠서 비교
  function splitReturns(series) {
    const days = {};
    series.times.forEach(function (t, i) {
      const d = t.slice(0, 10);
      const v = series.close[i];
      if (v === null || !isFinite(v)) return;
      if (!days[d]) days[d] = { first: v, last: v };
      else days[d].last = v;
    });
    const keys = Object.keys(days).sort();
    let intraday = 1, overnight = 1;
    const iCurve = [], oCurve = [], labels = [];
    for (let k = 0; k < keys.length; k++) {
      const d = days[keys[k]];
      intraday *= d.last / d.first;
      if (k > 0) overnight *= d.first / days[keys[k - 1]].last;
      iCurve.push(intraday);
      oCurve.push(overnight);
      labels.push(keys[k].slice(5));
    }
    return { labels: labels, intraday: iCurve, overnight: oCurve };
  }

  /* ------------------------------------------------------------------------
   *  화면
   * ----------------------------------------------------------------------*/
  function pickerPanel(host) {
    const p = App.panel('장중 <span class="accent">INTRADAY</span>',
      { sub: (S.data ? S.data.interval : '30m') + '봉 · 최근 60일 · 미국 동부시간' });
    const row = U.el('div', 'row');

    const f = U.el('div', 'field');
    f.appendChild(U.el('label', '', '종목'));
    const sel = U.el('select');
    Object.keys(S.data.series).sort().forEach(function (t) {
      const o = U.el('option', '', t); o.value = t;
      if (t === S.ticker) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { S.ticker = sel.value; draw(host); });
    f.appendChild(sel); row.appendChild(f);

    const f2 = U.el('div', 'field');
    f2.appendChild(U.el('label', '', '표시 기간'));
    const sel2 = U.el('select');
    [[5, '최근 5일'], [10, '최근 10일'], [30, '최근 30일'], [60, '전체 60일']].forEach(function (o) {
      const e = U.el('option', '', o[1]); e.value = String(o[0]);
      if (o[0] === S.days) e.selected = true;
      sel2.appendChild(e);
    });
    sel2.addEventListener('change', function () { S.days = +sel2.value; draw(host); });
    f2.appendChild(sel2); row.appendChild(f2);
    p.body.appendChild(row);
    return p;
  }

  function chartPanel() {
    const s = S.data.series[S.ticker];
    const p = App.panel(U.escape(S.ticker) + ' 장중 흐름', { sub: '30분봉' });
    const bars = S.days * 13;
    const from = Math.max(0, s.times.length - bars);
    const cv = U.el('canvas', 'chart lg');
    p.body.appendChild(cv);
    C.line(cv, {
      labels: s.times.slice(from).map(function (t) { return t.slice(5, 10) + ' ' + t.slice(11, 16); }),
      series: [{ name: S.ticker, values: s.close.slice(from), color: C.seriesColor(0), area: true }],
      yFmt: function (v) { return v.toFixed(0); },
      tipFmt: function (v) { return '$' + v.toFixed(2); }
    });
    p.body.appendChild(U.el('div', 'note',
      '봉과 봉 사이가 뚝 끊긴 곳이 밤사이입니다. 그 구간에는 거래가 없지만 가격은 움직입니다.'));
    return p;
  }

  function shapePanel() {
    const s = S.data.series[S.ticker];
    const tod = byTimeOfDay(s);
    const p = App.panel('시간대별 변동성', { sub: '30분 구간마다 평균 |수익률|' });
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.bars(cv, {
      items: tod.map(function (t) {
        return { label: t.time, value: t.avg, color: C.seriesColor(1) };
      }),
      xMin: 0, padL: 60,
      vFmt: function (v) { return (v * 100).toFixed(3) + '%' ; }
    });
    const first = tod[0], mid = tod[Math.floor(tod.length / 2)], last = tod[tod.length - 1];
    if (first && mid && last) {
      const note = U.el('div', 'note');
      const ratio = mid.avg > 0 ? (first.avg / mid.avg) : NaN;
      note.innerHTML = '개장 직후(' + first.time + ') 평균 변동 <b>' + (first.avg * 100).toFixed(3) + '%</b>, ' +
        '점심 무렵(' + mid.time + ') <b>' + (mid.avg * 100).toFixed(3) + '%</b>, ' +
        '마감 직전(' + last.time + ') <b>' + (last.avg * 100).toFixed(3) + '%</b>.<br>' +
        (isFinite(ratio) && ratio > 1.3
          ? '개장 직후가 점심보다 <b>' + ratio.toFixed(1) + '배</b> 더 출렁입니다. 전 세계 시장에서 반복 관찰되는 U자 패턴입니다. ' +
            '밤사이 쌓인 정보가 개장과 함께 한꺼번에 반영되기 때문입니다.'
          : '이 종목·이 기간에는 U자 패턴이 뚜렷하지 않습니다. 다른 종목도 확인해 보세요.');
      p.body.appendChild(note);
    }
    return p;
  }

  function gapPanel() {
    const s = S.data.series[S.ticker];
    const gaps = overnightGaps(s);
    const p = App.panel('밤사이 갭', { sub: '어제 마지막 봉 → 오늘 첫 봉' });
    if (!gaps.length) {
      p.body.appendChild(U.el('div', 'empty', '갭을 계산할 데이터가 부족합니다.'));
      return p;
    }
    const abs = gaps.map(function (g) { return Math.abs(g.gap); });
    const mean = abs.reduce(function (a, b) { return a + b; }, 0) / abs.length;
    const big = gaps.filter(function (g) { return Math.abs(g.gap) > 0.02; });
    const biggest = gaps.slice().sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); })[0];

    const g = U.el('div', 'grid g4');
    g.appendChild(App.stat('평균 갭 크기', (mean * 100).toFixed(2) + '%', gaps.length + '일 기준'));
    g.appendChild(App.stat('2% 넘는 갭', big.length + '회', (big.length / gaps.length * 100).toFixed(0) + '% 의 날'));
    g.appendChild(App.stat('가장 큰 갭', (biggest.gap * 100).toFixed(2) + '%', biggest.date,
      biggest.gap >= 0 ? 'up' : 'down'));
    const cv = U.el('canvas', 'chart sm');
    p.body.appendChild(g);
    p.body.appendChild(U.el('div', 'tiny mt', '날짜별 밤사이 갭'));
    p.body.appendChild(cv);
    C.line(cv, {
      labels: gaps.map(function (x) { return x.date.slice(5); }),
      series: [{ name: '갭', values: gaps.map(function (x) { return x.gap; }), color: C.seriesColor(3) }],
      zeroLine: 0, yFmt: function (v) { return (v * 100).toFixed(1) + '%'; }
    });
    p.body.appendChild(U.el('div', 'note',
      '갭은 거래할 수 없는 구간입니다. 어제 종가에 사서 오늘 시가에 팔려고 해도 그 사이 가격은 이미 움직여 있습니다. ' +
      '백테스트가 "종가에 체결된다"고 가정하는 한, 이 부분은 잡을 수도 피할 수도 없습니다.'));
    return p;
  }

  function splitPanel() {
    const s = S.data.series[S.ticker];
    const sp = splitReturns(s);
    const p = App.panel('장중 수익 vs 밤사이 수익',
      { sub: '같은 기간 수익을 "장이 열려 있을 때"와 "닫혀 있을 때"로 나눠 봅니다' });
    const series = [
      { name: '장중 (시가→종가 누적)', values: sp.intraday, color: C.seriesColor(0) },
      { name: '밤사이 (종가→다음 시가 누적)', values: sp.overnight, color: C.seriesColor(1) }
    ];
    const lg = U.el('div', 'legend');
    series.forEach(function (x) {
      const it = U.el('span', 'legend-item');
      const d = U.el('span', 'legend-dot'); d.style.background = x.color;
      it.appendChild(d); it.appendChild(U.el('span', '', x.name));
      lg.appendChild(it);
    });
    p.body.appendChild(lg);
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, { labels: sp.labels, series: series, zeroLine: 1, yFmt: function (v) { return v.toFixed(3) + '배'; } });

    const iEnd = sp.intraday[sp.intraday.length - 1] - 1;
    const oEnd = sp.overnight[sp.overnight.length - 1] - 1;
    // 설명은 화면에 나온 숫자를 그대로 따라갑니다(일반론을 먼저 말하지 않습니다).
    const note = U.el('div', 'note');
    const winner = iEnd > oEnd ? '장중' : '밤사이';
    note.innerHTML =
      '이 기간 <b>' + U.escape(S.ticker) + '</b>의 수익은 장중 <b>' + (iEnd >= 0 ? '+' : '') + (iEnd * 100).toFixed(1) + '%</b>, ' +
      '밤사이 <b>' + (oEnd >= 0 ? '+' : '') + (oEnd * 100).toFixed(1) + '%</b> 로 나뉩니다. ' +
      '이 표본에서는 <b>' + winner + '</b> 쪽이 더 컸습니다.<br>' +
      '미국 주식 전체로는 "수익의 상당 부분이 밤사이(장외)에 생긴다"는 연구가 알려져 있지만, ' +
      '종목과 기간에 따라 이렇게 반대로 나오기도 합니다. ' +
      '<b>알려진 현상이라도 내 데이터에서 확인하기 전에는 사실로 쓰면 안 된다</b>는 것을 보여 주는 예입니다. ' +
      '다른 종목으로 바꿔 보면서 어느 쪽이 많은지 세어 보세요.';
    p.body.appendChild(note);
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    if (S.loading) {
      const p = App.panel('장중');
      const d = U.el('div', 'empty');
      d.innerHTML = '<span class="spinner"></span> 분봉을 불러오는 중…';
      p.body.appendChild(d);
      host.appendChild(p);
      return;
    }
    if (S.error) {
      const p = App.panel('장중');
      p.body.innerHTML = '<div class="note bad"><b>분봉 데이터를 불러오지 못했습니다.</b><br>' +
        U.escape(S.error) + '<br><br>데이터 수집 워크플로가 분봉까지 받았는지 확인하세요.</div>';
      host.appendChild(p);
      return;
    }
    if (!S.data) {
      host.appendChild(App.panel('장중'));
      load(host);
      return;
    }
    if (!S.ticker || !S.data.series[S.ticker]) {
      const p = App.panel('장중');
      p.body.appendChild(U.el('div', 'empty', '분봉이 있는 종목이 없습니다.'));
      host.appendChild(p);
      return;
    }
    host.appendChild(pickerPanel(host));
    host.appendChild(chartPanel());
    host.appendChild(shapePanel());
    host.appendChild(gapPanel());
    host.appendChild(splitPanel());

    const p = App.panel('이 화면이 말하는 것');
    p.body.innerHTML =
      '<p class="small">우리 백테스트는 <b>"종가에 원하는 만큼 체결된다"</b>고 가정합니다. ' +
      '이 화면은 그 가정이 어디까지 현실적인지 보여 줍니다.</p>' +
      '<ul class="small" style="padding-left:18px;line-height:1.8">' +
      '<li>개장 직후는 점심때보다 훨씬 출렁입니다. 같은 "하루"라도 언제 사느냐에 따라 체결가가 달라집니다.</li>' +
      '<li>밤사이 갭은 거래할 수 없는 구간입니다. 종가 기준 전략으로는 잡을 수도, 피할 수도 없습니다.</li>' +
      '<li>그래서 백테스트에 <b>슬리피지</b>를 넣습니다. 이 사이트의 기본값 편도 0.05%는 낙관적인 값입니다. ' +
      '거래량이 적은 종목이나 큰 금액이라면 훨씬 큽니다.</li>' +
      '</ul>';
    host.appendChild(p);
  }

  App.register('intraday', { render: draw });
})(window.QL = window.QL || {});
