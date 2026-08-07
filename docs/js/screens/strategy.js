/* ============================================================================
 *  strategy.js — 전략 실험실 (대회 방식)
 *
 *  실제 퀀트 대회가 공정성을 지키는 방법을 그대로 옮겼습니다.
 *
 *      [--------- 개발 구간 ---------][--- 채점 구간(잠김) ---]
 *       여기서 마음껏 실험하세요        제출해야 열립니다
 *
 *  왜 이렇게 하는가
 *    백테스트는 마음만 먹으면 얼마든지 좋게 만들 수 있습니다. 기간을 바꾸고,
 *    종목 수를 바꾸고, 잘 나온 것만 고르면 됩니다. 그렇게 고른 전략은
 *    '과거를 잘 설명하는 전략'일 뿐 '미래에 통하는 전략'이 아닙니다.
 *    그래서 대회는 최근 구간을 숨겨 두고, 제출한 뒤에야 그 구간 성적으로 채점합니다.
 *    (캐글의 Public/Private 리더보드, IQC의 아웃오브샘플 평가가 모두 같은 원리입니다)
 *
 *  백테스트 규칙
 *   - 리밸런싱 날 종가까지의 정보로 점수 → 그날 종가에 체결 → 다음 날부터 수익 반영
 *   - 갈아탈 때 바뀐 비중(회전율)만큼 거래비용을 뗍니다
 *   - 비교 기준은 QQQ 매수 후 보유
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, M = root.M, STRAT = root.STRAT;

  const S = {
    selected: { momentum: 1, lowvol: 1, equal: 1 },
    years: 5, topK: 10, rebalance: 21, cost: 0.05,
    aiHorizon: 21, aiRetrain: 63,
    holdoutMonths: 12,
    hypothesis: '',
    results: null, running: false, runCount: 0
  };

  // 이 브라우저에서 백테스트를 몇 번 돌렸는지 기억합니다(다중검정 경고용).
  try { S.runCount = +(localStorage.getItem('quantlab.runCount') || 0); } catch (e) {}

  /* ------------------------------------------------------------------------
   *  구간 나누기
   * ----------------------------------------------------------------------*/
  function ranges() {
    const n = DATA.state.dates.length;
    const end = n - 1;
    const holdoutDays = Math.round(S.holdoutMonths * 21);
    const scoreStart = Math.max(300, end - holdoutDays);
    const devEnd = scoreStart - 1;
    const devStart = Math.max(260, devEnd - S.years * 252);
    return { devStart: devStart, devEnd: devEnd, scoreStart: scoreStart, scoreEnd: end };
  }

  /* ------------------------------------------------------------------------
   *  백테스트 엔진
   * ----------------------------------------------------------------------*/
  async function backtest(strategy, lo, hi, onProgress) {
    const cost = S.cost / 100;
    const dates = DATA.state.dates;
    let weights = {};
    const ret = [], picks = [], turnovers = [];
    let lastReb = -1e9, nReb = 0;

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
          turnovers.push(turnover);
          picks.push({ date: dates[i], tickers: chosen.slice(0, 12) });
        }
      }

      let r = 0;
      Object.keys(weights).forEach(function (t) {
        const s = DATA.series(t);
        const a = s[i], b = s[i + 1];
        if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) return;
        r += weights[t] * (b / a - 1);
      });
      ret.push(r - turnover * cost);

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

      if (onProgress && (i - lo) % 120 === 0) {
        onProgress((i - lo) / (hi - lo));
        await U.yield_();
      }
    }

    const avgTurn = turnovers.length ? turnovers.reduce(function (a, b) { return a + b; }, 0) / turnovers.length : 0;
    return {
      id: strategy.id, name: strategy.name, ret: ret, perf: M.perf(ret),
      turnover: avgTurn, nReb: nReb, picks: picks, lo: lo, hi: hi
    };
  }

  function benchReturns(lo, hi, ticker) {
    const s = DATA.series(ticker);
    const out = [];
    for (let i = lo; i < hi; i++) {
      const a = s[i], b = s[i + 1];
      out.push((a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) ? 0 : b / a - 1);
    }
    return out;
  }

  // 전략 하나를 특정 구간에서 돌립니다 (AI는 먼저 워크포워드 학습).
  async function runOne(st, lo, hi, setProg) {
    const rebDates = [];
    for (let i = lo; i < hi; i += S.rebalance) rebDates.push(i);
    if (st.prepare) {
      setProg(0, '학습');
      await st.prepare(lo, hi, rebDates,
        { horizon: S.aiHorizon, retrainEvery: S.aiRetrain, trainWindow: 1000 },
        function (f) { setProg(f * 0.8, '학습 ' + Math.round(f * 100) + '%'); });
    }
    const r = await backtest(st, lo, hi, function (f) {
      setProg((st.prepare ? 0.8 : 0) + f * (st.prepare ? 0.2 : 1), '백테스트');
    });
    r.trained = st._trained;
    r.importance = st._importance;
    r.featureNames = st.featureNames;
    return r;
  }

  async function run(host) {
    const ids = Object.keys(S.selected).filter(function (k) { return S.selected[k]; });
    if (!ids.length) return;
    S.running = true;
    draw(host);

    const R = ranges();
    const results = [];
    for (let k = 0; k < ids.length; k++) {
      const st = STRAT.list.filter(function (x) { return x.id === ids[k]; })[0];
      if (!st) continue;
      const setProg = function (f, phase) {
        const el = U.$('#stratProg');
        if (el) el.style.width = Math.round(((k + f) / ids.length) * 100) + '%';
        const lbl = U.$('#stratPhase');
        if (lbl) lbl.textContent = st.name + ' — ' + phase + ' (' + (k + 1) + '/' + ids.length + ')';
      };
      results.push(await runOne(st, R.devStart, R.devEnd, setProg));
    }

    const bench = benchReturns(R.devStart, R.devEnd, 'QQQ');
    S.results = {
      range: R, list: results,
      bench: { name: 'QQQ 매수후보유', ret: bench, perf: M.perf(bench) }
    };
    S.running = false;
    S.runCount++;
    try { localStorage.setItem('quantlab.runCount', String(S.runCount)); } catch (e) {}

    // 연구 노트에 자동 기록. 학생이 따로 적지 않아도 시도가 쌓이게 합니다.
    if (root.JOURNAL) {
      const d = DATA.state.dates;
      root.JOURNAL.add({
        kind: 'backtest',
        hypothesis: S.hypothesis.trim(),
        config: { years: S.years, topK: S.topK, rebalance: S.rebalance, cost: S.cost,
                  aiHorizon: S.aiHorizon, holdoutMonths: S.holdoutMonths },
        range: { start: d[R.devStart], end: d[R.devEnd] },
        bench: { total: S.results.bench.perf.total, cagr: S.results.bench.perf.cagr,
                 sharpe: S.results.bench.perf.sharpe },
        results: results.map(function (r) {
          return { id: r.id, name: r.name, total: r.perf.total, cagr: r.perf.cagr,
                   sharpe: r.perf.sharpe, mdd: r.perf.mdd, turnover: r.turnover,
                   t_stat: r.perf.t_stat };
        })
      });
    }
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  대회 규칙
   * ----------------------------------------------------------------------*/
  function rulePanel() {
    const R = ranges();
    const d = DATA.state.dates;
    const p = App.panel('대회 규칙 <span class="accent">COMPETITION</span>',
      { sub: '개발 구간에서 만들고, 채점 구간으로 평가합니다' });

    const g = U.el('div', 'grid g3');
    g.appendChild(App.stat('개발 구간', d[R.devStart] + ' ~ ' + d[R.devEnd],
      (R.devEnd - R.devStart) + '거래일 · 여기서 실험'));
    g.appendChild(App.stat('채점 구간 (잠김)', d[R.scoreStart] + ' ~ ' + d[R.scoreEnd],
      (R.scoreEnd - R.scoreStart) + '거래일 · 제출해야 열림'));
    const f = U.el('div', 'stat');
    f.appendChild(U.el('div', 'k', '채점 구간 길이'));
    const sel = U.el('select');
    [[6, '최근 6개월'], [12, '최근 12개월'], [18, '최근 18개월']].forEach(function (o) {
      const e = U.el('option', '', o[1]); e.value = String(o[0]);
      if (o[0] === S.holdoutMonths) e.selected = true;
      sel.appendChild(e);
    });
    sel.addEventListener('change', function () { S.holdoutMonths = +sel.value; S.results = null; draw(U.$('#main')); });
    sel.style.marginTop = '4px';
    f.appendChild(sel);
    g.appendChild(f);
    p.body.appendChild(g);

    p.body.appendChild(U.el('div', 'note',
      '백테스트는 개발 구간에서만 돌아갑니다. 제출 버튼을 누르면 그 전략을 채점 구간에서 ' +
      '다시 돌려 그 성적이 순위표에 올라갑니다. 채점 구간 성적을 미리 볼 수 없으므로, ' +
      '"과거에 잘 맞는 전략"이 아니라 "처음 보는 구간에서도 통하는 전략"을 만들어야 합니다.'));

    if (S.runCount >= 8) {
      const w = U.el('div', 'note warn');
      w.innerHTML = '<b>다중검정 주의.</b> 이 브라우저에서 백테스트를 <b>' + S.runCount + '번</b> 돌렸습니다. ' +
        '설정을 여러 번 바꾸면 그중 하나는 우연히 좋아 보입니다. 20번 시도하면 그중 하나가 ' +
        '"5% 유의"로 나오는 건 당연합니다. 좋은 결과가 나왔다면 몇 번째 시도였는지 기록해 두고, ' +
        '채점 구간에서 재현되는지로 판단하세요.';
      const jb = U.el('button', 'btn sm', '연구 노트에서 내 시도 보기');
      jb.style.marginTop = '8px';
      jb.addEventListener('click', function () { App.go('journal'); });
      w.appendChild(jb);
      p.body.appendChild(w);
    }
    return p;
  }

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
    cfg.appendChild(mk('개발 기간', [[3, '3년'], [5, '5년'], [8, '8년']], S.years, function (v) { S.years = +v; }));
    cfg.appendChild(mk('보유 종목', [[5, '5종목'], [10, '10종목'], [20, '20종목'], [30, '30종목']],
      S.topK, function (v) { S.topK = +v; }));
    cfg.appendChild(mk('리밸런싱', [[5, '1주'], [21, '1개월'], [63, '3개월']], S.rebalance, function (v) { S.rebalance = +v; }));
    cfg.appendChild(mk('AI 예측 시계', [[5, '5일 뒤'], [21, '1개월 뒤'], [63, '3개월 뒤']],
      S.aiHorizon, function (v) { S.aiHorizon = +v; }));

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

    // 실행 전에 한 줄 적게 합니다. 리서처가 실제로 하는 일이고,
    // 나중에 "왜 이 설정이었나"에 답할 수 있는 유일한 방법입니다.
    const fh = U.el('div', 'field');
    fh.style.marginTop = '8px';
    fh.appendChild(U.el('label', '', '이번 시도에서 무엇을 왜 바꿨나 (선택 · 연구 노트에 기록됩니다)'));
    const hi = U.el('input');
    hi.type = 'text';
    hi.placeholder = '예) 비용 0.3%에서도 모멘텀이 버티는지 보려고 리밸런싱을 3개월로 늘림';
    hi.value = S.hypothesis;
    hi.style.width = '100%';
    hi.addEventListener('input', function () { S.hypothesis = hi.value; });
    fh.appendChild(hi);
    p.body.appendChild(fh);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'stratProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
      const ph = U.el('div', 'tiny'); ph.id = 'stratPhase'; ph.textContent = '준비 중…';
      p.body.appendChild(ph);
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  결과 패널들
   * ----------------------------------------------------------------------*/
  function legendOf(series) {
    const lg = U.el('div', 'legend');
    series.forEach(function (s) {
      const it = U.el('span', 'legend-item');
      const d = U.el('span', 'legend-dot'); d.style.background = s.color;
      it.appendChild(d); it.appendChild(U.el('span', '', s.name));
      lg.appendChild(it);
    });
    return lg;
  }

  function equityPanel() {
    const R = S.results;
    const p = App.panel('자산 곡선', { sub: '개발 구간 · 시작 = 1 · 거래비용 반영 후' });
    const dates = DATA.state.dates.slice(R.range.devStart + 1, R.range.devEnd + 1)
      .map(function (d) { return d.slice(2, 7); });
    const series = R.list.map(function (r, i) {
      return { name: r.name, values: Array.from(r.perf.cum), color: C.seriesColor(i) };
    });
    series.push({ name: R.bench.name, values: Array.from(R.bench.perf.cum), color: C.mutedColor(), dash: [4, 3] });
    p.body.appendChild(legendOf(series));
    const cv = U.el('canvas', 'chart lg');
    p.body.appendChild(cv);
    C.line(cv, { labels: dates, series: series, zeroLine: 1, yFmt: function (v) { return v.toFixed(2) + '배'; } });
    return p;
  }

  function perfPanel() {
    const R = S.results;
    const p = App.panel('성과 비교', { sub: '수익률만 보지 말고 샤프·MDD·회전율을 함께 보세요', tight: true });
    const rows = R.list.slice().sort(function (a, b) { return b.perf.sharpe - a.perf.sharpe; }).map(function (r) {
      return {
        cells: [r.name, App.chg(r.perf.total, 1), App.chg(r.perf.cagr, 1),
          isFinite(r.perf.sharpe) ? r.perf.sharpe.toFixed(2) : '—',
          (r.perf.mdd * 100).toFixed(1) + '%',
          App.chg(r.perf.cagr - R.bench.perf.cagr, 1),
          (r.turnover * 100).toFixed(0) + '%',
          isFinite(r.perf.t_stat) ? r.perf.t_stat.toFixed(2) : '—']
      };
    });
    const b = R.bench.perf;
    rows.push({ cells: [U.el('span', 'tiny', R.bench.name), App.chg(b.total, 1), App.chg(b.cagr, 1),
      isFinite(b.sharpe) ? b.sharpe.toFixed(2) : '—', (b.mdd * 100).toFixed(1) + '%', '—', '—',
      isFinite(b.t_stat) ? b.t_stat.toFixed(2) : '—'] });
    p.body.appendChild(App.table(
      ['전략', { label: '누적', num: true }, { label: '연평균', num: true }, { label: '샤프', num: true },
       { label: 'MDD', num: true }, { label: 'QQQ 대비', num: true }, { label: '회전율', num: true },
       { label: 't값', num: true }], rows));
    const note = U.el('div', 'note');
    note.style.margin = '10px 12px';
    note.innerHTML = '<b>t값</b>은 그 수익이 우연일 가능성을 봅니다. |t| &gt; 2 면 우연으로 보기 어렵습니다. ' +
      '다만 백테스트를 여러 번 돌려 고른 전략이면 t값도 부풀려집니다.';
    p.body.appendChild(note);
    return p;
  }

  function costPanel() {
    const R = S.results;
    const p = App.panel('거래비용 민감도', { sub: '비용을 올리면 어느 전략이 먼저 무너지는가' });
    const levels = [0, 0.0005, 0.001, 0.002, 0.004, 0.008];
    const rows = R.list.map(function (r) {
      const cells = [r.name];
      levels.forEach(function (lv) {
        const extra = (lv - S.cost / 100) * r.turnover * r.nReb;
        cells.push(App.chg(r.perf.total - extra, 0));
      });
      // 이 비용을 넘으면 QQQ 매수후보유를 못 이깁니다.
      const bt = R.bench.perf.total;
      let cell;
      if (r.perf.total <= bt) {
        cell = U.el('span', 'tiny down', '이미 미달');   // 비용 0에서도 벤치마크에 짐
      } else if (r.turnover > 0 && r.nReb > 0) {
        const c = (r.perf.total - bt) / (r.turnover * r.nReb) + S.cost / 100;
        cell = U.el('span', c > 0.002 ? 'up' : 'down', (c * 100).toFixed(2) + '%');
      } else {
        cell = U.el('span', 'tiny', '거래 없음');
      }
      cells.push(cell);
      return { cells: cells };
    });
    p.body.appendChild(App.table(
      ['전략'].concat(levels.map(function (l) { return { label: (l * 100).toFixed(2) + '%', num: true }; }))
        .concat([{ label: '손익분기 비용', num: true }]), rows));
    p.body.appendChild(U.el('div', 'note',
      '맨 오른쪽이 핵심입니다. 편도 비용이 그 값을 넘으면 QQQ를 그냥 사는 것만 못합니다. ' +
      '개인 투자자의 실제 비용은 수수료 + 세금 + 슬리피지로 편도 0.1~0.3%인 경우가 많습니다.'));
    return p;
  }

  function rollingPanel() {
    const R = S.results;
    const p = App.panel('롤링 12개월 수익률', { sub: '전략이 언제 통했고 언제 안 통했는지' });
    const W = 252;
    const roll = function (rr) {
      const vals = [];
      let prod = 1;
      for (let k = 0; k < rr.length; k++) {
        prod *= (1 + rr[k]);
        if (k >= W) prod /= (1 + rr[k - W]);
        vals.push(k >= W - 1 ? prod - 1 : null);
      }
      return vals;
    };
    const series = R.list.map(function (r, i) {
      return { name: r.name, values: roll(r.ret), color: C.seriesColor(i) };
    });
    series.push({ name: R.bench.name, values: roll(R.bench.ret), color: C.mutedColor(), dash: [4, 3] });
    const dates = DATA.state.dates.slice(R.range.devStart + 1, R.range.devEnd + 1).map(function (d) { return d.slice(2, 7); });
    p.body.appendChild(legendOf(series));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, { labels: dates, series: series, zeroLine: 0, yFmt: function (v) { return (v * 100).toFixed(0) + '%'; } });
    p.body.appendChild(U.el('div', 'note',
      '0선 아래로 내려간 구간이 "1년 들고 있었는데 손해였던" 시기입니다. ' +
      '실제 운용에서는 이 구간을 버티지 못하고 전략을 갈아타는 것이 가장 흔한 실패 원인입니다.'));
    return p;
  }

  function importancePanel() {
    const R = S.results;
    const ai = R.list.filter(function (r) { return r.importance && r.featureNames; });
    if (!ai.length) return null;
    const p = App.panel('AI가 참고한 팩터', { sub: '학습된 모델이 어떤 값을 많이 썼는지' });
    ai.forEach(function (r) {
      const items = r.featureNames.map(function (n, i) { return { name: n, v: r.importance[i] || 0 }; })
        .sort(function (a, b) { return b.v - a.v; });
      const box = U.el('div');
      box.style.marginBottom = '12px';
      box.innerHTML = '<div class="small"><b>' + U.escape(r.name) + '</b> <span class="tiny">재학습 ' +
        (r.trained || 0) + '회</span></div>';
      items.forEach(function (it) {
        const line = U.el('div', 'row center');
        line.style.cssText = 'gap:8px;margin:2px 0';
        const nm = U.el('span', 'tiny'); nm.style.width = '150px'; nm.textContent = it.name;
        const bar = App.bar(it.v / (items[0].v || 1));
        bar.style.cssText = 'flex:1;max-width:260px';
        const val = U.el('span', 'tiny mono'); val.textContent = (it.v * 100).toFixed(1) + '%';
        line.appendChild(nm); line.appendChild(bar); line.appendChild(val);
        box.appendChild(line);
      });
      p.body.appendChild(box);
    });
    return p;
  }

  function picksPanel() {
    const R = S.results;
    const p = App.panel('가장 최근 리밸런싱에서 고른 종목', { sub: '개발 구간의 마지막 시점' });
    R.list.forEach(function (r) {
      if (r.id === 'equal' || !r.picks.length) return;
      const last = r.picks[r.picks.length - 1];
      const line = U.el('div', 'small');
      line.style.marginBottom = '6px';
      line.innerHTML = '<b>' + U.escape(r.name) + '</b> <span class="tiny">' + last.date + '</span><br>' +
        last.tickers.map(function (t) { return '<span class="tick">' + U.escape(t) + '</span>'; }).join(' · ');
      p.body.appendChild(line);
    });
    return p;
  }

  function readingPanel() {
    const R = S.results;
    const best = R.list.slice().sort(function (a, b) { return b.perf.sharpe - a.perf.sharpe; })[0];
    const beat = R.list.filter(function (r) { return r.perf.cagr > R.bench.perf.cagr; }).length;
    const p = App.panel('이 결과는 이렇게 읽습니다');
    p.body.innerHTML =
      '<div class="note ' + (beat ? 'ok' : 'warn') + '">' +
      '위험 대비 성과(샤프)가 가장 좋은 전략은 <b>' + U.escape(best.name) + '</b>입니다 (샤프 ' +
      best.perf.sharpe.toFixed(2) + ', 연 ' + (best.perf.cagr * 100).toFixed(1) + '%, MDD ' +
      (best.perf.mdd * 100).toFixed(1) + '%). ' +
      (beat ? beat + '개 전략이 QQQ를 앞섰습니다. ' : 'QQQ를 그냥 사서 들고 있는 것보다 나은 전략이 없었습니다. ') +
      '<b>이건 개발 구간 성적일 뿐입니다.</b> 진짜 실력은 제출 후 채점 구간에서 드러납니다.' +
      '</div>' +
      '<p class="small">확인해 볼 것:<br>' +
      '· 수익률 1위와 샤프 1위가 다른가? 다르다면 무엇으로 줄 세울지 먼저 정해야 합니다.<br>' +
      '· 회전율이 높은 전략이 상위에 있나? 비용 민감도 표에서 손익분기 비용을 확인하세요.<br>' +
      '· 롤링 12개월이 마이너스인 구간이 얼마나 길었나? 실제로 그 기간을 버틸 수 있나?<br>' +
      '· 종목은 <b>지금 나스닥100에 남아 있는 것</b>만 있습니다(생존 편향). 실제보다 좋게 나옵니다.</p>';
    return p;
  }

  /* ------------------------------------------------------------------------
   *  제출 — 채점 구간에서 다시 돌려 그 성적을 올립니다
   * ----------------------------------------------------------------------*/
  function submitPanel() {
    const LB = root.LB;
    const R = S.results;
    const p = App.panel('제출 <span class="accent">SUBMIT</span>',
      { sub: '채점 구간에서 다시 돌려 그 성적이 순위표에 올라갑니다' });

    if (!LB || !LB.available) {
      p.body.innerHTML = '<div class="note warn">순위표 설정이 없습니다.</div>';
      return p;
    }
    if (DATA.state.synthetic) {
      p.body.innerHTML = '<div class="note warn">가상 데이터로 만든 기록은 제출할 수 없습니다.</div>';
      return p;
    }

    const row = U.el('div', 'row');
    const fS = U.el('div', 'field');
    fS.appendChild(U.el('label', '', '제출할 전략'));
    const selS = U.el('select');
    selS.style.minWidth = '190px';
    R.list.forEach(function (r, i) {
      const o = U.el('option', '', r.name); o.value = String(i);
      selS.appendChild(o);
    });
    fS.appendChild(selS); row.appendChild(fS);

    const fN = U.el('div', 'field');
    fN.appendChild(U.el('label', '', '닉네임 (2~20자)'));
    const nick = U.el('input'); nick.type = 'text'; nick.maxLength = 20;
    nick.value = localStorage.getItem('quantlab.nick') || '';
    fN.appendChild(nick); row.appendChild(fN);

    const fT = U.el('div', 'field');
    fT.appendChild(U.el('label', '', '소속/팀 (선택)'));
    const team = U.el('input'); team.type = 'text'; team.maxLength = 30;
    team.value = localStorage.getItem('quantlab.team') || '';
    fT.appendChild(team); row.appendChild(fT);

    const btn = U.el('button', 'btn primary', '채점 구간에서 평가하고 제출');
    row.appendChild(btn);
    p.body.appendChild(row);

    const msg = U.el('div', 'small mt');
    p.body.appendChild(msg);
    const resultBox = U.el('div');
    p.body.appendChild(resultBox);

    p.body.appendChild(U.el('div', 'note',
      '제출하면 같은 설정으로 <b>채점 구간</b>을 다시 돌립니다. 그 성적이 순위표에 오릅니다. ' +
      '전략 설정과 고른 종목이 함께 저장되어 누구든 재현해 확인할 수 있습니다. ' +
      '한 번 올린 기록은 수정·삭제할 수 없습니다.'));

    btn.addEventListener('click', async function () {
      const name = nick.value.trim();
      if (name.length < 2) { msg.textContent = '닉네임을 2자 이상 입력하세요.'; msg.className = 'small mt down'; return; }
      localStorage.setItem('quantlab.nick', name);
      localStorage.setItem('quantlab.team', team.value.trim());

      const dev = R.list[+selS.value];
      const st = STRAT.list.filter(function (x) { return x.id === dev.id; })[0];
      btn.disabled = true;
      msg.textContent = '채점 구간에서 평가 중… (AI 전략은 시간이 걸립니다)';
      msg.className = 'small mt';

      try {
        const oos = await runOne(st, R.range.scoreStart, R.range.scoreEnd, function (f, phase) {
          msg.textContent = '채점 중 — ' + phase + ' ' + Math.round(f * 100) + '%';
        });
        const ob = M.perf(benchReturns(R.range.scoreStart, R.range.scoreEnd, 'QQQ'));
        const d = DATA.state.dates;

        resultBox.innerHTML = '';
        const g = U.el('div', 'grid g4');
        g.style.margin = '10px 0';
        g.appendChild(App.stat('채점 구간 수익률',
          (oos.perf.total >= 0 ? '+' : '') + (oos.perf.total * 100).toFixed(2) + '%',
          '개발 구간 ' + (dev.perf.total >= 0 ? '+' : '') + (dev.perf.total * 100).toFixed(1) + '%',
          oos.perf.total >= 0 ? 'up' : 'down'));
        g.appendChild(App.stat('QQQ 대비',
          (oos.perf.total - ob.total >= 0 ? '+' : '') + ((oos.perf.total - ob.total) * 100).toFixed(2) + '%p',
          'QQQ ' + (ob.total * 100).toFixed(1) + '%', oos.perf.total - ob.total >= 0 ? 'up' : 'down'));
        g.appendChild(App.stat('샤프', isFinite(oos.perf.sharpe) ? oos.perf.sharpe.toFixed(2) : '—',
          '개발 구간 ' + (isFinite(dev.perf.sharpe) ? dev.perf.sharpe.toFixed(2) : '—')));
        g.appendChild(App.stat('최대낙폭', (oos.perf.mdd * 100).toFixed(1) + '%', '채점 구간'));
        resultBox.appendChild(g);

        const gap = dev.perf.cagr - oos.perf.cagr;
        const verdict = U.el('div', 'note ' + (Math.abs(gap) < 0.05 ? 'ok' : 'warn'));
        verdict.innerHTML = Math.abs(gap) < 0.05
          ? '<b>개발 구간과 채점 구간의 성적이 비슷합니다.</b> 과적합 신호가 약합니다. 좋은 전략의 조건 중 하나입니다.'
          : '<b>개발 구간(연 ' + (dev.perf.cagr * 100).toFixed(1) + '%)과 채점 구간(연 ' +
            (oos.perf.cagr * 100).toFixed(1) + '%)의 차이가 큽니다.</b> ' +
            (gap > 0 ? '개발 구간에 과적합했을 가능성이 있습니다. 실제 대회에서 순위가 크게 떨어지는 전형적인 경우입니다.'
                     : '채점 구간이 더 좋게 나왔습니다. 운일 수 있으니 다른 구간에서도 확인하세요.');
        resultBox.appendChild(verdict);

        await LB.submit({
          nickname: name,
          team: team.value.trim() || null,
          strategy: oos.id,
          strategy_name: oos.name,
          start_date: d[R.range.scoreStart],
          end_date: d[R.range.scoreEnd],
          trading_days: oos.ret.length,
          initial: 100000,
          final_value: Math.round(100000 * (1 + oos.perf.total)),
          ret: +oos.perf.total.toFixed(6),
          bench_ret: +ob.total.toFixed(6),
          excess: +(oos.perf.total - ob.total).toFixed(6),
          sharpe: isFinite(oos.perf.sharpe) ? +oos.perf.sharpe.toFixed(4) : null,
          mdd: isFinite(oos.perf.mdd) ? +oos.perf.mdd.toFixed(4) : null,
          trades: oos.nReb,
          fee: S.cost / 100,
          data_updated: (DATA.state.meta && DATA.state.meta.updated) || null,
          audit: {
            kind: 'strategy-oos',
            config: { topK: S.topK, rebalance: S.rebalance, years: S.years, cost: S.cost,
                      aiHorizon: S.aiHorizon, aiRetrain: S.aiRetrain, holdoutMonths: S.holdoutMonths },
            dev: { start: d[R.range.devStart], end: d[R.range.devEnd],
                   total: +dev.perf.total.toFixed(6),
                   sharpe: isFinite(dev.perf.sharpe) ? +dev.perf.sharpe.toFixed(4) : null,
                   mdd: +dev.perf.mdd.toFixed(4) },
            turnover: +oos.turnover.toFixed(3),
            trained: oos.trained || null,
            runCount: S.runCount,
            picks: oos.picks.slice(-30)
          }
        });
        if (root.JOURNAL) {
          root.JOURNAL.add({
            kind: 'submit',
            strategy: oos.id, strategyName: oos.name,
            hypothesis: S.hypothesis.trim(),
            config: { years: S.years, topK: S.topK, rebalance: S.rebalance, cost: S.cost,
                      aiHorizon: S.aiHorizon, holdoutMonths: S.holdoutMonths },
            dev: { total: dev.perf.total, cagr: dev.perf.cagr, sharpe: dev.perf.sharpe, mdd: dev.perf.mdd },
            oos: { total: oos.perf.total, cagr: oos.perf.cagr, sharpe: oos.perf.sharpe, mdd: oos.perf.mdd },
            excess: oos.perf.total - ob.total,
            runCount: S.runCount
          });
        }
        msg.textContent = '제출 완료. 순위표 탭에서 확인하세요. 연구 노트에도 기록했습니다.';
        msg.className = 'small mt up';
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'small mt down';
        btn.disabled = false;
      }
    });
    return p;
  }

  function introPanel() {
    const p = App.panel('전략이란');
    p.body.innerHTML =
      '<p class="small">퀀트에서 전략은 <b>"어떤 종목을 살지 정하는 규칙"</b>입니다. ' +
      '감이 아니라 숫자로 줄을 세우고, 정해진 주기마다 기계적으로 갈아탑니다. ' +
      '아래 전략들은 모두 <code>score(날짜) → {종목: 점수}</code> 한 가지 모양이라, ' +
      '고전 팩터든 AI든 똑같은 조건에서 겨룹니다.</p>' +
      '<ul class="small" style="padding-left:18px;line-height:1.75">' +
      STRAT.list.map(function (s) {
        return '<li><b>' + U.escape(s.name) + '</b> <span class="tiny">(' + s.cat + ')</span><br>' +
          '<span class="tiny">' + U.escape(s.desc) + '</span></li>';
      }).join('') + '</ul>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(rulePanel());
    host.appendChild(pickerPanel(host));
    if (S.results) {
      host.appendChild(equityPanel());
      host.appendChild(perfPanel());
      host.appendChild(costPanel());
      host.appendChild(rollingPanel());
      const imp = importancePanel();
      if (imp) host.appendChild(imp);
      host.appendChild(picksPanel());
      host.appendChild(readingPanel());
      host.appendChild(submitPanel());
    } else if (!S.running) {
      host.appendChild(introPanel());
    }
  }

  App.register('strategy', { render: draw });
})(window.QL = window.QL || {});
