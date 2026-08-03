/* ============================================================================
 *  quant.js — '퀀트 AI' 탭
 *
 *  파이썬(quant/)에서 GPU로 학습한 결과를 그대로 받아서
 *    1) 예측력(IC)과 포트폴리오 성과를 보고
 *    2) 그 예측으로 여러 종목 모의투자를 해 봅니다.
 *
 *  다른 탭의 모의투자는 지수 하나를 사고파는 것이지만, 여기는 진짜 퀀트처럼
 *  "갈아타는 날마다 여러 종목 중에 고르는" 방식입니다.
 *
 *    AI 포트폴리오   : 매번 AI 점수 상위 K종목을 동일가중으로 담습니다.
 *    내 포트폴리오   : 내가 직접 고른 종목을 담습니다.
 *    동일가중 벤치마크: 그날 살 수 있는 전 종목을 똑같이 담습니다.
 *
 *  갈아탈 때마다 바뀐 비중만큼 거래비용을 뗍니다(학습에 쓴 설정과 같은 값).
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C;
  const $ = U.$, $$ = U.$$;

  const Q = { data: null, sim: null };

  /* ------------------------------------------------------------------------
   *  불러오기
   * ----------------------------------------------------------------------*/
  function setData(d, sourceLabel) {
    if (!d || !d.tickers || !d.dates || !d.scores) throw new Error('형식이 맞지 않습니다. quant 파이프라인이 만든 web_export.json인지 확인하세요.');
    Q.data = d;
    Q.data.__source = sourceLabel || '';
    // 날짜 → 가격 행 번호
    Q.priceRow = {};
    d.dates.forEach(function (ds, i) { Q.priceRow[ds] = i; });
    Q.sim = null;
    $('#qtBoard').classList.remove('hidden');
    $('#qtSimBoard').classList.add('hidden');
    renderSummary();
  }

  function loadSample() {
    if (!root.SAMPLE_QUANT) {
      status('샘플이 이 페이지에 포함돼 있지 않습니다. 학습 결과 JSON을 직접 올려 주세요.');
      return;
    }
    setData(JSON.parse(JSON.stringify(root.SAMPLE_QUANT)), '내장 샘플');
    status('내장 샘플을 불러왔습니다. (가상 데이터로 학습한 결과입니다)');
  }

  function status(msg) { const e = $('#qtStatus'); if (e) e.textContent = msg || ''; }

  /* ------------------------------------------------------------------------
   *  요약 화면
   * ----------------------------------------------------------------------*/
  function tile(label, value, sub, cls) {
    const el = U.el('div', 'tile');
    el.appendChild(U.el('div', 'label', label));
    const v = U.el('div', 'value' + (cls ? ' ' + cls : ''), value);
    el.appendChild(v);
    el.appendChild(U.el('div', 'sub', sub));
    return el;
  }

  function renderSummary() {
    const d = Q.data, m = d.meta, st = d.ic.stats, pf = d.performance;

    const head = $('#qtMeta');
    head.innerHTML = '';
    const note = U.el('div', 'note' + (m.synthetic ? ' warn' : ''));
    note.innerHTML =
      (m.synthetic ? '<strong>가상 데이터로 학습한 결과입니다.</strong> 실제 시장 성과가 아닙니다. ' : '') +
      '모델 <strong>' + m.model + '</strong> · 손실 ' + (m.loss || 'ic') + ' · 학습장치 ' + (m.device || '—') +
      ' · 종목 ' + m.universe + '개 · 특징 ' + (m.n_features || '—') + '개 · 앙상블 ' + (m.ensemble || 1) + '회<br>' +
      '예측시계 ' + m.horizon + '일 · ' + m.rebalance + '일마다 상위 ' + m.top_k + '종목' +
      (m.long_short ? ' 롱숏' : ' 롱온리') + ' · 편도비용 ' + U.pct(m.cost_per_side + m.slippage, 3) +
      ' · 생성 ' + (m.created || '—') + (d.__source ? ' · ' + d.__source : '') +
      (m.note ? '<br>' + m.note : '');
    head.appendChild(note);

    const box = $('#qtTiles');
    box.innerHTML = '';
    const icv = st.ic_mean, t = st.ic_t_stat;
    box.appendChild(tile('IC 평균', U.fmt(icv, 4),
      icv >= 0.02 ? '실무에서 쓸 만한 수준' : (icv > 0 ? '아주 약함' : '예측력 없음'),
      icv >= 0.02 ? 'up' : ''));
    box.appendChild(tile('IC t값', U.fmt(t, 2),
      Math.abs(t) > 2 ? '우연으로 보기 어려움' : '우연일 수 있음', Math.abs(t) > 2 ? 'up' : ''));
    box.appendChild(tile('AI 전략 연평균', U.signPct(pf.net.cagr, 1),
      '샤프 ' + U.fmt(pf.net.sharpe, 2) + ' · MDD ' + U.pct(pf.net.mdd, 0),
      pf.net.cagr >= 0 ? 'up' : 'down'));
    box.appendChild(tile('벤치마크 연평균', U.signPct(pf.benchmark.cagr, 1),
      '동일가중 · 샤프 ' + U.fmt(pf.benchmark.sharpe, 2),
      pf.benchmark.cagr >= 0 ? 'up' : 'down'));

    // 자산 곡선
    const eq = d.equity;
    const labels = eq.dates.map(function (s) { return s.slice(2, 7); });
    const series = [
      { name: 'AI 전략 (비용 후)', values: eq.strategy, color: C.seriesColor(0) },
      { name: 'AI 전략 (비용 전)', values: eq.strategy_gross, color: C.seriesColor(2), dash: [5, 4] },
      { name: '동일가중 벤치마크', values: eq.benchmark, color: C.seriesColor(1) }
    ];
    // 시장지수는 대개 동일가중 벤치마크와 거의 겹치므로 눈에 덜 띄게 그립니다.
    if (eq.index) series.push({ name: '시장지수', values: eq.index, color: C.mutedColor(), dash: [2, 3] });
    C.line($('#qtEquity'), { labels: labels, series: series, zeroLine: 1, yFmt: function (v) { return U.fmt(v, 2) + '배'; } });
    const lg = $('#qtEquityLegend'); lg.innerHTML = '';
    lg.appendChild(C.legend(series.map(function (s) { return { name: s.name, color: s.color }; })));

    // IC 흐름 (이동평균)
    const w = Math.max(5, Math.round(d.ic.values.length / 30));
    const roll = movingAvg(d.ic.values, w);
    C.line($('#qtIc'), {
      labels: d.ic.dates.map(function (s) { return s.slice(2, 7); }),
      series: [{ name: 'IC(' + w + '개 이동평균)', values: roll, color: C.seriesColor(0), area: true }],
      zeroLine: 0, yFmt: function (v) { return U.fmt(v, 3); }
    });

    // 분위별 수익
    C.bars($('#qtQuantiles'), {
      items: d.quantiles.map(function (v, i) {
        return { label: (i + 1) + '분위' + (i === 0 ? ' (점수 낮음)' : (i === d.quantiles.length - 1 ? ' (점수 높음)' : '')),
                 value: v || 0, color: (v || 0) >= 0 ? C.seriesColor(0) : C.seriesColor(7) };
      }),
      baseValue: 0, vFmt: function (v) { return U.signPct(v, 2); }, padL: 130
    });

    // 성과 표
    const rows = [
      ['AI 전략 (비용 후)', pf.net], ['AI 전략 (비용 전)', pf.gross], ['동일가중 벤치마크', pf.benchmark]
    ].map(function (r) {
      const p = r[1];
      return [r[0], U.signPct(p.total, 1), U.signPct(p.cagr, 1), U.fmt(p.sharpe, 2), U.pct(p.mdd, 1), U.pct(p.hit, 1)];
    });
    const ex = pf.excess;
    rows.push(['초과수익 (전략−벤치마크)', U.signPct(ex.total, 1), U.signPct(ex.cagr, 1),
      U.fmt(ex.sharpe, 2), U.pct(ex.mdd, 1), 't값 ' + U.fmt(ex.t_stat, 2)]);
    const tw = $('#qtPerfTable'); tw.innerHTML = '';
    tw.appendChild(U.table(['구분', '누적수익', '연평균', '샤프', '최대낙폭', '승률'], rows));

    // 워크포워드 구간
    const ft = $('#qtFoldTable'); ft.innerHTML = '';
    ft.appendChild(U.table(['구간', '학습일수', '검증 IC', '시험 IC', '학습 시간'],
      d.folds.map(function (f, i) {
        return [(i + 1) + '구간', U.comma(f.train[1] - f.train[0]), U.fmt(f.valid_ic, 4),
          U.fmt(f.test_ic, 4), U.fmt(f.seconds, 1) + '초'];
      })));

    // 해석
    const good = st.ic_mean >= 0.02 && Math.abs(st.ic_t_stat) > 2;
    const beat = pf.net.cagr > pf.benchmark.cagr;
    $('#qtReading').innerHTML =
      '<h3>이 결과는 이렇게 읽습니다</h3>' +
      '<div class="note ' + (good && beat ? 'ok' : (good ? '' : 'warn')) + '">' +
      'IC 평균 ' + U.fmt(st.ic_mean, 4) + ' (t = ' + U.fmt(st.ic_t_stat, 2) + '), ' +
      'IC가 0보다 컸던 날의 비율 ' + U.pct(st.ic_positive_rate, 1) + '. ' +
      (good ? '예측력이 통계적으로 확인됩니다. ' : '예측력이 통계적으로 확인되지 않습니다. ') +
      (beat ? '비용을 물린 뒤에도 동일가중 벤치마크보다 나았습니다(연 ' +
        U.signPct(pf.net.cagr - pf.benchmark.cagr, 1) + '). '
        : '비용을 물리면 벤치마크에 뒤집니다. 회전율을 줄이거나 예측시계를 늘려 보세요. ') +
      '비용 전과 비용 후의 차이는 ' + U.signPct(pf.gross.total - pf.net.total, 1) + '입니다.' +
      '</div>' +
      '<p class="small">IC가 0.3을 넘으면 정상적인 시장 데이터에서는 나오기 어렵습니다. 그럴 땐 성공이 아니라 ' +
      '누수를 의심해야 합니다. 파이썬에서 <code>--permute-labels</code> 로 정답을 뒤섞어 다시 돌려 보면 ' +
      'IC가 0 근처로 떨어지는지 확인할 수 있습니다.</p>';
  }

  function movingAvg(a, w) {
    const out = new Array(a.length).fill(null);
    let s = 0, c = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v !== null && isFinite(v)) { s += v; c++; }
      if (i >= w) {
        const old = a[i - w];
        if (old !== null && isFinite(old)) { s -= old; c--; }
      }
      out[i] = c > 0 ? s / c : null;
    }
    return out;
  }

  /* ========================================================================
   *  여러 종목 모의투자
   * ======================================================================*/
  function priceRow(dateStr) {
    const i = Q.priceRow[dateStr];
    return i === undefined ? null : Q.data.prices[i];
  }

  function startSim() {
    const d = Q.data;
    const cash = +$('#qtCash').value;
    const fee = (+$('#qtFee').value) / 100;
    const topK = +$('#qtTopK').value;

    // 가격이 있는 리밸런싱 날짜만 씁니다.
    const steps = [];
    d.score_dates.forEach(function (ds, i) {
      if (priceRow(ds)) steps.push({ date: ds, scoreIdx: i });
    });
    if (steps.length < 5) { status('가격과 점수가 맞는 날짜가 부족합니다.'); return; }

    Q.sim = {
      steps: steps, i: 0, fee: fee, topK: topK, initial: cash,
      ai: { cash: cash, w: {}, trades: 0, cost: 0 },
      me: { cash: cash, w: {}, trades: 0, cost: 0 },
      bh: { cash: cash, w: {}, trades: 0, cost: 0 },
      hist: { dates: [], ai: [], me: [], bh: [] },
      mySel: {}, log: []
    };
    // 벤치마크는 첫날 전 종목 동일가중으로 담고 그대로 둡니다.
    rebalance(Q.sim.bh, allTickers(0), Q.sim, true);
    record();
    $('#qtSimBoard').classList.remove('hidden');
    renderSim();
  }

  function allTickers(stepIdx) {
    const px = priceRow(Q.sim.steps[stepIdx].date);
    const out = [];
    Q.data.tickers.forEach(function (t, j) { if (px[j] !== null && isFinite(px[j])) out.push(j); });
    return out;
  }

  function aiPicks(stepIdx, k) {
    const s = Q.data.scores[Q.sim.steps[stepIdx].scoreIdx];
    const px = priceRow(Q.sim.steps[stepIdx].date);
    const idx = [];
    for (let j = 0; j < s.length; j++) {
      if (s[j] !== null && isFinite(s[j]) && px[j] !== null && isFinite(px[j])) idx.push(j);
    }
    idx.sort(function (a, b) { return s[b] - s[a]; });
    return idx.slice(0, k);
  }

  // 목표 종목들을 동일가중으로 담습니다. 바뀐 비중만큼 비용을 뗍니다.
  function rebalance(pf, targetIdx, sim, silent) {
    const value = portfolioValue(pf, sim.i);
    if (value <= 0) return;
    const nw = {};
    if (targetIdx.length) {
      const each = 1 / targetIdx.length;
      targetIdx.forEach(function (j) { nw[j] = each; });
    }
    let turnover = 0;
    const keys = {};
    Object.keys(pf.w).forEach(function (j) { keys[j] = 1; });
    Object.keys(nw).forEach(function (j) { keys[j] = 1; });
    Object.keys(keys).forEach(function (j) { turnover += Math.abs((nw[j] || 0) - (pf.w[j] || 0)); });
    const cost = value * turnover * sim.fee;
    pf.cost += cost;
    // 비중이 1% 넘게 바뀐 경우만 '갈아탔다'고 셉니다.
    // (가격이 움직여 생기는 아주 작은 조정까지 세면 거래 횟수가 부풀려집니다)
    if (turnover > 0.01) pf.trades++;
    pf.value = value - cost;
    pf.w = nw;
    if (!silent) pf.lastTurnover = turnover;
  }

  function portfolioValue(pf, stepIdx) {
    if (pf.value === undefined) return pf.cash;
    return pf.value;
  }

  // 한 스텝 진행: 지금 담고 있는 비중대로 다음 리밸런싱 날짜까지 수익을 반영합니다.
  function advance(pf, from, to) {
    const p0 = priceRow(Q.sim.steps[from].date), p1 = priceRow(Q.sim.steps[to].date);
    let r = 0, wsum = 0;
    Object.keys(pf.w).forEach(function (j) {
      const a = p0[j], b = p1[j];
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) return;
      r += pf.w[j] * (b / a - 1);
      wsum += pf.w[j];
    });
    pf.value = (pf.value === undefined ? pf.cash : pf.value) * (1 + r);
    // 비중 드리프트
    const nw = {};
    Object.keys(pf.w).forEach(function (j) {
      const a = p0[j], b = p1[j];
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) { nw[j] = pf.w[j]; return; }
      nw[j] = pf.w[j] * (b / a) / (1 + r);
    });
    pf.w = nw;
  }

  function record() {
    const s = Q.sim;
    s.hist.dates.push(s.steps[s.i].date);
    s.hist.ai.push(portfolioValue(s.ai, s.i));
    s.hist.me.push(portfolioValue(s.me, s.i));
    s.hist.bh.push(portfolioValue(s.bh, s.i));
  }

  function stepOnce(followAI) {
    const s = Q.sim;
    if (s.i >= s.steps.length - 1) return false;

    // (1) 이번 날짜에 갈아탑니다 — AI는 자동, 나는 내가 고른 종목대로
    rebalance(s.ai, aiPicks(s.i, s.topK), s);
    const mine = Object.keys(s.mySel).filter(function (j) { return s.mySel[j]; }).map(Number);
    if (followAI) {
      const picks = aiPicks(s.i, s.topK);
      s.mySel = {};
      picks.forEach(function (j) { s.mySel[j] = true; });
      rebalance(s.me, picks, s);
    } else {
      rebalance(s.me, mine, s);
    }

    // (2) 다음 날짜까지 굴립니다
    advance(s.ai, s.i, s.i + 1);
    advance(s.me, s.i, s.i + 1);
    advance(s.bh, s.i, s.i + 1);
    s.i += 1;
    record();
    return true;
  }

  function renderSim() {
    const s = Q.sim, d = Q.data;
    const step = s.steps[s.i];
    const done = s.i >= s.steps.length - 1;

    const myVal = portfolioValue(s.me, s.i);
    $('#qtEquityNow').textContent = U.won(myVal);
    const pl = myVal / s.initial - 1;
    const sub = $('#qtEquitySub');
    sub.textContent = '시작 ' + U.won(s.initial) + ' 대비 ' + U.signPct(pl, 2);
    sub.className = 'sub ' + (pl >= 0 ? 'up' : 'down');
    $('#qtDate').textContent = step.date;
    $('#qtStepInfo').textContent = '리밸런싱 ' + (s.i + 1) + ' / ' + s.steps.length +
      ' · 내 거래 ' + s.me.trades + '회 (비용 ' + U.won(s.me.cost) + ')';
    $('#qtAiVal').textContent = U.won(portfolioValue(s.ai, s.i));
    $('#qtBhVal').textContent = U.won(portfolioValue(s.bh, s.i));

    $$('#qtSimBoard [data-qstep]').forEach(function (b) { b.disabled = done; });
    $('#qtPickAll').disabled = done;

    // 종목 고르기 표 (AI 점수 순)
    const scores = d.scores[step.scoreIdx];
    const px = priceRow(step.date);
    const rank = [];
    for (let j = 0; j < d.tickers.length; j++) {
      if (scores[j] === null || px[j] === null) continue;
      rank.push(j);
    }
    rank.sort(function (a, b) { return scores[b] - scores[a]; });
    const aiSet = {};
    aiPicks(s.i, s.topK).forEach(function (j) { aiSet[j] = 1; });

    const rows = rank.slice(0, 20).map(function (j, r) {
      const cb = U.el('input');
      cb.type = 'checkbox'; cb.checked = !!s.mySel[j]; cb.dataset.tic = j;
      cb.disabled = done;
      cb.addEventListener('change', function () { s.mySel[j] = cb.checked; });
      const wrap = U.el('label', 'check');
      wrap.appendChild(cb);
      wrap.appendChild(document.createTextNode(' 담기'));
      return [(r + 1) + '위', d.tickers[j], U.fmt(scores[j], 2),
        aiSet[j] ? '<span class="up">AI 매수</span>' : '', U.comma(px[j]), wrap];
    });
    const tw = $('#qtPickTable'); tw.innerHTML = '';
    tw.appendChild(U.table(['순위', '종목', 'AI 점수', 'AI 선택', '가격', '내 포트폴리오'], rows));

    // 자산 곡선
    const labels = s.hist.dates.map(function (x) { return x.slice(2, 7); });
    const series = [
      { name: '내 포트폴리오', values: s.hist.me, color: C.seriesColor(0) },
      { name: 'AI 포트폴리오', values: s.hist.ai, color: C.seriesColor(1) },
      { name: '동일가중 벤치마크', values: s.hist.bh, color: C.seriesColor(2), dash: [5, 4] }
    ];
    C.line($('#qtSimChart'), {
      labels: labels, series: series, zeroLine: s.initial,
      yFmt: function (v) { return U.compact(v); }, tipFmt: function (v) { return U.won(v); }
    });
    const lg = $('#qtSimLegend'); lg.innerHTML = '';
    lg.appendChild(C.legend(series.map(function (x) { return { name: x.name, color: x.color }; })));

    // 성적표
    const mk = function (name, series2, pf) {
      const tot = series2[series2.length - 1] / s.initial - 1;
      const rets = [];
      for (let i = 1; i < series2.length; i++) rets.push(series2[i] / series2[i - 1] - 1);
      const perf = root.M.perf(rets);
      // 리밸런싱 간격(영업일)을 감안해 연율화합니다.
      const per_year = 252 / Math.max(1, d.meta.rebalance);
      const mu = rets.length ? rets.reduce(function (a, b) { return a + b; }, 0) / rets.length : 0;
      const sd = U.std(rets);
      return [name, U.won(series2[series2.length - 1]),
        '<span class="' + (tot >= 0 ? 'up' : 'down') + '">' + U.signPct(tot, 2) + '</span>',
        sd > 0 ? U.fmt(mu / sd * Math.sqrt(per_year), 2) : '—',
        U.pct(perf.mdd, 1), U.comma(pf.trades), U.won(pf.cost)];
    };
    const st = $('#qtSimTable'); st.innerHTML = '';
    st.appendChild(U.table(['구분', '평가금액', '누적수익', '샤프', '최대낙폭', '거래', '누적비용'], [
      mk('내 포트폴리오', s.hist.me, s.me),
      mk('AI 포트폴리오', s.hist.ai, s.ai),
      mk('동일가중 벤치마크', s.hist.bh, s.bh)
    ]));

    if (done) {
      const res = [['내 포트폴리오', s.hist.me], ['AI 포트폴리오', s.hist.ai], ['동일가중 벤치마크', s.hist.bh]]
        .map(function (r) { return { n: r[0], v: r[1][r[1].length - 1] }; })
        .sort(function (a, b) { return b.v - a.v; });
      status('끝까지 진행했습니다. 1위는 ' + res[0].n + ' (' + U.won(res[0].v) + ') 입니다. ' +
        res.map(function (r) { return r.n + ' ' + U.signPct(r.v / s.initial - 1, 1); }).join(' / '));
    }
  }

  /* ------------------------------------------------------------------------
   *  화면 연결
   * ----------------------------------------------------------------------*/
  function init() {
    if (!$('#panel-quant')) return;

    $('#qtSample').addEventListener('click', loadSample);

    $('#qtFile').addEventListener('change', function () {
      const f = this.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        try {
          setData(JSON.parse(rd.result), f.name);
          status(f.name + ' 를 불러왔습니다.');
        } catch (e) {
          status('불러오지 못했습니다: ' + e.message);
        }
      };
      rd.readAsText(f, 'utf-8');
    });

    $('#qtStart').addEventListener('click', function () {
      if (!Q.data) { status('먼저 결과 파일을 불러오세요.'); return; }
      startSim();
      status('모의투자를 시작했습니다. 종목을 고르고 "다음 리밸런싱"을 누르세요.');
    });

    $('#qtPickAll').addEventListener('click', function () {
      if (!Q.sim) return;
      Q.sim.mySel = {};
      aiPicks(Q.sim.i, Q.sim.topK).forEach(function (j) { Q.sim.mySel[j] = true; });
      renderSim();
    });

    $$('#panel-quant [data-qstep]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!Q.sim) return;
        const follow = $('#qtFollow').checked;
        const n = b.dataset.qstep === 'end' ? 10000 : +b.dataset.qstep;
        for (let i = 0; i < n; i++) { if (!stepOnce(follow)) break; }
        renderSim();
      });
    });

    // 페이지를 열면 샘플이 있을 때 자동으로 보여 줍니다.
    if (root.SAMPLE_QUANT) {
      try { loadSample(); status('내장 샘플을 표시하고 있습니다. 직접 학습한 결과 파일을 올리면 그 결과로 바뀝니다.'); }
      catch (e) { /* 무시 */ }
    } else {
      status('quant 파이프라인으로 학습한 뒤 runs/<이름>/web_export.json 을 올리세요.');
    }
  }

  root.quant = { init: init, state: Q };
})(window.FRSP = window.FRSP || {});
