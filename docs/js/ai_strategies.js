/* ============================================================================
 *  ai_strategies.js — AI 모델로 종목 고르기
 *
 *  실제 퀀트 운용에서 AI를 쓰는 방식 그대로입니다.
 *
 *    1. 날짜마다 종목별로 팩터를 계산한다 (모멘텀·변동성·추세·RSI…)
 *    2. 그 팩터를 '그날 종목들 사이의 순위'로 바꾼다 (횡단면 정규화)
 *    3. 정답은 "N일 뒤 남들보다 잘했는가"로 만든다 (시장 방향이 아니라 상대 성과)
 *    4. 과거 구간으로 학습하고, 그 다음 구간을 예측한다 (워크포워드)
 *    5. 일정 기간마다 새 데이터로 다시 학습한다
 *
 *  누수를 막는 두 장치
 *    purge   : 정답이 N일 뒤를 보므로, 학습 마지막 N일은 예측 구간과 겹칩니다. 잘라냅니다.
 *    embargo : 겹치지 않아도 바로 옆 날짜는 너무 닮아 있어 며칠 더 비웁니다.
 *
 *  ★ AI가 고전 팩터를 이기지 못하는 경우가 많습니다. 그것도 정직한 결과입니다.
 *    화면은 이긴 쪽을 편들지 않고 숫자를 그대로 보여 줍니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, DATA = root.DATA, STRAT = root.STRAT, ML = root.ML;
  const IND = STRAT.IND;

  // 학습에 쓰는 팩터 (모두 i시점까지의 정보만)
  const FEATURES = [
    { key: 'mom12_1', name: '모멘텀(12-1개월)', fn: function (s, i) { return IND.mom12_1(s, i); } },
    { key: 'mom21', name: '1개월 모멘텀', fn: function (s, i) { return IND.mom(s, i, 21); } },
    { key: 'mom5', name: '1주 모멘텀', fn: function (s, i) { return IND.mom(s, i, 5); } },
    { key: 'vol120', name: '변동성(6개월)', fn: function (s, i) { return IND.vol(s, i, 120); } },
    { key: 'vol20', name: '변동성(1개월)', fn: function (s, i) { return IND.vol(s, i, 20); } },
    { key: 'trend', name: '추세(50일/200일)', fn: function (s, i) {
        const a = IND.ma(s, i, 50), b = IND.ma(s, i, 200);
        return (isFinite(a) && isFinite(b) && b > 0) ? a / b - 1 : NaN; } },
    { key: 'rsi', name: 'RSI(14일)', fn: function (s, i) { return IND.rsi(s, i, 14); } },
    { key: 'dd', name: '고점 대비 낙폭', fn: function (s, i) { return IND.drawdown(s, i, 126); } },
    { key: 'vratio', name: '거래량 급증', fn: function (s, i, t) {
        const v = DATA.state.volume[t];
        if (!v) return NaN;
        let a = 0, ca = 0, b = 0, cb = 0;
        for (let k = Math.max(0, i - 4); k <= i; k++) if (v[k] !== null && isFinite(v[k])) { a += v[k]; ca++; }
        for (let k = Math.max(0, i - 59); k <= i; k++) if (v[k] !== null && isFinite(v[k])) { b += v[k]; cb++; }
        return (ca && cb && b > 0) ? (a / ca) / (b / cb) - 1 : NaN; } }
  ];

  const cache = {};          // i → {tickers, X}
  function featuresAt(i) {
    if (cache[i]) return cache[i];
    const tickers = DATA.tradables(i);
    const raw = FEATURES.map(function () { return {}; });
    tickers.forEach(function (t) {
      const s = DATA.series(t);
      FEATURES.forEach(function (f, j) {
        const v = f.fn(s, i, t);
        if (isFinite(v)) raw[j][t] = v;
      });
    });
    // 팩터마다 그날 종목들 사이의 순위로 바꿉니다(-1~1).
    const ranked = raw.map(function (m) { return STRAT.rankMap(m); });
    const keep = [], X = [];
    tickers.forEach(function (t) {
      const row = new Float64Array(FEATURES.length);
      let ok = true;
      for (let j = 0; j < FEATURES.length; j++) {
        if (ranked[j][t] === undefined) { ok = false; break; }
        row[j] = ranked[j][t];
      }
      if (ok) { keep.push(t); X.push(row); }
    });
    cache[i] = { tickers: keep, X: X };
    return cache[i];
  }

  // 정답: N일 뒤 '남들보다' 잘했으면 1, 아니면 0
  function labelsAt(i, h, tickers) {
    const fwd = {};
    tickers.forEach(function (t) {
      const s = DATA.series(t);
      const a = IND.px(s, i), b = IND.px(s, i + h);
      if (isFinite(a) && isFinite(b) && a > 0) fwd[t] = b / a - 1;
    });
    const keys = Object.keys(fwd);
    if (keys.length < 6) return null;
    const vals = keys.map(function (t) { return fwd[t]; }).sort(function (x, y) { return x - y; });
    const median = vals[Math.floor(vals.length / 2)];
    const y = {};
    keys.forEach(function (t) { y[t] = fwd[t] > median ? 1 : 0; });
    return y;
  }

  /* ------------------------------------------------------------------------
   *  AI 전략 만들기
   * ----------------------------------------------------------------------*/
  function makeAI(modelId, name, desc) {
    return {
      id: 'ai_' + modelId,
      name: name,
      cat: 'AI',
      desc: desc,
      featureNames: FEATURES.map(function (f) { return f.name; }),
      _pred: null,
      _importance: null,

      // 백테스트 전에 한 번 실행 — 워크포워드로 모든 예측을 미리 만들어 둡니다.
      prepare: async function (lo, hi, rebalanceDates, opt, onProgress) {
        const h = opt.horizon || 21;          // 며칠 뒤를 맞힐지
        const embargo = 5;
        const retrainEvery = opt.retrainEvery || 63;
        const sampleEvery = 5;                // 학습 표본을 5일 간격으로 뽑아 계산량을 줄입니다
        const minTrain = 252;

        this._pred = {};
        let model = null, lastTrain = -1e9, trained = 0;

        for (let r = 0; r < rebalanceDates.length; r++) {
          const i = rebalanceDates[r];

          if (i - lastTrain >= retrainEvery) {
            // 학습에 쓸 수 있는 마지막 날짜: 정답이 예측 시점과 겹치지 않는 곳까지
            const trainEnd = i - h - embargo;
            const trainStart = Math.max(260, trainEnd - (opt.trainWindow || 1000));
            if (trainEnd - trainStart >= minTrain) {
              const X = [], y = [];
              for (let d = trainStart; d <= trainEnd; d += sampleEvery) {
                const F = featuresAt(d);
                if (!F.tickers.length) continue;
                const lab = labelsAt(d, h, F.tickers);
                if (!lab) continue;
                F.tickers.forEach(function (t, k) {
                  if (lab[t] === undefined) return;
                  X.push(F.X[k]);
                  y.push(lab[t]);
                });
              }
              if (X.length > 400) {
                model = ML.create(modelId, {
                  featureCols: FEATURES.map(function (f) { return f.key; }),
                  classWeight: true, seed: 42,
                  trees: 60, maxDepth: 5, epochs: 60
                });
                model.fit(X, Int8Array.from(y));
                lastTrain = i;
                trained++;
                if (model.importance) this._importance = model.importance();
              }
            }
            await U.yield_();
          }

          if (model) {
            const F = featuresAt(i);
            if (F.tickers.length) {
              const p = model.predictProba(F.X);
              const out = {};
              F.tickers.forEach(function (t, k) { out[t] = p[k]; });
              this._pred[i] = out;
            }
          }
          if (onProgress) onProgress((r + 1) / rebalanceDates.length);
          if (r % 5 === 0) await U.yield_();
        }
        this._trained = trained;
        return { trained: trained };
      },

      score: function (i) { return (this._pred && this._pred[i]) || {}; }
    };
  }

  const AI_LIST = [
    makeAI('logistic', 'AI 로지스틱 회귀',
      '가장 단순한 AI입니다. 팩터들을 선형으로 결합해 "남들보다 잘할 확률"을 냅니다. ' +
      '해석이 쉬워서 실무에서 기준 모델로 자주 씁니다. 복잡한 모델이 이걸 못 이기면 쓸 이유가 없습니다.'),
    makeAI('forest', 'AI 랜덤포레스트',
      '결정나무 여러 그루의 평균입니다. 팩터끼리의 복잡한 조합(예: "모멘텀이 높으면서 변동성은 낮을 때")을 ' +
      '스스로 찾아냅니다. 금융 데이터처럼 잡음이 많은 곳에서 비교적 튼튼합니다.'),
    makeAI('boosting', 'AI 그래디언트부스팅',
      'XGBoost와 같은 계열입니다. 앞 나무가 틀린 부분을 다음 나무가 보완합니다. ' +
      '캐글 금융 대회 상위권이 가장 많이 쓰는 모델이지만, 그만큼 과적합하기도 쉽습니다.'),
    makeAI('mlp', 'AI 신경망(MLP)',
      '딥러닝 계열입니다. 은닉층을 거쳐 팩터를 비선형으로 조합합니다. ' +
      '데이터가 적은 금융에서는 트리 모델에 지는 경우가 많다는 점을 직접 확인해 보세요.')
  ];

  // 기존 전략 목록에 AI를 붙입니다.
  STRAT.list = STRAT.list.concat(AI_LIST);
  STRAT.aiFeatures = FEATURES;
  STRAT.featuresAt = featuresAt;      // 팩터 분석 화면에서 그대로 씁니다(캐시 공유)
  STRAT.clearAICache = function () { for (const k in cache) delete cache[k]; };
})(window.QL = window.QL || {});
