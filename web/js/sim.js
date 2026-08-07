/* ============================================================================
 *  sim.js — 모의투자 엔진
 *
 *  하루씩 넘기면서 직접 사고팔아 보고, 같은 기간을 같은 조건으로 달리는
 *  'AI 자동매매'와 '그냥 사서 들고 있기(Buy & Hold)'를 나란히 비교합니다.
 *
 *  규칙
 *   - 매매는 그날 종가로 체결되고, 살 때와 팔 때 각각 비용(수수료+슬리피지)을 뗍니다.
 *   - AI는 그날까지의 정보로 만든 예측(proba[t])만 보고 다음 날 포지션을 정합니다.
 *     즉 미래를 미리 알지 못합니다. (누수 없음)
 *   - 공매도·레버리지는 없습니다. 현금과 주식 사이만 오갑니다.
 *
 *  ★ 교육용입니다. 실제 투자 판단에 쓰지 마세요.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, M = root.M;
  const S = {};

  function Portfolio(cash, label) {
    this.cash = cash; this.shares = 0; this.label = label;
    this.trades = 0; this.costPaid = 0;
  }
  Portfolio.prototype.value = function (price) { return this.cash + this.shares * price; };
  Portfolio.prototype.weight = function (price) {
    const v = this.value(price);
    return v > 0 ? (this.shares * price) / v : 0;
  };
  // 목표 비중(0~1)에 맞춰 사고팝니다.
  Portfolio.prototype.rebalance = function (price, targetW, feeRate) {
    const v = this.value(price);
    if (v <= 0) return 0;
    const targetShares = (v * targetW) / price;
    const delta = targetShares - this.shares;
    if (Math.abs(delta * price) < v * 1e-4) return 0;       // 아주 작은 조정은 무시
    const notional = Math.abs(delta * price);
    const fee = notional * feeRate;
    this.cash -= delta * price + fee;
    this.shares += delta;
    this.trades += 1;
    this.costPaid += fee;
    return delta;
  };

  /* --------------------------------------------------------------------------
   *  시뮬레이터 만들기
   *  opt = { sup, proba, start, cash, feeRate, threshold, aiWeight }
   * ------------------------------------------------------------------------*/
  S.create = function (opt) {
    const sup = opt.sup;
    const start = opt.start;
    const feeRate = (opt.feeRate === undefined ? 0.001 : opt.feeRate);
    const cash = opt.cash || 10000000;

    const sim = {
      sup: sup, proba: opt.proba, start: start, feeRate: feeRate, initial: cash,
      threshold: (opt.threshold === undefined ? 0.5 : opt.threshold),
      aiWeight: (opt.aiWeight === undefined ? 1 : opt.aiWeight),
      t: start,
      user: new Portfolio(cash, '내 계좌'),
      ai: new Portfolio(cash, 'AI 자동매매'),
      bh: new Portfolio(cash, '사서 들고 있기'),
      hist: { dates: [], price: [], user: [], ai: [], bh: [], aiProba: [], userW: [], aiW: [] },
      log: []
    };

    // 매수후보유는 첫날 전액 매수
    sim.bh.rebalance(sup.close[start], 1, feeRate);
    S.record(sim);
    return sim;
  };

  S.price = function (sim) { return sim.sup.close[sim.t]; };
  S.date = function (sim) { return sim.sup.dates[sim.t]; };
  S.done = function (sim) { return sim.t >= sim.sup.n - 1; };
  S.aiProbaNow = function (sim) {
    const p = sim.proba ? sim.proba[sim.t] : NaN;
    return isFinite(p) ? p : NaN;
  };

  S.record = function (sim) {
    const px = S.price(sim);
    sim.hist.dates.push(S.date(sim));
    sim.hist.price.push(px);
    sim.hist.user.push(sim.user.value(px));
    sim.hist.ai.push(sim.ai.value(px));
    sim.hist.bh.push(sim.bh.value(px));
    sim.hist.aiProba.push(S.aiProbaNow(sim));
    sim.hist.userW.push(sim.user.weight(px));
    sim.hist.aiW.push(sim.ai.weight(px));
  };

  // 사용자 주문: 현금의 f배만큼 매수 (f = 0.25/0.5/1)
  S.buy = function (sim, f) {
    const px = S.price(sim);
    const v = sim.user.value(px);
    const targetValue = sim.user.shares * px + sim.user.cash * U.clamp(f, 0, 1);
    const w = v > 0 ? targetValue / v : 0;
    const before = sim.user.shares;
    sim.user.rebalance(px, U.clamp(w, 0, 1), sim.feeRate);
    if (sim.user.shares !== before) {
      sim.log.push({ date: S.date(sim), type: '매수', price: px, qty: sim.user.shares - before, value: sim.user.value(px) });
    }
    S.updateLast(sim);
  };

  // 사용자 주문: 보유 주식의 f배만큼 매도
  S.sell = function (sim, f) {
    const px = S.price(sim);
    const v = sim.user.value(px);
    const targetShares = sim.user.shares * (1 - U.clamp(f, 0, 1));
    const w = v > 0 ? (targetShares * px) / v : 0;
    const before = sim.user.shares;
    sim.user.rebalance(px, U.clamp(w, 0, 1), sim.feeRate);
    if (sim.user.shares !== before) {
      sim.log.push({ date: S.date(sim), type: '매도', price: px, qty: sim.user.shares - before, value: sim.user.value(px) });
    }
    S.updateLast(sim);
  };

  // 방금 체결한 거래를 현재 기록에 반영
  S.updateLast = function (sim) {
    const px = S.price(sim), h = sim.hist, k = h.dates.length - 1;
    if (k < 0) return;
    h.user[k] = sim.user.value(px);
    h.userW[k] = sim.user.weight(px);
  };

  /* --------------------------------------------------------------------------
   *  하루 넘기기
   *   1) AI가 오늘까지의 예측으로 내일 포지션을 정하고 (오늘 종가로 체결)
   *   2) 사용자가 'AI 자동매매 따라하기'를 켰다면 사용자 계좌도 같이 조정
   *   3) 날짜를 하루 넘기고 평가금액을 다시 계산
   * ------------------------------------------------------------------------*/
  S.step = function (sim, followAI) {
    if (S.done(sim)) return false;
    const px = S.price(sim);
    const p = S.aiProbaNow(sim);
    const targetW = isFinite(p) ? (p >= sim.threshold ? sim.aiWeight : 0) : sim.ai.weight(px);
    sim.ai.rebalance(px, targetW, sim.feeRate);
    if (followAI) sim.user.rebalance(px, targetW, sim.feeRate);
    S.updateLast(sim);
    sim.t += 1;
    S.record(sim);
    return true;
  };

  S.stepMany = function (sim, k, followAI) {
    let done = 0;
    for (let i = 0; i < k; i++) { if (!S.step(sim, followAI)) break; done++; }
    return done;
  };

  /* --------------------------------------------------------------------------
   *  성적 요약
   * ------------------------------------------------------------------------*/
  function toReturns(series) {
    const r = new Float64Array(Math.max(0, series.length - 1));
    for (let i = 1; i < series.length; i++) r[i - 1] = series[i] / series[i - 1] - 1;
    return r;
  }
  S.summary = function (sim) {
    const h = sim.hist;
    const mk = function (name, series, pf) {
      const perf = M.perf(toReturns(series));
      return {
        name: name,
        final: series[series.length - 1],
        total: series[series.length - 1] / sim.initial - 1,
        // 반년도 안 지난 구간을 연평균으로 환산하면 과장되므로 그때는 표시하지 않습니다.
        cagr: perf.years >= 0.5 ? perf.cagr : NaN,
        sharpe: perf.years >= 0.2 ? perf.sharpe : NaN, mdd: perf.mdd,
        trades: pf ? pf.trades : 0, cost: pf ? pf.costPaid : 0
      };
    };
    return [
      mk('내 계좌', h.user, sim.user),
      mk('AI 자동매매', h.ai, sim.ai),
      mk('사서 들고 있기', h.bh, sim.bh)
    ];
  };

  root.S = S;
})(window.FRSP = window.FRSP || {});
