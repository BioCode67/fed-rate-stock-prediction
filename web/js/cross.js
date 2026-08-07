/* ============================================================================
 *  cross.js — 종목 순위 예측 포트폴리오 (Phase 3 대응)
 *
 *  실무는 "지수가 오를까"를 맞히지 않습니다. 여러 종목 중 어느 것이 상대적으로
 *  더 오를지 '순위'를 예측해 상위를 삽니다. 그것을 축소해서 재현합니다.
 *
 *  진행 방식 (매달 반복)
 *    1. 그 달 이전의 모든 (종목, 월) 데이터로 학습
 *    2. 이번 달 종목들의 '다음 달 수익률'을 예측
 *    3. 예측 상위 N종목을 동일비중으로 매수
 *    4. 실제 다음 달 수익률을 받고, 바뀐 종목만큼 거래비용을 뺌
 *  누수 방지: 특징은 그 달까지의 정보만, 목표는 다음 달. 학습은 언제나 과거만.
 *
 *  ★ 생존 편향(Survivorship Bias)
 *    지금 살아남은 종목만 넣으면 그동안 상장폐지된 회사가 빠져 성과가 실제보다
 *    좋게 나옵니다. 이 한계는 결과와 함께 항상 같이 밝혀야 합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, ML = root.ML, M = root.M;
  const X = {};

  X.FEATURES = ['mom_1m', 'mom_6m', 'mom_12m', 'vol_6m'];
  X.FEATURE_LABEL = {
    'mom_1m': '최근 1개월 수익률',
    'mom_6m': '최근 6개월 수익률',
    'mom_12m': '12개월 수익률(직전 1개월 제외)',
    'vol_6m': '최근 6개월 변동성'
  };

  /* --------------------------------------------------------------------------
   *  일별 가격 → 월말 가격
   * ------------------------------------------------------------------------*/
  function monthEnds(dates) {
    const idx = [], labels = [];
    for (let i = 0; i < dates.length; i++) {
      const isLast = (i === dates.length - 1) ||
        (dates[i + 1].getUTCMonth() !== dates[i].getUTCMonth()) ||
        (dates[i + 1].getUTCFullYear() !== dates[i].getUTCFullYear());
      if (isLast) { idx.push(i); labels.push(U.dstr(dates[i]).slice(0, 7)); }
    }
    return { idx: idx, labels: labels };
  }

  /* --------------------------------------------------------------------------
   *  월별 패널 만들기 — (종목 × 월) 한 줄씩
   * ------------------------------------------------------------------------*/
  X.buildPanel = function (uni) {
    const me = monthEnds(uni.dates);
    const nM = me.idx.length;
    const rows = [];
    uni.tickers.forEach(function (t) {
      const c = uni.close[t];
      const mc = new Float64Array(nM);
      for (let k = 0; k < nM; k++) mc[k] = c[me.idx[k]];
      const mret = new Float64Array(nM); mret.fill(NaN);
      for (let k = 1; k < nM; k++) mret[k] = mc[k] / mc[k - 1] - 1;

      for (let k = 12; k < nM - 1; k++) {
        const mom1 = mret[k];
        const mom6 = mc[k] / mc[k - 6] - 1;
        const mom12 = mc[k - 1] / mc[k - 12] - 1;
        let mu = 0, cnt = 0;
        for (let q = k - 5; q <= k; q++) { if (isFinite(mret[q])) { mu += mret[q]; cnt++; } }
        mu = cnt ? mu / cnt : NaN;
        let v = 0;
        for (let q = k - 5; q <= k; q++) { if (isFinite(mret[q])) v += Math.pow(mret[q] - mu, 2); }
        const vol6 = cnt > 1 ? Math.sqrt(v / (cnt - 1)) : NaN;
        const target = mret[k + 1];                    // 다음 달 수익률 (미래)
        if (![mom1, mom6, mom12, vol6, target].every(isFinite)) continue;
        rows.push({
          m: k, month: me.labels[k], ticker: t,
          x: Float64Array.from([mom1, mom6, mom12, vol6]),
          y: target
        });
      }
    });
    rows.sort(function (a, b) { return a.m - b.m; });
    return { rows: rows, months: me.labels, nMonths: nM, monthIdx: me.idx };
  };

  /* --------------------------------------------------------------------------
   *  워크포워드 포트폴리오
   * ------------------------------------------------------------------------*/
  X.run = async function (panel, uni, opt) {
    opt = opt || {};
    const modelId = opt.modelId || 'boosting';
    const topN = opt.topN || 5;
    const warmup = opt.warmupMonths || 36;
    const cost = (opt.costPerSide === undefined ? 0.0005 : opt.costPerSide);

    const byMonth = {};
    panel.rows.forEach(function (r) { (byMonth[r.m] = byMonth[r.m] || []).push(r); });
    const monthKeys = Object.keys(byMonth).map(Number).sort(function (a, b) { return a - b; });
    const testMonths = monthKeys.filter(function (m) { return m >= (monthKeys[0] + warmup); });

    const out = { months: [], strat: [], ew: [], bench: [], picks: [], turnover: [], ic: [] };
    let prev = {};
    const total = testMonths.length;

    for (let s = 0; s < testMonths.length; s++) {
      const m = testMonths[s];
      const train = panel.rows.filter(function (r) { return r.m < m; });
      const test = byMonth[m];
      if (train.length < 200 || test.length < topN + 2) continue;

      const model = ML.createReg(modelId, { featureCols: X.FEATURES, seed: opt.seed || 42 });
      model.fit(train.map(function (r) { return r.x; }), Float64Array.from(train.map(function (r) { return r.y; })));
      const pred = model.predict(test.map(function (r) { return r.x; }));

      const ranked = test.map(function (r, i) { return { r: r, p: pred[i] }; })
        .sort(function (a, b) { return b.p - a.p; });
      const picks = ranked.slice(0, topN);

      let gross = 0;
      picks.forEach(function (o) { gross += o.r.y; });
      gross /= picks.length;

      const held = {};
      picks.forEach(function (o) { held[o.r.ticker] = 1; });
      let changed = 0;
      Object.keys(held).forEach(function (t) { if (!prev[t]) changed++; });
      const turnover = changed / topN;
      const c = turnover * 2 * cost;                    // 바뀐 비중만큼 왕복 비용

      let ew = 0;
      test.forEach(function (r) { ew += r.y; });
      ew /= test.length;

      // 예측이 실제 순위와 얼마나 맞았는지 (정보계수, IC)
      const ic = U.pearson(ranked.map(function (o) { return o.p; }), ranked.map(function (o) { return o.r.y; }));

      out.months.push(panel.months[m]);
      out.strat.push(gross - c);
      out.ew.push(ew);
      out.turnover.push(turnover);
      out.ic.push(ic.r);
      out.picks.push({ month: panel.months[m], names: picks.map(function (o) { return o.r.ticker; }), ret: gross });
      prev = held;

      if (opt.onProgress) opt.onProgress((s + 1) / total, s + 1, total);
      if (s % 3 === 0) await U.yield_();
    }

    // 벤치마크 지수가 있으면 같은 달의 지수 수익률도 담아 둡니다.
    // (지수가 없으면 '전체 종목 동일가중'이 비교 대상이 됩니다.)
    if (uni.bench) {
      const me = panel.monthIdx;
      out.bench = out.months.map(function (lbl) {
        const k = panel.months.indexOf(lbl);
        if (k <= 0) return 0;
        const now = uni.bench[me[k]], before = uni.bench[me[k - 1]];
        return isFinite(now) && isFinite(before) && before > 0 ? now / before - 1 : 0;
      });
    }
    return out;
  };

  /* --------------------------------------------------------------------------
   *  성과 지표 (월간 수익률 → 연율화)
   * ------------------------------------------------------------------------*/
  X.perf = function (monthly) {
    const r = Array.from(monthly);
    const n = r.length;
    if (!n) return { total: NaN, cagr: NaN, sharpe: NaN, mdd: NaN, cum: [] };
    const cum = new Float64Array(n);
    let c = 1;
    for (let i = 0; i < n; i++) { c *= (1 + r[i]); cum[i] = c; }
    const mu = U.mean(r), sd = U.std(r);
    let peak = -Infinity, mdd = 0;
    for (let i = 0; i < n; i++) { if (cum[i] > peak) peak = cum[i]; const dd = cum[i] / peak - 1; if (dd < mdd) mdd = dd; }
    const years = n / 12;
    return {
      total: cum[n - 1] - 1,
      cagr: years > 0 ? Math.pow(cum[n - 1], 1 / years) - 1 : NaN,
      sharpe: sd > 0 ? (mu / sd) * Math.sqrt(12) : NaN,     // 월간 → 연 환산
      mdd: mdd, cum: cum, months: n
    };
  };

  root.X = X;
})(window.FRSP = window.FRSP || {});
