/* ============================================================================
 *  strategy.js — 전략 실험실
 *
 *  실제 퀀트 기법 여러 개를 같은 조건에서 나란히 돌려 비교합니다.
 *  같은 기간, 같은 종목 수, 같은 거래비용으로 맞춰야 공정한 비교입니다.
 *
 *  백테스트 규칙 (현실에 맞춘 최소한의 규칙)
 *   - 리밸런싱 날 종가까지의 정보로 점수를 매기고, 그날 종가에 갈아탑니다.
 *   - 수익은 그 다음 날부터 반영됩니다(미래를 앞당겨 쓰지 않기 위해).
 *   - 갈아탈 때 바뀐 비중만큼 거래비용을 뗍니다.
 *   - 비교 기준은 QQQ 매수 후 보유와 동일가중입니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, M = root.M, STRAT = root.STRAT;

  const S = {
    selected: { momentum: 1, lowvol: 1, reversal: 1, equal: 1 },
    years: 5, topK: 10, rebalance: 21, cost: 0.05,
    results: null, running: false, progress: 0
  };

  /* ------------------------------------------------------------------------
   *  백테스트
   * ----------------------------------------------------------------------*/
  async function backtest(strategy, lo, hi, onProgress) {
    const cost = S.cost / 100;
    const dates = DATA.state.dates;
    let weights = {};                 // ticker -> 비중
    const ret = [], picks = [];
    let lastReb = -1e9, turnoverSum = 0, nReb = 0;

    for (let i = lo; i < hi; i++) {
      let turnover = 0;

      if (i - lastReb >= S.rebalance) {
        const scores = strategy.score(i);
        const keys = Object.keys(scores);
        if (keys.length >= 5) {
          keys.sort(function (a, b) { return scores[b] - scores[a]; });
          const chosen = strategy.id === 'equal' ? keys : keys.slice(0, S.topK);
          const w = 1 / chosen.length;
          const target = {};
          chosen.forEach(function (t) { target[t] = w; });

          const all = {};
          Object.keys(weights).forEach(function (t) { all[t] = 1; });
          Object.keys(target).forEach(function (t) { all[t] = 1; });
          Object.keys(all).forEach(function (t) {
            turnover += Math.abs((target[t] || 0) - (weights[t] || 0));
          });
          weights = target;
          lastReb = i;
          nReb++;
          turnoverSum += turnover;
          picks.push({ date: dates[i], tickers: chosen.slice(0, 12) });
        }
      }

      // 다음 날 수익률
      let r = 0;
      Object.keys(weights).forEach(function (t) {
        const s = DATA.series(t);
        const a = s[i], b = s[i + 1];
        if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) return;
        r += weights[t] * (b / a - 1);
      });
      ret.push(r - turnover * cost);

      // 비중 드리프트
      if (Math.abs(1 + r) > 1e-9) {
        const nw = {};
        Object.keys(weights).forEach(function (t) {
          const s = DATA.series(t);
          const a = s[i], b = s[i + 1];
          const g = (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) ? 1 : b / a;
          nw[t] = weights[t] * g / (1 + r);
        });
        weights = nw;
      }

      if (onProgress && (i - lo) % 100 === 0) {
        onProgress((i - lo) / (hi - lo));
        await U.yield_();
      }
    }

    return {
      id: strategy.id, name: strategy.name,
      ret: ret, perf: M.perf(ret),
      turnover: nReb ? turnoverSum / nReb : 0,
      nReb: nReb, picks: picks
    };
  }

  function benchmarkReturns(lo, hi, ticker) {
    const s = DATA.series(ticker);
    const out = [];
    for (let i = lo; i < hi; i++) {
      const a = s[i], b = s[i + 1];
      out.push((a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) ? 0 : b / a - 1);
    }
    return out;
  }

  async function run(host) {
    const ids = Object.keys(S.selected).filter(function (k) { return S.selected[k]; });
    if (!ids.length) return;
    S.running = true; S.progress = 0;
    draw(host);

    const n = DATA.state.dates.length;
    const hi = n - 1;
    const lo = Math.max(260, hi - S.years * 252);      // 지표 계산에 최소 1년 필요

    const results = [];
    for (let k = 0; k < ids.length; k++) {
      const st = STRAT.list.filter(function (x) { return x.id === ids[k]; })[0];
      if (!st) continue;
      const r = await backtest(st, lo, hi, function (f) {
        S.progress = (k + f) / ids.length;
        const el = U.$('#stratProg');
        if (el) el.style.width = Math.round(S.progress * 100) + '%';
      });
      results.push(r);
    }

    const bench = benchmarkReturns(lo, hi, 'QQQ');
    S.results = {
      lo: lo, hi: hi, list: results,
      bench: { name: 'QQQ 매수후보유', ret: bench, perf: M.perf(bench) }
    };
    S.running = false;
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  화면
   * ----------------------------------------------------------------------*/
  function pickerPanel(host) {
    const p = App.panel('전략 <span class="accent">고르기</span>',
      { sub: '여러 개를 골라 같은 조건에서 비교하세요' });

    const cats = {};
    STRAT.list.forEach(function (s) { (cats[s.cat] = cats[s.cat] || []).push(s); });

    Object.keys(cats).forEach(function (cat) {
      const label = U.el('div', 'tiny');
      label.style.cssText = 'letter-spacing:.1em;text-transform:uppercase;margin:8px 0 4px';
      label.textContent = cat;
      p.body.appendChild(label);

      const row = U.el('div', 'row');
      cats[cat].forEach(function (st) {
        const chip = U.el('label', 'chip' + (S.selected[st.id] ? ' on' : ''));
        chip.title = st.desc;
        const cb = U.el('input');
        cb.type = 'checkbox'; cb.checked = !!S.selected[st.id];
        cb.addEventListener('change', function () {
          S.selected[st.id] = cb.checked;
          chip.classList.toggle('on', cb.checked);
        });
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(st.name));
        row.appendChild(chip);
      });
      p.body.appendChild(row);
    });

    // 설정
    const cfg = U.el('div', 'row mt');
    const mk = function (label, options, cur, onChange) {
      const f = U.el('div', 'field');
      f.appendChild(U.el('label', '', label));
      const sel = U.el('select');
      options.forEach(function (o) {
        const e = U.el('option', '', o[1]); e.value = String(o[0]);
        if (String(o[0]) === String(cur)) e.selected = true;
        sel.appendChild(e);
      });
      sel.addEventListener('change', function () { onChange(sel.value); });
      f.appendChild(sel);
      return f;
    };
    cfg.appendChild(mk('기간', [[3, '최근 3년'], [5, '최근 5년'], [8, '최근 8년'], [11, '가능한 전체']],
      S.years, function (v) { S.years = +v; }));
    cfg.appendChild(mk('보유 종목 수', [[5, '5종목'], [10, '10종목'], [20, '20종목'], [30, '30종목']],
      S.topK, function (v) { S.topK = +v; }));
    cfg.appendChild(mk('리밸런싱', [[5, '1주마다'], [21, '1개월마다'], [63, '3개월마다']],
      S.rebalance, function (v) { S.rebalance = +v; }));

    const fc = U.el('div', 'field');
    fc.appendChild(U.el('label', '', '편도 비용(%)'));
    const ci = U.el('input'); ci.type = 'number'; ci.value = String(S.cost); ci.step = '0.01'; ci.min = '0';
    ci.addEventListener('input', function () { S.cost = +ci.value || 0; });
    fc.appendChild(ci); cfg.appendChild(fc);

    const btn = U.el('button', 'btn primary', S.running ? '실행 중…' : '백테스트 실행');
    btn.disabled = S.running;
    btn.addEventListener('click', function () { run(host); });
    cfg.appendChild(btn);
    p.body.appendChild(cfg);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'stratProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
    }
    return p;
  }

  function resultPanels(host) {
    const R = S.results;
    const out = [];
    const dates = DATA.state.dates.slice(R.lo + 1, R.hi + 1).map(function (d) { return d.slice(2, 7); });

    // 자산 곡선
    const p1 = App.panel('자산 곡선', { sub: '시작 = 1 · 거래비용 반영 후' });
    const series = R.list.map(function (r, i) {
      return { name: r.name, values: Array.from(M.perf(r.ret).cum), color: C.seriesColor(i) };
    });
    series.push({ name: R.bench.name, values: Array.from(R.bench.perf.cum), color: C.mutedColor(), dash: [4, 3] });

    const lg = U.el('div', 'legend');
    series.forEach(function (s) {
      const it = U.el('span', 'legend-item');
      const d = U.el('span', 'legend-dot'); d.style.background = s.color;
      it.appendChild(d); it.appendChild(U.el('span', '', s.name));
      lg.appendChild(it);
    });
    p1.body.appendChild(lg);
    const cv = U.el('canvas', 'chart lg');
    p1.body.appendChild(cv);
    C.line(cv, {
      labels: dates, series: series, zeroLine: 1,
      yFmt: function (v) { return v.toFixed(2) + '배'; }
    });
    out.push(p1);

    // 성과표
    const p2 = App.panel('성과 비교', { sub: '수익률만 보지 말고 샤프·MDD·회전율을 함께 보세요', tight: true });
    const rows = R.list.slice().sort(function (a, b) { return b.perf.cagr - a.perf.cagr; }).map(function (r) {
      const beat = r.perf.cagr - R.bench.perf.cagr;
      return {
        cells: [
          r.name,
          App.chg(r.perf.total, 1), App.chg(r.perf.cagr, 1),
          isFinite(r.perf.sharpe) ? r.perf.sharpe.toFixed(2) : '—',
          (r.perf.mdd * 100).toFixed(1) + '%',
          App.chg(beat, 1),
          (r.turnover * 100).toFixed(0) + '%',
          U.comma(r.nReb) + '회'
        ]
      };
    });
    rows.push({
      __cls: '',
      cells: [U.el('span', 'tiny', R.bench.name),
        App.chg(R.bench.perf.total, 1), App.chg(R.bench.perf.cagr, 1),
        isFinite(R.bench.perf.sharpe) ? R.bench.perf.sharpe.toFixed(2) : '—',
        (R.bench.perf.mdd * 100).toFixed(1) + '%', '—', '—', '1회']
    });
    p2.body.appendChild(App.table(
      ['전략', { label: '누적수익', num: true }, { label: '연평균', num: true },
       { label: '샤프', num: true }, { label: 'MDD', num: true },
       { label: 'QQQ 대비', num: true }, { label: '평균 회전율', num: true }, { label: '리밸런싱', num: true }],
      rows));
    out.push(p2);

    // 최근 선택 종목
    const p3 = App.panel('가장 최근 리밸런싱에서 고른 종목', { sub: '오늘 이 전략을 쓴다면 살 종목' });
    R.list.forEach(function (r) {
      if (r.id === 'equal' || !r.picks.length) return;
      const last = r.picks[r.picks.length - 1];
      const line = U.el('div', 'small');
      line.style.marginBottom = '6px';
      line.innerHTML = '<b>' + U.escape(r.name) + '</b> <span class="tiny">' + last.date + '</span><br>' +
        last.tickers.map(function (t) { return '<span class="tick">' + U.escape(t) + '</span>'; }).join(' · ');
      p3.body.appendChild(line);
    });
    out.push(p3);

    // 해석
    const best = R.list.slice().sort(function (a, b) { return b.perf.sharpe - a.perf.sharpe; })[0];
    const beatCount = R.list.filter(function (r) { return r.perf.cagr > R.bench.perf.cagr; }).length;
    const p4 = App.panel('이 결과는 이렇게 읽습니다');
    p4.body.innerHTML =
      '<div class="note ' + (beatCount ? 'ok' : 'warn') + '">' +
      '위험 대비 성과(샤프)가 가장 좋은 전략은 <b>' + U.escape(best.name) + '</b>입니다 (샤프 ' +
      best.perf.sharpe.toFixed(2) + ', 연 ' + (best.perf.cagr * 100).toFixed(1) + '%). ' +
      (beatCount ? beatCount + '개 전략이 QQQ 매수후보유를 앞섰습니다. '
                 : 'QQQ를 그냥 사서 들고 있는 것보다 나은 전략이 없었습니다. 흔한 결과입니다. ') +
      '기간을 바꾸면 순위가 쉽게 뒤집힙니다. 한 번의 결과를 믿지 말고 여러 기간에서 확인하세요.' +
      '</div>' +
      '<p class="small">이 구간은 ' + DATA.state.dates[R.lo] + ' ~ ' + DATA.state.dates[R.hi] +
      ' 이고, 종목은 <b>지금 나스닥100에 남아 있는 종목</b>만 담겨 있습니다(생존 편향). ' +
      '중간에 지수에서 빠진 종목이 없으므로 실제보다 성적이 좋게 나옵니다.</p>' +
      '<p class="small">회전율이 높은 전략은 비용에 약합니다. 위 표에서 편도 비용을 0.2%로 올려 다시 돌려 보면 ' +
      '어떤 전략이 먼저 무너지는지 볼 수 있습니다.</p>';
    out.push(p4);

    return out;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(pickerPanel(host));
    if (S.results) resultPanels(host).forEach(function (p) { host.appendChild(p); });
    else if (!S.running) {
      const p = App.panel('전략이란');
      p.body.innerHTML =
        '<p class="small">퀀트에서 전략은 <b>"어떤 종목을 살지 정하는 규칙"</b>입니다. ' +
        '감이 아니라 숫자로 줄을 세우고, 정해진 주기마다 기계적으로 갈아탑니다.</p>' +
        '<ul class="small" style="padding-left:18px;line-height:1.8">' +
        STRAT.list.map(function (s) {
          return '<li><b>' + U.escape(s.name) + '</b> <span class="tiny">(' + s.cat + ')</span><br>' +
            '<span class="tiny">' + U.escape(s.desc) + '</span></li>';
        }).join('') + '</ul>';
      host.appendChild(p);
    }
  }

  App.register('strategy', { render: draw });
})(window.QL = window.QL || {});
