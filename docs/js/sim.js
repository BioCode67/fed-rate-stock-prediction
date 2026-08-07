/* ============================================================================
 *  sim.js — 알파 시뮬레이터 (WorldQuant BRAIN 방식)
 *
 *  IQC는 "수익률이 얼마냐"로 알파를 보지 않습니다. 롱숏 북을 만들어 매일
 *  굴린 다음, 아래 다섯 가지로 채점합니다.
 *
 *    Sharpe    수익 / 변동성 (연율)          제출 기준 1.25 이상
 *    Fitness   Sharpe × √(|수익률| / 회전율)  제출 기준 1.0 이상
 *    Turnover  하루에 북의 몇 %를 갈아치우나  1% ~ 70%
 *    Returns   연율 수익률 (북의 절반 기준)
 *    자기상관   내가 이미 낸 알파와 얼마나 닮았나  0.7 미만
 *
 *  Fitness가 왜 이렇게 생겼는지가 중요합니다. 회전율이 높으면 나눗셈의
 *  분모가 커져 점수가 깎입니다. 즉 "많이 사고팔아서 낸 성과"를 깎는 식입니다.
 *  실제 운용에서 회전율이 곧 비용이기 때문입니다.
 *
 *  북 만드는 순서 (BRAIN과 같습니다)
 *    알파 → 중립화 → 이상치 절단 → 비중 정규화(절대값 합 = 1) → 감쇠
 *  그날 종가까지의 정보로 비중을 정하고, 수익은 다음 날부터 반영합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const DATA = root.DATA;

  const SIM = {};

  // IQC(BRAIN) 제출 기준. 화면의 합격선도 이 값을 그대로 씁니다.
  SIM.GATE = {
    sharpe: 1.25,
    fitness: 1.0,
    turnoverMin: 0.01,
    turnoverMax: 0.70,
    selfCorr: 0.7
  };

  function neutralize(v, mode, univ) {
    const keys = univ.filter(function (t) { return isFinite(v[t]); });
    if (!keys.length) return {};
    const out = {};
    if (mode === 'none') {
      keys.forEach(function (t) { out[t] = v[t]; });
      return out;
    }
    const groups = {};
    keys.forEach(function (t) {
      const g = mode === 'sector' ? (DATA.sector(t) || '기타') : 'ALL';
      (groups[g] = groups[g] || []).push(t);
    });
    Object.keys(groups).forEach(function (g) {
      const m = groups[g].reduce(function (a, t) { return a + v[t]; }, 0) / groups[g].length;
      groups[g].forEach(function (t) { out[t] = v[t] - m; });
    });
    return out;
  }

  // 한 종목이 북의 maxW를 넘지 못하게 자릅니다(BRAIN의 truncation).
  function truncate(w, maxW) {
    if (!(maxW > 0) || maxW >= 1) return w;
    const keys = Object.keys(w);
    let changed = true, guard = 0;
    const out = {};
    keys.forEach(function (t) { out[t] = w[t]; });
    while (changed && guard++ < 8) {
      changed = false;
      let sum = 0;
      keys.forEach(function (t) { sum += Math.abs(out[t]); });
      if (!(sum > 0)) break;
      keys.forEach(function (t) {
        const share = Math.abs(out[t]) / sum;
        if (share > maxW) {
          out[t] = Math.sign(out[t]) * maxW * sum;
          changed = true;
        }
      });
      // 다시 정규화
      let s2 = 0;
      keys.forEach(function (t) { s2 += Math.abs(out[t]); });
      if (s2 > 0) keys.forEach(function (t) { out[t] = out[t] / s2; });
    }
    return out;
  }

  function normalize(v, univ) {
    let sum = 0;
    univ.forEach(function (t) { if (isFinite(v[t])) sum += Math.abs(v[t]); });
    if (!(sum > 0)) return {};
    const out = {};
    univ.forEach(function (t) { if (isFinite(v[t])) out[t] = v[t] / sum; });
    return out;
  }

  /* ------------------------------------------------------------------------
   *  본체
   *
   *  scoreAt(i) → {종목: 알파값}  (식 모드든 슬라이더 모드든 이 모양이면 됩니다)
   * ----------------------------------------------------------------------*/
  SIM.run = async function (scoreAt, opt, onProgress) {
    opt = opt || {};
    const lo = opt.lo, hi = opt.hi;
    const neut = opt.neutralize || 'market';
    const decay = Math.max(1, Math.round(opt.decay || 1));
    const maxW = opt.maxWeight || 0.10;

    const pnl = [], turn = [], dates = [];
    const nLong = [], nShort = [];
    let prev = {};                        // 어제 비중(오늘 시가 기준으로 흘러간 뒤)
    let decayBuf = [];                    // 최근 decay일치 비중

    for (let i = lo; i < hi; i++) {
      const univ = DATA.tradables(i);
      let a = scoreAt(i);
      if (!a) a = {};

      a = neutralize(a, neut, univ);
      let w = normalize(a, univ);
      w = truncate(w, maxW);

      // 감쇠 — 최근 며칠 비중을 평균 내 회전율을 낮춥니다
      if (decay > 1) {
        decayBuf.push(w);
        if (decayBuf.length > decay) decayBuf.shift();
        const acc = {};
        let wsum = 0;
        decayBuf.forEach(function (ww, k) {
          const weight = k + 1;                       // 최근일수록 무겁게
          wsum += weight;
          Object.keys(ww).forEach(function (t) { acc[t] = (acc[t] || 0) + weight * ww[t]; });
        });
        Object.keys(acc).forEach(function (t) { acc[t] /= wsum; });
        w = normalize(acc, univ);
      }

      // 회전율: 어제 비중에서 오늘 비중으로 옮기는 데 든 거래량(편도)
      const all = {};
      Object.keys(prev).forEach(function (t) { all[t] = 1; });
      Object.keys(w).forEach(function (t) { all[t] = 1; });
      let traded = 0;
      Object.keys(all).forEach(function (t) { traded += Math.abs((w[t] || 0) - (prev[t] || 0)); });
      turn.push(traded / 2);

      // 다음 날 수익
      let r = 0, nl = 0, ns = 0;
      Object.keys(w).forEach(function (t) {
        if (w[t] > 0) nl++; else if (w[t] < 0) ns++;
        const s = DATA.series(t);
        const p0 = s[i], p1 = s[i + 1];
        if (p0 === null || p1 === null || !isFinite(p0) || !isFinite(p1) || p0 <= 0) return;
        r += w[t] * (p1 / p0 - 1);
      });
      pnl.push(r);
      nLong.push(nl); nShort.push(ns);
      dates.push(DATA.state.dates[i]);

      // 가격 변화만큼 비중이 흘러갑니다(리밸런싱하지 않아도 바뀝니다)
      const drift = {};
      Object.keys(w).forEach(function (t) {
        const s = DATA.series(t);
        const p0 = s[i], p1 = s[i + 1];
        const g = (p0 === null || p1 === null || !isFinite(p0) || !isFinite(p1) || p0 <= 0) ? 1 : p1 / p0;
        drift[t] = w[t] * g;
      });
      prev = normalize(drift, Object.keys(drift));

      if (onProgress && (i - lo) % 40 === 0) {
        onProgress((i - lo) / (hi - lo));
        await root.U.yield_();
      }
    }

    return SIM.metrics(pnl, turn, dates, nLong, nShort);
  };

  /* ------------------------------------------------------------------------
   *  채점
   * ----------------------------------------------------------------------*/
  SIM.metrics = function (pnl, turn, dates, nLong, nShort) {
    const n = pnl.length;
    const mean = n ? pnl.reduce(function (a, b) { return a + b; }, 0) / n : 0;
    let q = 0;
    pnl.forEach(function (x) { q += (x - mean) * (x - mean); });
    const sd = n > 1 ? Math.sqrt(q / (n - 1)) : 0;

    const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : NaN;
    // 북의 절반(롱 쪽 자본)을 기준으로 수익률을 봅니다 — BRAIN과 같은 정의입니다.
    const returns = mean * 252 / 0.5;
    const turnover = turn.length ? turn.reduce(function (a, b) { return a + b; }, 0) / turn.length : 0;
    const fitness = isFinite(sharpe)
      ? sharpe * Math.sqrt(Math.abs(returns) / Math.max(turnover, 0.125)) : NaN;

    // 누적 손익과 최대낙폭 (북의 절반 대비)
    const cum = [];
    let acc = 0, peak = 0, mdd = 0;
    pnl.forEach(function (x) {
      acc += x / 0.5;
      cum.push(acc);
      if (acc > peak) peak = acc;
      if (acc - peak < mdd) mdd = acc - peak;
    });

    const tradedTotal = turn.reduce(function (a, b) { return a + b; }, 0) * 2;
    const margin = tradedTotal > 0 ? (acc * 0.5) / tradedTotal * 10000 : NaN;

    const avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };

    return {
      n: n, pnl: pnl, cum: cum, dates: dates,
      sharpe: sharpe, returns: returns, turnover: turnover, fitness: fitness,
      mdd: mdd, margin: margin,
      longs: Math.round(avg(nLong)), shorts: Math.round(avg(nShort)),
      // 표본을 반으로 갈라 앞뒤가 비슷한지 봅니다(안정성)
      halves: (function () {
        const h = Math.floor(n / 2);
        const f = function (arr) {
          const m = arr.reduce(function (a, b) { return a + b; }, 0) / (arr.length || 1);
          let v = 0;
          arr.forEach(function (x) { v += (x - m) * (x - m); });
          const s = arr.length > 1 ? Math.sqrt(v / (arr.length - 1)) : 0;
          return s > 0 ? (m / s) * Math.sqrt(252) : NaN;
        };
        return { first: f(pnl.slice(0, h)), second: f(pnl.slice(h)) };
      })()
    };
  };

  // 두 알파의 일별 손익이 얼마나 닮았는가 (IQC의 self-correlation)
  SIM.pnlCorr = function (a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 30) return NaN;
    const x = a.slice(a.length - n), y = b.slice(b.length - n);
    const mx = x.reduce(function (p, c) { return p + c; }, 0) / n;
    const my = y.reduce(function (p, c) { return p + c; }, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : NaN;
  };

  // 합격 여부 판정 — 화면 여러 곳에서 같은 기준을 쓰기 위해 여기 둡니다.
  SIM.grade = function (m, selfCorr) {
    const G = SIM.GATE;
    const checks = [
      { key: 'sharpe', label: 'Sharpe', value: m.sharpe, fmt: function (v) { return v.toFixed(2); },
        pass: m.sharpe >= G.sharpe, need: '≥ ' + G.sharpe,
        why: '수익을 변동성으로 나눈 값. 얼마나 꾸준했는가.' },
      { key: 'fitness', label: 'Fitness', value: m.fitness, fmt: function (v) { return v.toFixed(2); },
        pass: m.fitness >= G.fitness, need: '≥ ' + G.fitness,
        why: 'Sharpe × √(|수익률| / max(회전율, 12.5%)). 많이 사고팔아 낸 성과를 깎습니다. 바닥이 있어 무한정 낮춘다고 좋아지지는 않습니다.' },
      { key: 'turnover', label: 'Turnover', value: m.turnover, fmt: function (v) { return (v * 100).toFixed(1) + '%'; },
        pass: m.turnover >= G.turnoverMin && m.turnover <= G.turnoverMax,
        need: (G.turnoverMin * 100) + '~' + (G.turnoverMax * 100) + '%',
        why: '하루에 북의 몇 %를 갈아치우나. 너무 높으면 비용, 너무 낮으면 신호가 없는 것입니다.' }
    ];
    if (selfCorr !== undefined && isFinite(selfCorr)) {
      checks.push({ key: 'selfCorr', label: '자기상관', value: selfCorr,
        fmt: function (v) { return v.toFixed(2); },
        pass: selfCorr < G.selfCorr, need: '< ' + G.selfCorr,
        why: '내가 이미 낸 알파와 손익이 얼마나 닮았나. 닮으면 새 알파로 쳐 주지 않습니다.' });
    }
    return { checks: checks, pass: checks.every(function (c) { return c.pass; }) };
  };

  root.SIM = SIM;
})(window.QL = window.QL || {});
