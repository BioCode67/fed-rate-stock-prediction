/* ============================================================================
 *  backtest.js — 검증과 모의투자 계산
 *   1) 시간순 분할 검증 (앞 80% 학습 → 뒤 20% 시험)      … Phase 1-a 방식
 *   2) 워크포워드 검증 (50일마다 새 데이터로 재학습)       … Phase 1-b 방식
 *   3) 거래비용을 물린 백테스트                            … Phase 1-b 방식
 *
 *  누수 방지 규칙 (아주 중요)
 *   - 학습은 언제나 '그 시점까지'의 데이터만 씁니다.
 *   - 오늘 들고 있을 포지션은 '어제 만든 예측'으로 정합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, ML = root.ML, M = root.M;
  const B = {};

  function slice(X, a, b) { return X.slice(a, b); }

  /* --------------------------------------------------------------------------
   *  [1] 시간순 분할 검증
   * ------------------------------------------------------------------------*/
  B.holdout = function (sup, modelId, opt) {
    opt = opt || {};
    const ratio = opt.trainRatio || 0.8;
    const split = Math.floor(sup.n * ratio);
    const Xtr = slice(sup.X, 0, split), Xte = slice(sup.X, split, sup.n);
    const ytr = sup.y.slice(0, split), yte = sup.y.slice(split, sup.n);

    const model = ML.create(modelId, Object.assign({ featureCols: sup.featureCols }, opt.modelOpt || {}));
    const t0 = performance.now();
    model.fit(Xtr, ytr);
    const trainMs = performance.now() - t0;
    const proba = model.predictProba(Xte);
    const met = M.classify(yte, proba, opt.threshold);
    return {
      modelId: modelId, split: split, proba: proba, yTest: yte,
      metrics: met, importance: model.importance ? model.importance() : null,
      trainMs: trainMs, roc: M.rocCurve(yte, proba)
    };
  };

  /* --------------------------------------------------------------------------
   *  [2] 워크포워드 검증 (확장 윈도우)
   *   - 전체의 startFrac 지점부터 시작
   *   - 다음 step일을 그 시점 모델로 예측
   *   - 그 구간의 실제값을 학습셋에 넣고 재학습 → 반복
   *  화면이 멈추지 않도록 재학습 사이사이에 잠깐 양보(await)합니다.
   * ------------------------------------------------------------------------*/
  B.walkForward = async function (sup, modelId, opt) {
    opt = opt || {};
    const startFrac = opt.startFrac || 0.6;
    const step = opt.step || 60;
    const n = sup.n;
    const start = Math.floor(n * startFrac);
    const proba = new Float64Array(n); proba.fill(NaN);
    let retrains = 0;
    const total = Math.ceil((n - start) / step);
    const t0 = performance.now();

    for (let i = start; i < n; i += step) {
      const end = Math.min(i + step, n);
      const model = ML.create(modelId, Object.assign({ featureCols: sup.featureCols }, opt.modelOpt || {}));
      model.fit(slice(sup.X, 0, i), sup.y.slice(0, i));      // 미래를 절대 보지 않음
      const pr = model.predictProba(slice(sup.X, i, end));
      for (let k = 0; k < pr.length; k++) proba[i + k] = pr[k];
      retrains++;
      if (opt.onProgress) opt.onProgress(retrains / total, retrains, total);
      await U.yield_();
    }
    const yTest = sup.y.slice(start, n);
    const pTest = proba.slice(start, n);
    return {
      modelId: modelId, start: start, proba: proba, retrains: retrains,
      metrics: M.classify(yTest, pTest, opt.threshold),
      roc: M.rocCurve(yTest, pTest),
      elapsedMs: performance.now() - t0
    };
  };

  /* --------------------------------------------------------------------------
   *  [3] 백테스트
   *  전략: 모델이 '오른다'고 하면 지수 보유(1), 아니면 현금(0). 공매도 없음.
   *  비용: 포지션이 바뀐 날에만 (수수료 + 슬리피지)를 뺍니다.
   * ------------------------------------------------------------------------*/
  B.backtest = function (sup, proba, start, opt) {
    opt = opt || {};
    const cost = (opt.costPerSide === undefined ? 0.0005 : opt.costPerSide);
    const slip = (opt.slippage === undefined ? 0.0005 : opt.slippage);
    const th = (opt.threshold === undefined ? 0.5 : opt.threshold);
    const n = sup.n;
    const dates = [], strat = [], bh = [], pos = [], trade = [], costs = [];
    let prev = 0;
    for (let t = start + 1; t < n; t++) {
      const p = proba[t - 1];                       // 어제 만든 예측으로 오늘 포지션 결정
      if (!isFinite(p)) continue;
      const position = p >= th ? 1 : 0;
      const mkt = sup.ret[t];
      const tr = Math.abs(position - prev);
      const c = (cost + slip) * tr;
      dates.push(sup.dates[t]);
      pos.push(position);
      trade.push(tr);
      costs.push(c);
      strat.push(position * mkt - c);
      bh.push(mkt);
      prev = position;
    }
    const ps = M.perf(strat), pb = M.perf(bh);
    // 비용을 물리지 않았다면?
    const gross = strat.map(function (v, i) { return v + costs[i]; });
    return {
      dates: dates, strat: strat, bh: bh, pos: pos, trade: trade, cost: costs,
      perfStrat: ps, perfBH: pb, perfGross: M.perf(gross),
      nTrades: U.sum(trade), exposure: U.mean(pos),
      totalCost: U.sum(costs)
    };
  };

  // 거래비용을 바꿔가며 전략이 언제 매수후보유에 지는지 확인
  B.costSweep = function (sup, proba, start, levels, opt) {
    return levels.map(function (lv) {
      const r = B.backtest(sup, proba, start, Object.assign({}, opt, { costPerSide: lv / 2, slippage: lv / 2 }));
      return { level: lv, strat: r.perfStrat.total, bh: r.perfBH.total, sharpe: r.perfStrat.sharpe };
    });
  };

  root.B = B;
})(window.FRSP = window.FRSP || {});
