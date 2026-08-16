/* ============================================================================
 *  bounce.js — 낙폭 반등 연구실
 *
 *  질문: "많이 떨어진 종목은 정말 반등하는가? 반등한다면 며칠 뒤에 파는 게 좋은가?"
 *
 *  이 화면은 다른 화면들과 질문의 종류가 다릅니다.
 *  알파 만들기·전략 실험실은 "매일 전 종목의 순위를 매겨 롱숏으로 담는" 방식이고,
 *  여기는 "어떤 사건이 일어난 뒤 며칠 동안 무슨 일이 벌어지는가"를 봅니다.
 *  학계에서 이벤트 스터디(event study)라고 부르는 방식입니다.
 *
 *  ★ 이 화면에서 제일 중요한 것은 반등 확률이 아니라 '기준선과의 차이'입니다.
 *
 *    "낙폭 후 20일 반등 확률 62%" — 이 숫자만 보면 대단해 보입니다.
 *    그런데 아무 날이나 아무 종목이나 사도 20일 뒤 오를 확률이 58%라면?
 *    낙폭은 4%p만 보탠 것이고, 그 정도는 거래비용에 묻힙니다.
 *    그래서 모든 표에 기준선을 나란히 놓았습니다. 기준선 없는 확률은 숫자 장난입니다.
 *
 *  ★ 신호 정의를 하나씩 바꿔 가며 제일 좋은 것을 고르는 것이 가장 흔한 함정입니다.
 *    그래서 '전부 비교' 모드를 따로 두었습니다. 열 가지를 한 화면에 나란히 놓으면
 *    "그중 하나는 우연히 좋다"는 사실이 눈에 보입니다. 하나씩 돌려 보면 안 보입니다.
 *
 *  ★ 생존 편향이 이 화면에서 가장 치명적입니다.
 *    데이터에는 '지금 나스닥100에 남아 있는 종목'만 있습니다.
 *    크게 떨어진 뒤 회복하지 못하고 지수에서 빠지거나 상장폐지된 회사는 아예 없습니다.
 *    즉 우리는 이미 '살아남은 종목의 낙폭'만 보고 있습니다.
 *    여기서 나오는 반등 확률은 실제보다 반드시 높습니다. 화면에도 그렇게 적어 둡니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, STRAT = root.STRAT;
  const IND = STRAT.IND;

  const HOLDOUT = 252;                     // 채점 구간(약 12개월)은 기본 분석에서 뺍니다
  const HORIZONS = [1, 3, 5, 10, 20, 40, 60];
  const DDWIN = 126;                       // 낙폭을 재는 창(약 6개월 고점 대비)
  const BASE_STEP = 3;                     // 기준선 표본은 3일 간격으로 (계산량을 줄입니다)
  const MARKET = 'QQQ';                    // 시장이 같이 빠졌는지 볼 때 쓰는 기준

  /* ------------------------------------------------------------------------
   *  신호 정의
   *
   *  학생들이 흔히 쓰는 기술적 지표를 그대로 담았습니다. 낙폭, RSI, 이동평균 이탈…
   *  중요한 것은 각각의 성적이 아니라, 열 가지를 나란히 놓았을 때
   *  "제일 좋은 것"이 매번 바뀐다는 사실입니다.
   * ----------------------------------------------------------------------*/
  const SIGNALS = [
    { id: 'dd10', name: '낙폭 -10%', group: '낙폭',
      desc: '6개월 고점 대비 10% 하락',
      fn: function (f, i) { return f.dd[i] <= -0.10; } },
    { id: 'dd20', name: '낙폭 -20%', group: '낙폭',
      desc: '6개월 고점 대비 20% 하락 — 흔히 말하는 조정',
      fn: function (f, i) { return f.dd[i] <= -0.20; } },
    { id: 'dd30', name: '낙폭 -30%', group: '낙폭',
      desc: '6개월 고점 대비 30% 하락 — 표본이 확 줄어듭니다',
      fn: function (f, i) { return f.dd[i] <= -0.30; } },
    { id: 'rsi30', name: 'RSI 30 미만', group: '기존 지표',
      desc: '교과서에 나오는 과매도 신호',
      fn: function (f, i) { return f.rsi[i] < 30; } },
    { id: 'rsi20', name: 'RSI 20 미만', group: '기존 지표',
      desc: '더 극단적인 과매도',
      fn: function (f, i) { return f.rsi[i] < 20; } },
    { id: 'ma20', name: '20일선 10% 아래', group: '기존 지표',
      desc: '단기 이동평균에서 크게 벌어진 상태',
      fn: function (f, i) { return f.g20[i] <= -0.10; } },
    { id: 'ma200', name: '200일선 아래로', group: '기존 지표',
      desc: '장기 추세를 막 이탈한 날 (하향 돌파)',
      fn: function (f, i) { return f.g200[i] < 0 && f.g200[i - 1] >= 0; } },
    { id: 'crash5', name: '5일 만에 -10%', group: '급락',
      desc: '일주일 사이 급락 — 놀라서 파는 구간',
      fn: function (f, i) { return f.m5[i] <= -0.10; } },
    { id: 'dd20v', name: '낙폭 -20% + 거래량 급증', group: '조합',
      desc: '투매가 동반된 하락. 흔히 바닥 신호라고들 합니다',
      fn: function (f, i) { return f.dd[i] <= -0.20 && f.vr[i] > 0.5; } },
    { id: 'dd20r', name: '낙폭 -20% + RSI 30', group: '조합',
      desc: '두 조건을 동시에 — 조건을 더하면 표본이 줄어듭니다',
      fn: function (f, i) { return f.dd[i] <= -0.20 && f.rsi[i] < 30; } }
  ];

  function sigOf(id) {
    return SIGNALS.filter(function (s) { return s.id === id; })[0] || SIGNALS[1];
  }

  // AI 모드에서 모델에게 주는 재료. 신호가 난 그 시점의 '상태'입니다.
  const AI_FEATS = [
    ['dd', '낙폭 깊이', function (f, i) { return f.dd[i]; }],
    ['rsi', 'RSI', function (f, i) { return f.rsi[i]; }],
    ['g20', '20일선 대비', function (f, i) { return f.g20[i]; }],
    ['g200', '200일선 대비', function (f, i) { return f.g200[i]; }],
    ['m5', '최근 5일 수익', function (f, i) { return f.m5[i]; }],
    ['vr', '거래량 급증도', function (f, i) { return f.vr[i]; }],
    ['vol', '변동성(1개월)', function (f, i) { return f.vol[i]; }],
    ['mkt', '그때 시장 낙폭', function (f, i, m) { return m[i]; }]
  ];

  const S = {
    mode: 'one',             // 'one' | 'compare' | 'ai'
    signal: 'dd20',
    cooldown: 60,            // 같은 하락에서 신호가 반복되지 않게 막는 기간
    years: 5,
    cost: 0.002,             // 왕복 거래비용 가정
    cmpH: 20,                // 전부 비교 모드에서 볼 보유 기간
    aiModel: 'logistic',     // AI 모드에서 쓸 모델
    aiH: 20,                 // AI 모드에서 맞히려는 보유 기간
    result: null,
    compare: null,
    ai: null,
    compareOOS: null,
    running: false,
    oos: null,
    oosRunning: false,
    peeks: 0
  };

  try { S.peeks = +(localStorage.getItem('quantlab.bouncePeeks') || 0); } catch (e) {}

  /* ------------------------------------------------------------------------
   *  지표 미리 계산
   *
   *  신호를 열 가지 돌리려면 같은 지표를 열 번 다시 계산하게 됩니다.
   *  한 번만 계산해 두고 신호는 조건만 보게 하면 훨씬 빠릅니다.
   * ----------------------------------------------------------------------*/
  let FEAT = null;          // { key: 'lo-hi', map: { ticker: {...} } }

  function features(lo, hi) {
    const key = lo + '-' + hi;
    if (FEAT && FEAT.key === key) return FEAT.map;

    const map = {};
    const tickers = DATA.state.tickers.filter(function (t) { return !DATA.isBenchmark(t); });
    tickers.forEach(function (t) {
      const s = DATA.series(t);
      if (!s) return;
      const v = DATA.state.volume[t];
      const dd = {}, rsi = {}, g20 = {}, g200 = {}, m5 = {}, vr = {}, vol = {};
      // 200일선 하향 '돌파'를 보려면 하루 앞도 필요합니다
      for (let i = lo - 1; i <= hi; i++) {
        if (i < 1) continue;
        dd[i] = IND.drawdown(s, i, DDWIN);
        rsi[i] = IND.rsi(s, i, 14);
        m5[i] = IND.mom(s, i, 5);
        vol[i] = IND.vol(s, i, 20);
        const p = IND.px(s, i);
        const a20 = IND.ma(s, i, 20), a200 = IND.ma(s, i, 200);
        g20[i] = (isFinite(p) && a20 > 0) ? p / a20 - 1 : NaN;
        g200[i] = (isFinite(p) && a200 > 0) ? p / a200 - 1 : NaN;
        if (v) {
          let a = 0, ca = 0, b = 0, cb = 0;
          for (let k = Math.max(0, i - 4); k <= i; k++) if (isFinite(v[k])) { a += v[k]; ca++; }
          for (let k = Math.max(0, i - 59); k <= i; k++) if (isFinite(v[k])) { b += v[k]; cb++; }
          vr[i] = (ca && cb && b > 0) ? (a / ca) / (b / cb) - 1 : NaN;
        } else vr[i] = NaN;
      }
      map[t] = { s: s, dd: dd, rsi: rsi, g20: g20, g200: g200, m5: m5, vr: vr, vol: vol };
    });

    FEAT = { key: key, map: map };
    return map;
  }

  // 시장(QQQ)의 낙폭 — 그날 시장도 같이 빠져 있었는지 보는 데 씁니다
  function marketDD(lo, hi) {
    const s = DATA.series(MARKET);
    const out = {};
    if (!s) return out;
    for (let i = lo; i <= hi; i++) out[i] = IND.drawdown(s, i, DDWIN);
    return out;
  }

  /* ------------------------------------------------------------------------
   *  신호 찾기
   *
   *  i일 종가까지의 정보만 씁니다.
   *  쿨다운이 왜 필요한가: 한 번 크게 빠지면 그 뒤 수십 일 동안 매일 '낙폭 -20%'가
   *  성립합니다. 그대로 두면 하나의 하락이 표본 50개로 부풀어 통계가 거짓말을 합니다.
   * ----------------------------------------------------------------------*/
  function findSignals(sig, lo, hi, feats) {
    const out = [];
    Object.keys(feats).forEach(function (t) {
      const f = feats[t];
      let last = -1e9;
      for (let i = lo; i <= hi; i++) {
        if (i - last < S.cooldown) continue;
        let ok;
        try { ok = sig.fn(f, i); } catch (e) { ok = false; }
        if (!ok) continue;
        out.push({ t: t, i: i, dd: f.dd[i] });
        last = i;
      }
    });
    return out;
  }

  // i일에 사서 i+h일에 판 수익률 (둘 다 종가 기준)
  function fwd(s, i, h) {
    const a = IND.px(s, i), b = IND.px(s, i + h);
    return (isFinite(a) && isFinite(b) && a > 0) ? b / a - 1 : NaN;
  }

  /* ------------------------------------------------------------------------
   *  기준선 — "아무 날이나 아무 종목이나 샀다면"
   *
   *  이게 없으면 반등 확률 62%가 좋은 건지 나쁜 건지 알 수 없습니다.
   * ----------------------------------------------------------------------*/
  const BASE_CACHE = {};
  function baseline(lo, hi, h, feats) {
    const key = lo + '-' + hi + '-' + h;
    if (BASE_CACHE[key]) return BASE_CACHE[key];
    const out = [];
    Object.keys(feats).forEach(function (t) {
      const s = feats[t].s;
      for (let i = lo; i + h <= hi; i += BASE_STEP) {
        const r = fwd(s, i, h);
        if (isFinite(r)) out.push(r);
      }
    });
    BASE_CACHE[key] = out;
    return out;
  }

  function winRate(a) {
    if (!a.length) return NaN;
    let w = 0;
    for (let k = 0; k < a.length; k++) if (a[k] > 0) w++;
    return w / a.length;
  }

  function statsFor(sigList, lo, hi, h, feats) {
    const grp = [];
    sigList.forEach(function (x) {
      if (x.i + h > hi) return;
      const r = fwd(feats[x.t].s, x.i, h);
      if (isFinite(r)) grp.push(r);
    });
    const base = baseline(lo, hi, h, feats);
    const w = U.welchT(grp, base);
    const mg = grp.length ? U.mean(grp) : NaN;
    const mb = base.length ? U.mean(base) : NaN;
    return {
      h: h, n: grp.length,
      win: winRate(grp), winBase: winRate(base),
      mean: mg, med: grp.length ? U.quantile(grp, 0.5) : NaN, base: mb,
      excess: mg - mb, net: mg - mb - S.cost,
      t: w.t, p: w.p, values: grp, baseValues: base
    };
  }

  function setProg(f) {
    const el = U.$('#bounceProg');
    if (el) el.style.width = Math.round(f * 100) + '%';
  }

  /* ------------------------------------------------------------------------
   *  자세히 보기 — 신호 하나를 보유 기간별로
   * ----------------------------------------------------------------------*/
  async function analyse(sig, lo, hi) {
    const feats = features(lo, hi);
    await U.yield_();
    const list = findSignals(sig, lo, hi, feats);
    await U.yield_();

    const rows = [];
    for (let k = 0; k < HORIZONS.length; k++) {
      rows.push(statsFor(list, lo, hi, HORIZONS[k], feats));
      setProg((k + 1) / (HORIZONS.length + 1));
      await U.yield_();
    }

    const best = rows.reduce(function (a, b) {
      return (isFinite(b.net) && (!isFinite(a.net) || b.net > a.net)) ? b : a;
    }, rows[0]);

    // 업종별
    const bySector = {};
    list.forEach(function (x) {
      if (x.i + best.h > hi) return;
      const r = fwd(feats[x.t].s, x.i, best.h);
      if (!isFinite(r)) return;
      const sec = DATA.sector(x.t);
      (bySector[sec] = bySector[sec] || []).push(r);
    });
    const sectors = Object.keys(bySector)
      .map(function (k) {
        return { sector: k, n: bySector[k].length, mean: U.mean(bySector[k]), win: winRate(bySector[k]) };
      })
      .filter(function (x) { return x.n >= 10; })
      .sort(function (a, b) { return b.mean - a.mean; });

    // 시장 탓인가 종목 탓인가 — 학생들이 말한 "시장 상황에 따라 달라진다"를 재 봅니다
    const mdd = marketDD(lo, hi);
    const withMkt = [], soloOnly = [];
    list.forEach(function (x) {
      if (x.i + best.h > hi) return;
      const r = fwd(feats[x.t].s, x.i, best.h);
      if (!isFinite(r)) return;
      const m = mdd[x.i];
      if (isFinite(m) && m <= -0.05) withMkt.push(r); else soloOnly.push(r);
    });
    const split = {
      h: best.h,
      market: { n: withMkt.length, win: winRate(withMkt), mean: withMkt.length ? U.mean(withMkt) : NaN },
      solo: { n: soloOnly.length, win: winRate(soloOnly), mean: soloOnly.length ? U.mean(soloOnly) : NaN },
      diff: U.welchT(withMkt, soloOnly)
    };

    setProg(1);
    return {
      sig: sig, rows: rows, best: best, sectors: sectors, split: split,
      nSignals: list.length,
      nTickers: Object.keys(list.reduce(function (m, x) { m[x.t] = 1; return m; }, {})).length,
      avgDD: list.length ? U.mean(list.map(function (x) { return x.dd; }).filter(isFinite)) : NaN,
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] },
      config: { signal: sig.id, cooldown: S.cooldown, years: S.years, cost: S.cost }
    };
  }

  /* ------------------------------------------------------------------------
   *  전부 비교 — 신호 열 가지를 한 화면에
   * ----------------------------------------------------------------------*/
  async function analyseCompare(lo, hi, h) {
    const feats = features(lo, hi);
    await U.yield_();
    const out = [];
    for (let k = 0; k < SIGNALS.length; k++) {
      const sig = SIGNALS[k];
      const list = findSignals(sig, lo, hi, feats);
      const st = statsFor(list, lo, hi, h, feats);
      st.sig = sig;
      out.push(st);
      setProg((k + 1) / SIGNALS.length);
      await U.yield_();
    }
    out.sort(function (a, b) { return (isFinite(b.net) ? b.net : -9) - (isFinite(a.net) ? a.net : -9); });
    out.forEach(function (x, k) { x.rank = k + 1; });
    return {
      h: h, rows: out,
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] }
    };
  }

  /* ------------------------------------------------------------------------
   *  AI 반등 예측
   *
   *  지금까지는 "낙폭이 나면 평균적으로 어떻더라"를 셌습니다.
   *  여기서는 한 걸음 더 갑니다 — <b>이번 낙폭</b>이 반등할지를 맞혀 보는 것입니다.
   *
   *  신호가 난 시점의 상태(낙폭 깊이, RSI, 이동평균 대비, 거래량, 변동성, 시장 상태)를
   *  모델에 주고, h일 뒤 오를지 내릴지를 학습시킵니다.
   *
   *  ★ 학습과 평가는 시간 순서로 가릅니다.
   *    앞 70%로 배우고 뒤 30%로 시험합니다. 섞어서 나누면 미래를 보고 배운 것이 되어
   *    성적이 거짓말처럼 좋아집니다. 이 실수가 금융 머신러닝에서 가장 흔합니다.
   *
   *  ★ 볼 것은 정확도가 아니라 AUC입니다.
   *    반등이 55%인 데이터에서는 "무조건 오른다"고 찍어도 정확도가 55%입니다.
   *    AUC 0.5는 실력이 전혀 없다는 뜻이고, 0.55만 되어도 금융에서는 쓸 만합니다.
   * ----------------------------------------------------------------------*/
  async function analyseAI(sig, lo, hi, h, modelId) {
    const feats = features(lo, hi);
    await U.yield_();
    const list = findSignals(sig, lo, hi, feats);
    const mdd = marketDD(lo, hi);
    await U.yield_();

    // 표본 만들기 — 시간 순서대로 정렬해 두어야 앞뒤로 가를 수 있습니다
    const rows = [];
    list.forEach(function (x) {
      if (x.i + h > hi) return;
      const f = feats[x.t];
      const r = fwd(f.s, x.i, h);
      if (!isFinite(r)) return;
      const v = AI_FEATS.map(function (a) { return a[2](f, x.i, mdd); });
      if (v.some(function (z) { return !isFinite(z); })) return;
      rows.push({ i: x.i, t: x.t, x: v, y: r > 0 ? 1 : 0, ret: r });
    });
    rows.sort(function (a, b) { return a.i - b.i; });
    await U.yield_();

    if (rows.length < 80) {
      return { tooFew: true, n: rows.length, sig: sig, h: h, model: modelId,
        range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] } };
    }

    const cut = Math.floor(rows.length * 0.7);
    const tr = rows.slice(0, cut), te = rows.slice(cut);

    const model = root.ML.create(modelId, { featureCols: AI_FEATS.map(function (a) { return a[0]; }) });
    model.fit(tr.map(function (r) { return r.x; }), tr.map(function (r) { return r.y; }));
    setProg(0.6);
    await U.yield_();

    const pTr = model.predictProba(tr.map(function (r) { return r.x; }));
    const pTe = model.predictProba(te.map(function (r) { return r.x; }));
    const yTr = tr.map(function (r) { return r.y; });
    const yTe = te.map(function (r) { return r.y; });
    const M = root.M;

    // 확률 구간별로 실제 반등률이 따라오는가 (캘리브레이션)
    const bins = [[0, 0.45], [0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 1]];
    const cal = bins.map(function (b) {
      const sel = [];
      for (let k = 0; k < te.length; k++) if (pTe[k] >= b[0] && pTe[k] < b[1]) sel.push(k);
      const ys = sel.map(function (k) { return te[k].y; });
      const rs = sel.map(function (k) { return te[k].ret; });
      return {
        lo: b[0], hi: b[1], n: sel.length,
        said: sel.length ? U.mean(sel.map(function (k) { return pTe[k]; })) : NaN,
        real: ys.length ? U.mean(ys) : NaN,
        ret: rs.length ? U.mean(rs) : NaN
      };
    });

    // 모델이 높게 본 것 상위 30% vs 하위 30%의 실제 성적
    const order = U.range(te.length).sort(function (a, b) { return pTe[b] - pTe[a]; });
    const k30 = Math.max(1, Math.floor(te.length * 0.3));
    const topR = order.slice(0, k30).map(function (k) { return te[k].ret; });
    const botR = order.slice(-k30).map(function (k) { return te[k].ret; });

    setProg(1);
    return {
      sig: sig, h: h, model: modelId,
      nTrain: tr.length, nTest: te.length,
      baseRate: U.mean(yTe),
      aucTrain: M.auc(yTr, Array.prototype.slice.call(pTr)),
      aucTest: M.auc(yTe, Array.prototype.slice.call(pTe)),
      roc: M.rocCurve(yTe, Array.prototype.slice.call(pTe)),
      rocTrain: M.rocCurve(yTr, Array.prototype.slice.call(pTr)),
      cal: cal,
      top: { n: topR.length, mean: U.mean(topR), win: winRate(topR) },
      bot: { n: botR.length, mean: U.mean(botR), win: winRate(botR) },
      imp: model.importance ? model.importance() : null,
      trainRange: { start: DATA.state.dates[tr[0].i], end: DATA.state.dates[tr[tr.length - 1].i] },
      testRange: { start: DATA.state.dates[te[0].i], end: DATA.state.dates[te[te.length - 1].i] },
      range: { start: DATA.state.dates[lo], end: DATA.state.dates[hi] }
    };
  }

  /* ------------------------------------------------------------------------
   *  실행
   * ----------------------------------------------------------------------*/
  function bounds() {
    const n = DATA.state.dates.length;
    const hi = n - 1 - HOLDOUT;                 // 채점 구간은 건드리지 않습니다
    const lo = Math.max(DDWIN + 210, hi - S.years * 252);   // 200일선을 쓰므로 여유를 둡니다
    return { lo: lo, hi: hi };
  }

  async function run(host) {
    S.running = true; S.result = null; S.compare = null; S.ai = null;
    S.oos = null; S.compareOOS = null;
    draw(host);

    const b = bounds();
    if (S.mode === 'one') {
      S.result = await analyse(sigOf(S.signal), b.lo, b.hi);
      if (root.JOURNAL) {
        root.JOURNAL.add({
          kind: 'bounce',
          name: S.result.sig.name,
          nSignals: S.result.nSignals,
          bestH: S.result.best.h,
          excess: S.result.best.excess,
          net: S.result.best.net,
          tval: S.result.best.t,
          config: S.result.config
        });
      }
    } else if (S.mode === 'ai') {
      S.ai = await analyseAI(sigOf(S.signal), b.lo, b.hi, S.aiH, S.aiModel);
      if (root.JOURNAL && !S.ai.tooFew) {
        root.JOURNAL.add({
          kind: 'bounce-ai',
          name: root.ML.modelName(S.aiModel) + ' · ' + S.ai.sig.name + ' · ' + S.aiH + '일',
          aucTrain: S.ai.aucTrain, aucTest: S.ai.aucTest,
          nTrain: S.ai.nTrain, nTest: S.ai.nTest,
          config: { signal: S.signal, h: S.aiH, model: S.aiModel, years: S.years, cooldown: S.cooldown }
        });
      }
    } else {
      S.compare = await analyseCompare(b.lo, b.hi, S.cmpH);
      if (root.JOURNAL) {
        const top = S.compare.rows[0];
        root.JOURNAL.add({
          kind: 'bounce',
          name: '전부 비교 (' + SIGNALS.length + '가지 · 보유 ' + S.cmpH + '일)',
          nSignals: S.compare.rows.reduce(function (a, x) { return a + x.n; }, 0),
          bestH: S.cmpH,
          excess: top.excess, net: top.net, tval: top.t,
          note: '개발 구간 1위: ' + top.sig.name,
          config: { mode: 'compare', cooldown: S.cooldown, years: S.years, cost: S.cost }
        });
      }
    }
    S.running = false;
    draw(host);
  }

  async function runOOS(host) {
    S.oosRunning = true;
    draw(host);

    const n = DATA.state.dates.length;
    const lo = n - 1 - HOLDOUT;
    const hi = n - 1;

    if (S.mode === 'one') {
      S.oos = await analyse(sigOf(S.signal), lo, hi);
    } else {
      S.compareOOS = await analyseCompare(lo, hi, S.cmpH);
    }

    S.peeks++;
    try { localStorage.setItem('quantlab.bouncePeeks', String(S.peeks)); } catch (e) {}
    S.oosRunning = false;

    if (root.JOURNAL) {
      if (S.mode === 'one' && S.result) {
        root.JOURNAL.add({
          kind: 'bounce-oos',
          name: S.result.sig.name,
          is: { h: S.result.best.h, excess: S.result.best.excess },
          oos: { h: S.oos.best.h, excess: (S.oos.rows.filter(function (r) { return r.h === S.result.best.h; })[0] || {}).excess },
          peek: S.peeks
        });
      } else if (S.compare && S.compareOOS) {
        const devTop = S.compare.rows[0].sig.id;
        const osRank = (S.compareOOS.rows.filter(function (r) { return r.sig.id === devTop; })[0] || {}).rank;
        root.JOURNAL.add({
          kind: 'bounce-oos',
          name: '전부 비교 · 개발 1위 = ' + S.compare.rows[0].sig.name,
          is: { h: S.cmpH, excess: S.compare.rows[0].excess },
          oos: { h: S.cmpH, excess: (S.compareOOS.rows.filter(function (r) { return r.sig.id === devTop; })[0] || {}).excess },
          note: '채점 구간에서는 ' + (osRank || '—') + '위',
          peek: S.peeks
        });
      }
    }
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  설정
   * ----------------------------------------------------------------------*/
  function setupPanel(host) {
    const p = App.panel('낙폭 반등 연구실 <span class="accent">EVENT STUDY</span>',
      { sub: '많이 떨어진 종목은 정말 돌아오는가 · 돌아온다면 며칠 뒤에 파는 것이 좋은가' });

    const seg = U.el('div', 'seg');
    [['one', '하나 자세히 보기'], ['compare', '열 가지 전부 비교'], ['ai', 'AI로 예측해 보기']].forEach(function (o) {
      const b = U.el('button', S.mode === o[0] ? 'on' : '', o[1]);
      b.addEventListener('click', function () {
        S.mode = o[0];
        S.result = null; S.compare = null; S.ai = null; S.oos = null; S.compareOOS = null;
        draw(host);
      });
      seg.appendChild(b);
    });
    p.body.appendChild(seg);

    const grid = U.el('div', 'grid g4 mt');
    const mk = function (label, opts, cur, on, hint) {
      const f = U.el('div', 'field');
      f.appendChild(U.el('label', '', label));
      const sel = U.el('select');
      opts.forEach(function (o) {
        const op = U.el('option', '', o[1]);
        op.value = o[0];
        if (String(o[0]) === String(cur)) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { on(sel.value); });
      f.appendChild(sel);
      if (hint) f.appendChild(U.el('div', 'tiny', hint));
      return f;
    };

    if (S.mode === 'one') {
      const cur = sigOf(S.signal);
      grid.appendChild(mk('신호 정의',
        SIGNALS.map(function (s) { return [s.id, s.group + ' · ' + s.name]; }),
        S.signal, function (v) { S.signal = v; draw(host); }, cur.desc));
    } else if (S.mode === 'ai') {
      const cur = sigOf(S.signal);
      grid.appendChild(mk('어떤 신호를 예측할까',
        SIGNALS.map(function (x) { return [x.id, x.group + ' · ' + x.name]; }),
        S.signal, function (v) { S.signal = v; draw(host); }, cur.desc));
      grid.appendChild(mk('맞히려는 보유 기간',
        HORIZONS.map(function (x) { return [x, x + '일']; }),
        S.aiH, function (v) { S.aiH = +v; }, '이 기간 뒤에 올랐을지를 맞힙니다'));
      grid.appendChild(mk('모델',
        root.ML.MODELS.filter(function (m) { return m.kind === 'ai'; })
          .map(function (m) { return [m.id, m.name]; }),
        S.aiModel, function (v) { S.aiModel = v; draw(host); },
        (root.ML.MODELS.filter(function (m) { return m.id === S.aiModel; })[0] || {}).desc || ''));
    } else {
      grid.appendChild(mk('비교할 보유 기간',
        HORIZONS.map(function (h) { return [h, h + '일']; }),
        S.cmpH, function (v) { S.cmpH = +v; }, '이 기간에서 열 가지를 나란히 봅니다'));
    }

    grid.appendChild(mk('재진입 금지 기간',
      [[20, '20일'], [60, '60일'], [120, '120일']],
      S.cooldown, function (v) { S.cooldown = +v; }, '같은 하락이 여러 번 세어지는 것을 막습니다'));

    grid.appendChild(mk('분석 기간',
      [[3, '3년'], [5, '5년'], [8, '8년']],
      S.years, function (v) { S.years = +v; }, '채점 구간 1년은 제외됩니다'));

    grid.appendChild(mk('왕복 거래비용',
      [[0, '0% (비용 무시)'], [0.001, '0.1%'], [0.002, '0.2%'], [0.005, '0.5%']],
      S.cost, function (v) { S.cost = +v; }, '초과수익에서 이만큼 빼고 봅니다'));

    p.body.appendChild(grid);

    const btn = U.el('button', 'btn primary mt', S.running ? '분석 중…' : '분석 실행');
    btn.disabled = S.running;
    btn.addEventListener('click', function () { run(host); });
    p.body.appendChild(btn);

    if (S.running) {
      const bar = U.el('div', 'bar');
      bar.style.marginTop = '10px';
      const i = U.el('i'); i.id = 'bounceProg'; i.style.width = '0%';
      bar.appendChild(i);
      p.body.appendChild(bar);
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  결과 — 하나 자세히
   * ----------------------------------------------------------------------*/
  function resultPanel() {
    const R = S.result;
    const p = App.panel('보유 기간별 성적 · ' + U.escape(R.sig.name),
      { sub: R.range.start + ' ~ ' + R.range.end + ' · 신호 ' + U.comma(R.nSignals) + '건 · 채점 구간 제외' });

    const g = U.el('div', 'grid g4');
    g.appendChild(App.stat('신호 개수', U.comma(R.nSignals), '쿨다운 ' + S.cooldown + '일 적용'));
    g.appendChild(App.stat('해당 종목', R.nTickers + '개', '전체 98종목 중'));
    g.appendChild(App.stat('평균 낙폭', isFinite(R.avgDD) ? (R.avgDD * 100).toFixed(1) + '%' : '—', '신호 시점 기준'));
    g.appendChild(App.stat('최적 보유', R.best.h + '일',
      '비용 차감 초과 ' + (isFinite(R.best.net) ? (R.best.net * 100).toFixed(2) + '%p' : '—'),
      R.best.net > 0 ? 'up' : 'down'));
    p.body.appendChild(g);

    if (R.nSignals < 30) {
      const w = U.el('div', 'note warn');
      w.innerHTML = '<b>표본이 ' + R.nSignals + '건뿐입니다.</b> 이 정도로는 어떤 결론도 낼 수 없습니다. ' +
        '더 얕은 낙폭 기준을 고르거나 기간을 늘리세요.';
      p.body.appendChild(w);
    }

    const rows = R.rows.map(function (r) {
      const isBest = r === R.best;
      return {
        cells: [
          isBest ? '<b>' + r.h + '일</b>' : r.h + '일',
          U.comma(r.n),
          isFinite(r.win) ? (r.win * 100).toFixed(1) + '%' : '—',
          isFinite(r.winBase) ? '<span class="muted">' + (r.winBase * 100).toFixed(1) + '%</span>' : '—',
          isFinite(r.mean) ? (r.mean * 100).toFixed(2) + '%' : '—',
          isFinite(r.base) ? '<span class="muted">' + (r.base * 100).toFixed(2) + '%</span>' : '—',
          '<span class="' + (r.excess > 0 ? 'up' : 'down') + '">' +
            (isFinite(r.excess) ? (r.excess > 0 ? '+' : '') + (r.excess * 100).toFixed(2) + '%p' : '—') + '</span>',
          '<span class="' + (r.net > 0 ? 'up' : 'down') + '">' +
            (isFinite(r.net) ? (r.net > 0 ? '+' : '') + (r.net * 100).toFixed(2) + '%p' : '—') + '</span>',
          isFinite(r.t) ? r.t.toFixed(2) : '—'
        ],
        __cls: isBest ? 'hl' : ''
      };
    });

    p.body.appendChild(App.table(
      ['보유', { label: '표본', num: true }, { label: '반등확률', num: true },
        { label: '기준선', num: true }, { label: '평균수익', num: true },
        { label: '기준선', num: true }, { label: '초과', num: true },
        { label: '비용 차감', num: true }, { label: 't값', num: true }],
      rows));

    p.body.appendChild(U.el('div', 'tiny',
      '기준선 = 같은 기간 같은 종목들을 아무 날에나 샀을 때. 초과 = 신호 그룹 − 기준선. ' +
      't값은 두 집단 평균 차이의 Welch 검정값입니다(아래 주의를 함께 읽으세요).'));

    p.body.appendChild(U.el('div', 'tiny mt', '보유 기간별 평균 수익 — 신호 그룹과 기준선'));
    p.body.appendChild(C.legend([
      { name: R.sig.name + ' 후 매수', color: C.seriesColor(1) },
      { name: '아무 날이나 매수 (기준선)', color: C.mutedColor() }
    ]));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, {
      labels: R.rows.map(function (r) { return r.h + '일'; }),
      series: [
        { name: '신호 후 매수', values: R.rows.map(function (r) { return r.mean; }), color: C.seriesColor(1) },
        { name: '기준선', values: R.rows.map(function (r) { return r.base; }), color: C.mutedColor() }
      ],
      zeroLine: 0,
      yFmt: function (x) { return (x * 100).toFixed(1) + '%'; }
    });

    p.body.appendChild(U.el('div', 'tiny mt',
      R.best.h + '일 보유 시 수익률 분포 — 평균 하나로는 알 수 없는 것'));
    const hv = U.el('canvas', 'chart');
    p.body.appendChild(hv);
    C.hist(hv, [
      { name: '신호 후 매수', values: R.best.values, color: C.seriesColor(1) },
      { name: '기준선', values: R.best.baseValues, color: C.mutedColor() }
    ], { xFmt: function (x) { return (x * 100).toFixed(0) + '%'; } });
    p.body.appendChild(U.el('div', 'tiny',
      '두 분포가 거의 겹쳐 보인다면, 평균 차이가 조금 있어도 실제로는 구별하기 어려운 것입니다. ' +
      '중앙값(' + (isFinite(R.best.med) ? (R.best.med * 100).toFixed(2) + '%' : '—') +
      ')과 평균(' + (isFinite(R.best.mean) ? (R.best.mean * 100).toFixed(2) + '%' : '—') +
      ')이 많이 다르면, 소수의 큰 반등이 평균을 끌어올리고 있다는 뜻입니다.'));

    return p;
  }

  /* ------------------------------------------------------------------------
   *  시장 탓인가, 그 종목 탓인가
   *
   *  학생들이 "시장 상황에 따라 정확도가 달라진다"고 지적한 부분을 직접 재 봅니다.
   * ----------------------------------------------------------------------*/
  function splitPanel() {
    const sp = S.result.split;
    if (!sp || (!sp.market.n && !sp.solo.n)) return null;
    const p = App.panel('시장 탓인가, 그 종목 탓인가',
      { sub: '보유 ' + sp.h + '일 기준 · 신호가 난 날 시장(QQQ)도 6개월 고점 대비 5% 넘게 빠져 있었는가' });

    p.body.appendChild(App.table(
      ['그때 시장은', { label: '표본', num: true }, { label: '반등확률', num: true }, { label: '평균수익', num: true }],
      [
        ['<b>시장도 같이 빠져 있었다</b>', U.comma(sp.market.n),
          isFinite(sp.market.win) ? (sp.market.win * 100).toFixed(1) + '%' : '—',
          isFinite(sp.market.mean) ? (sp.market.mean * 100).toFixed(2) + '%' : '—'],
        ['<b>시장은 멀쩡했다 (그 종목만)</b>', U.comma(sp.solo.n),
          isFinite(sp.solo.win) ? (sp.solo.win * 100).toFixed(1) + '%' : '—',
          isFinite(sp.solo.mean) ? (sp.solo.mean * 100).toFixed(2) + '%' : '—']
      ]));

    const d = sp.market.mean - sp.solo.mean;
    const n = U.el('div', 'note' + (isFinite(sp.diff.t) && Math.abs(sp.diff.t) > 2 ? ' warn' : ''));
    n.innerHTML =
      '두 집단의 평균 차이는 <b>' + (isFinite(d) ? (d * 100).toFixed(2) + '%p' : '—') +
      '</b>, t값 <b>' + (isFinite(sp.diff.t) ? sp.diff.t.toFixed(2) : '—') + '</b>입니다.<br><br>' +
      '이 구분이 중요한 이유. <b>시장이 통째로 빠질 때의 반등은 그 종목의 힘이 아니라 시장의 회복입니다.</b> ' +
      '그런 반등을 "낙폭 과대 종목이 돌아왔다"고 읽으면, 실제로는 그냥 지수를 산 것과 같은 일을 해 놓고 ' +
      '종목 선택을 잘했다고 착각하게 됩니다. ' +
      (isFinite(d) && d > 0
        ? '지금 결과는 <b>시장이 같이 빠졌을 때가 더 좋았다</b>고 나옵니다 — 즉 이 신호의 수익 상당 부분이 시장 회복일 수 있습니다.'
        : '지금 결과는 <b>그 종목만 빠졌을 때가 더 좋았다</b>고 나옵니다 — 개별 악재 뒤의 되돌림 쪽에 가깝습니다.') +
      ' 어느 쪽이든 표본 수를 먼저 보세요.';
    p.body.appendChild(n);
    return p;
  }

  function sectorPanel() {
    const R = S.result;
    if (!R.sectors.length) return null;
    const p = App.panel('업종별로 갈라 보기',
      { sub: R.best.h + '일 보유 기준 · 표본 10건 이상인 업종만' });

    p.body.appendChild(C.legend([{ name: '평균 수익률', color: C.seriesColor(1) }]));
    const cv = U.el('canvas', 'chart');
    cv.style.height = Math.max(160, R.sectors.length * 26) + 'px';
    p.body.appendChild(cv);
    C.bars(cv, {
      items: R.sectors.map(function (x) {
        return {
          label: x.sector + ' (' + x.n + ')',
          value: x.mean,
          color: x.mean > 0 ? C.seriesColor(1) : C.seriesColor(3)
        };
      }),
      baseValue: 0,
      vFmt: function (v) { return (v * 100).toFixed(2) + '%'; }
    });

    const note = U.el('div', 'note');
    note.innerHTML =
      '업종을 갈라 보면 어딘가는 반드시 좋아 보입니다. <b>여러 개로 나누면 그중 하나가 우연히 좋을 확률은 아주 높습니다.</b> ' +
      '여기서 제일 좋은 업종을 골라 "이 업종의 낙폭은 잘 반등한다"고 결론 내리는 것이 ' +
      '가장 흔한 오류입니다. 표본 수(괄호 안)를 먼저 보세요. 30건 미만이면 읽지 마세요.';
    p.body.appendChild(note);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  전부 비교
   * ----------------------------------------------------------------------*/
  function comparePanel(host) {
    const K = S.compare;
    const p = App.panel('신호 정의 ' + SIGNALS.length + '가지 비교',
      { sub: K.range.start + ' ~ ' + K.range.end + ' · 보유 ' + K.h + '일 고정 · 비용 차감 순' });

    const osMap = {};
    if (S.compareOOS) S.compareOOS.rows.forEach(function (r) { osMap[r.sig.id] = r; });

    const headers = ['#', '신호', { label: '표본', num: true }, { label: '반등확률', num: true },
      { label: '기준선', num: true }, { label: '초과', num: true },
      { label: '비용 차감', num: true }, { label: 't값', num: true }];
    if (S.compareOOS) headers.push({ label: '채점 구간 순위', num: true });

    const rows = K.rows.map(function (r) {
      const cells = [
        r.rank === 1 ? '<b>1</b>' : String(r.rank),
        '<b>' + U.escape(r.sig.name) + '</b><div class="tiny">' + U.escape(r.sig.desc) + '</div>',
        U.comma(r.n),
        isFinite(r.win) ? (r.win * 100).toFixed(1) + '%' : '—',
        isFinite(r.winBase) ? '<span class="muted">' + (r.winBase * 100).toFixed(1) + '%</span>' : '—',
        '<span class="' + (r.excess > 0 ? 'up' : 'down') + '">' +
          (isFinite(r.excess) ? (r.excess > 0 ? '+' : '') + (r.excess * 100).toFixed(2) + '%p' : '—') + '</span>',
        '<span class="' + (r.net > 0 ? 'up' : 'down') + '">' +
          (isFinite(r.net) ? (r.net > 0 ? '+' : '') + (r.net * 100).toFixed(2) + '%p' : '—') + '</span>',
        isFinite(r.t) ? r.t.toFixed(2) : '—'
      ];
      if (S.compareOOS) {
        const o = osMap[r.sig.id];
        const moved = o ? o.rank - r.rank : NaN;
        cells.push(o
          ? o.rank + '위 <span class="' + (moved > 0 ? 'down' : (moved < 0 ? 'up' : 'muted')) + '">(' +
            (moved > 0 ? '↓' + moved : (moved < 0 ? '↑' + (-moved) : '=')) + ')</span>'
          : '—');
      }
      return { cells: cells, __cls: r.rank === 1 ? 'hl' : '' };
    });

    p.body.appendChild(App.table(headers, rows));

    const warn = U.el('div', 'note warn');
    warn.innerHTML =
      '<b>이 표를 보는 올바른 방법.</b> 1등을 고르는 것이 아닙니다.<br><br>' +
      '열 가지를 하나씩 따로 돌려 보고 제일 좋은 것을 골랐다면, 그것이 정확히 <b>다중검정</b>입니다. ' +
      '아무 신호가 없는 데이터에서도 열 개 중 하나는 반드시 좋아 보입니다. ' +
      '한 화면에 나란히 놓은 이유가 이것입니다 — <b>혼자 돌리면 안 보이던 것이 같이 놓으면 보입니다.</b><br><br>' +
      '먼저 볼 것은 순위가 아니라 <b>표본 수</b>와 <b>비용 차감 열</b>입니다. ' +
      '표본이 30건 미만인 줄은 순위가 몇 등이든 읽지 마세요. ' +
      '그리고 비용을 빼면 대부분이 0 근처로 내려앉는 것을 확인하세요.';
    p.body.appendChild(warn);

    if (!S.compareOOS) {
      const box = U.el('div', 'note');
      box.innerHTML =
        '<b>여기서 진짜 실험을 하나 해 볼 수 있습니다.</b><br>' +
        '지금 1등은 <b>' + U.escape(K.rows[0].sig.name) + '</b>입니다. ' +
        '이 순위가 <b>처음 보는 1년</b>에서도 유지될까요? 아래 버튼을 누르면 같은 열 가지를 ' +
        '채점 구간에서 다시 돌려 <b>순위가 어떻게 바뀌는지</b> 옆에 붙여 줍니다.<br>' +
        (S.peeks ? '지금까지 채점 구간을 <b>' + S.peeks + '번</b> 봤습니다.' : '아직 한 번도 보지 않았습니다.');
      p.body.appendChild(box);

      const btn = U.el('button', 'btn' + (S.peeks >= 3 ? '' : ' primary'),
        S.oosRunning ? '확인 중…' : '채점 구간에서 순위가 어떻게 바뀌는지 보기');
      btn.disabled = S.oosRunning;
      btn.addEventListener('click', function () { runOOS(host); });
      p.body.appendChild(btn);
      if (S.oosRunning) {
        const bar = U.el('div', 'bar');
        bar.style.marginTop = '10px';
        const i = U.el('i'); i.id = 'bounceProg'; i.style.width = '0%';
        bar.appendChild(i);
        p.body.appendChild(bar);
      }
    } else {
      const devTop = K.rows[0];
      const o = osMap[devTop.sig.id];
      const moves = K.rows.map(function (r) {
        const x = osMap[r.sig.id];
        return x ? Math.abs(x.rank - r.rank) : 0;
      });
      const avgMove = U.mean(moves);
      const n = U.el('div', 'note ' + (o && o.rank <= 3 ? '' : 'warn'));
      n.innerHTML =
        '<b>개발 구간 1등이었던 「' + U.escape(devTop.sig.name) + '」은 채점 구간에서 ' +
        (o ? '<b>' + o.rank + '위</b>' : '—') + '입니다.</b> ' +
        '열 가지의 순위는 평균 <b>' + (isFinite(avgMove) ? avgMove.toFixed(1) : '—') + '칸</b> 움직였습니다.<br><br>' +
        (o && o.rank <= 3
          ? '이번에는 상위권을 지켰습니다. 다만 1년치 표본이라 우연일 수 있고, 순위가 유지되었다고 해서 ' +
            '초과수익이 남았다는 뜻은 아닙니다. 옆의 <b>비용 차감</b> 값을 함께 보세요.'
          : '<b>개발 구간의 1등이 채점 구간에서는 그저 그렇습니다.</b> 이것이 "제일 좋은 신호를 골랐다"가 ' +
            '왜 위험한지를 보여 줍니다. 여러 개 중 최고를 고르는 순간, 그 최고에는 실력뿐 아니라 ' +
            '<b>운이 함께 뽑혀 들어갑니다</b>. 그 운은 다음 구간에서 따라오지 않습니다.');
      p.body.appendChild(n);
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  AI 결과
   * ----------------------------------------------------------------------*/
  function aiPanel() {
    const A = S.ai;
    const p = App.panel('AI 반등 예측 · ' + U.escape(root.ML.modelName(A.model)),
      { sub: U.escape(A.sig.name) + ' 신호가 난 시점의 상태로 ' + A.h + '일 뒤 상승 여부를 맞혀 봅니다' });

    if (A.tooFew) {
      const w = U.el('div', 'note warn');
      w.innerHTML = '<b>표본이 ' + A.n + '건뿐이라 학습할 수 없습니다.</b> ' +
        '모델을 학습시키려면 최소 80건은 있어야 합니다. ' +
        '더 자주 발생하는 신호(낙폭 -10%, RSI 30 미만)를 고르거나 분석 기간을 늘리세요.';
      p.body.appendChild(w);
      return p;
    }

    const g = U.el('div', 'grid g4');
    g.appendChild(App.stat('학습 표본', U.comma(A.nTrain), A.trainRange.start + ' ~ ' + A.trainRange.end));
    g.appendChild(App.stat('시험 표본', U.comma(A.nTest), A.testRange.start + ' ~ ' + A.testRange.end));
    g.appendChild(App.stat('AUC · 학습', isFinite(A.aucTrain) ? A.aucTrain.toFixed(3) : '—', '외운 것까지 포함'));
    g.appendChild(App.stat('AUC · 시험', isFinite(A.aucTest) ? A.aucTest.toFixed(3) : '—',
      '0.5 = 실력 없음', A.aucTest > 0.55 ? 'up' : (A.aucTest < 0.5 ? 'down' : '')));
    p.body.appendChild(g);

    // 판정 — 이 화면에서 학생이 가장 먼저 읽을 문장
    const a = A.aucTest;
    const v = U.el('div', 'verdict ' + (a >= 0.55 ? 'pass' : 'fail'));
    v.appendChild(U.el('span', 'v-badge', a >= 0.55 ? '신호 있음' : (a >= 0.52 ? '아주 약함' : '실력 없음')));
    const vt = U.el('div', 'v-text');
    vt.innerHTML = a >= 0.55
      ? '시험 구간 AUC가 <b>' + a.toFixed(3) + '</b>입니다. 금융 데이터에서 0.55는 결코 낮은 값이 아닙니다. ' +
        '다만 학습 AUC(' + A.aucTrain.toFixed(3) + ')와의 차이를 보세요. 차이가 크면 외운 것입니다.'
      : (a >= 0.52
        ? '시험 구간 AUC가 <b>' + a.toFixed(3) + '</b>입니다. 0.5보다 조금 높지만 <b>거래비용을 감당할 수준은 아닙니다.</b> ' +
          '학습 AUC는 ' + A.aucTrain.toFixed(3) + '였습니다 — 배운 것 대부분이 시험에서 사라졌습니다.'
        : '시험 구간 AUC가 <b>' + a.toFixed(3) + '</b>입니다. ' +
          (a < 0.5
            ? '<b>0.5보다 낮습니다</b> — 모델이 좋게 본 쪽이 실제로는 더 나빴다는 뜻입니다. ' +
              '여기서 "그럼 반대로 쓰면 되겠네"라고 생각하기 쉬운데, <b>그건 함정입니다.</b> ' +
              '방향이 거꾸로인 신호가 있는 것이 아니라 애초에 신호가 없어서 아무 쪽으로나 빗나간 것이고, ' +
              '다음 구간에서는 또 아무 쪽으로나 빗나갑니다. ' +
              '알파 만들기 화면의 "설명 없이 부호를 뒤집지 말라"와 같은 이야기입니다. '
            : '<b>동전 던지기와 다르지 않습니다.</b> ') +
          '학습 구간에서는 ' + A.aucTrain.toFixed(3) + '였는데도 그렇습니다' +
          (A.aucTrain - a > 0.15 ? ' — 배운 것이 통째로 사라졌습니다(과적합)' : '') + '. ' +
          '모델이 나쁜 것이 아니라, 이 재료로는 개별 반등을 맞힐 수 없다는 뜻입니다. ' +
          '<b>이것도 결과입니다.</b> 숨기지 말고 그대로 보고하세요.');
    v.appendChild(vt);
    p.body.appendChild(v);

    // ROC
    p.body.appendChild(U.el('div', 'tiny mt', 'ROC 곡선 — 점선(대각선)에 붙어 있으면 실력이 없다는 뜻입니다'));
    p.body.appendChild(C.legend([
      { name: '시험 구간', color: C.seriesColor(1) },
      { name: '학습 구간', color: C.mutedColor() }
    ]));
    const rc = U.el('canvas', 'chart');
    p.body.appendChild(rc);
    C.roc(rc, [
      { points: A.rocTrain, color: C.mutedColor() },
      { points: A.roc, color: C.seriesColor(1) }
    ]);

    // 캘리브레이션 — "70%라고 한 것들이 정말 70% 올랐나"
    p.body.appendChild(U.el('div', 'tiny mt',
      '모델이 말한 확률과 실제로 오른 비율 (시험 구간). 기준 반등률은 ' +
      (isFinite(A.baseRate) ? (A.baseRate * 100).toFixed(1) + '%' : '—') + '입니다.'));
    p.body.appendChild(App.table(
      ['모델이 말한 확률', { label: '표본', num: true }, { label: '평균 예측', num: true },
        { label: '실제 상승률', num: true }, { label: '실제 평균수익', num: true }],
      A.cal.map(function (c) {
        return [
          (c.lo * 100).toFixed(0) + '% ~ ' + (c.hi * 100).toFixed(0) + '%',
          U.comma(c.n),
          isFinite(c.said) ? (c.said * 100).toFixed(1) + '%' : '—',
          isFinite(c.real) ? (c.real * 100).toFixed(1) + '%' : '—',
          isFinite(c.ret) ? (c.ret * 100).toFixed(2) + '%' : '—'
        ];
      })));
    p.body.appendChild(U.el('div', 'tiny',
      '읽는 법 — 위에서 아래로 갈수록 <b>실제 상승률</b>도 같이 올라가야 모델이 쓸모 있는 것입니다. ' +
      '들쭉날쭉하다면 확률을 신뢰할 수 없다는 뜻입니다. 표본이 적은 줄은 무시하세요.'));

    // 상위 30% vs 하위 30%
    const d = A.top.mean - A.bot.mean;
    p.body.appendChild(App.table(
      ['모델의 판단', { label: '표본', num: true }, { label: '실제 상승률', num: true }, { label: '실제 평균수익', num: true }],
      [
        ['<b>가장 좋게 본 30%</b>', U.comma(A.top.n),
          isFinite(A.top.win) ? (A.top.win * 100).toFixed(1) + '%' : '—',
          isFinite(A.top.mean) ? (A.top.mean * 100).toFixed(2) + '%' : '—'],
        ['<b>가장 나쁘게 본 30%</b>', U.comma(A.bot.n),
          isFinite(A.bot.win) ? (A.bot.win * 100).toFixed(1) + '%' : '—',
          isFinite(A.bot.mean) ? (A.bot.mean * 100).toFixed(2) + '%' : '—']
      ]));
    const n2 = U.el('div', 'note ' + (d > 0.01 ? '' : 'warn'));
    n2.innerHTML = '두 집단의 실제 수익 차이는 <b>' + (isFinite(d) ? (d * 100).toFixed(2) + '%p' : '—') + '</b>입니다. ' +
      (d > 0.01
        ? '모델이 고른 쪽이 실제로 나았습니다. 다만 왕복 거래비용(' + (S.cost * 100).toFixed(1) + '%)을 빼면 얼마가 남는지 계산해 보세요.'
        : '<b>모델이 좋게 본 것과 나쁘게 본 것이 실제로는 거의 같습니다.</b> AUC가 조금 높게 나왔더라도 ' +
          '돈으로 바꿀 수 없다면 의미가 없습니다. 이 표가 AUC보다 정직합니다.');
    p.body.appendChild(n2);

    // 무엇을 보고 판단했나
    if (A.imp) {
      p.body.appendChild(U.el('div', 'tiny mt', '모델이 무엇을 보고 판단했나'));
      const cv = U.el('canvas', 'chart');
      cv.style.height = Math.max(150, AI_FEATS.length * 24) + 'px';
      p.body.appendChild(cv);
      const items = AI_FEATS.map(function (f, k) {
        return { label: f[1], value: A.imp[k] || 0 };
      }).sort(function (x, y) { return y.value - x.value; });
      C.bars(cv, {
        items: items, baseValue: 0,
        vFmt: function (x) { return (x * 100).toFixed(1) + '%'; }
      });
      p.body.appendChild(U.el('div', 'tiny',
        '중요도가 높다고 그 재료가 <b>옳다</b>는 뜻은 아닙니다. 모델이 그 재료에 많이 기댔다는 뜻일 뿐이고, ' +
        '시험 구간 AUC가 0.5 근처라면 그 기댐 자체가 헛것이었다는 뜻입니다.'));
    }

    return p;
  }

  function aiHonesty() {
    const A = S.ai;
    const p = App.panel('AI 결과를 읽을 때 <span class="accent">READ THIS</span>');
    const add = function (title, html, cls) {
      const n = U.el('div', 'note' + (cls ? ' ' + cls : ''));
      n.innerHTML = '<b>' + title + '</b><br>' + html;
      p.body.appendChild(n);
    };

    add('정확도가 아니라 AUC를 보세요',
      '반등이 ' + (A.baseRate ? (A.baseRate * 100).toFixed(0) : '55') + '%인 데이터에서는 ' +
      '<b>"무조건 오른다"고 찍기만 해도 정확도가 그만큼 나옵니다.</b> ' +
      '정확도는 모델의 실력을 재지 못합니다. AUC는 "오른 것과 내린 것을 구별하는가"를 재고, ' +
      '0.5가 실력이 전혀 없는 상태입니다.', 'warn');

    add('학습과 시험을 시간 순서로 갈랐습니다',
      '앞 70%로 배우고 뒤 30%로 시험합니다. 무작위로 섞어 나누면 <b>미래를 보고 배운 것</b>이 되어 ' +
      '성적이 거짓말처럼 좋아집니다. 금융 머신러닝에서 가장 흔한 실수이고, 논문에서도 종종 나옵니다. ' +
      '학습 AUC ' + (isFinite(A.aucTrain) ? A.aucTrain.toFixed(3) : '—') +
      ' 와 시험 AUC ' + (isFinite(A.aucTest) ? A.aucTest.toFixed(3) : '—') +
      ' 의 <b>차이가 곧 과적합의 크기</b>입니다.');

    add('모델을 바꿔 가며 제일 좋은 것을 고르지 마세요',
      '모델 4가지 × 신호 ' + SIGNALS.length + '가지 × 보유 기간 ' + HORIZONS.length + '가지 = <b>' +
      (4 * SIGNALS.length * HORIZONS.length) + '가지</b> 조합입니다. ' +
      '그중 시험 AUC가 가장 높은 것을 고르면, 그 시험 구간은 더 이상 시험이 아닙니다. ' +
      '연구 노트에 시도가 남으니 <b>몇 번째 조합인지 함께 밝히세요.</b>');

    add('강한 모델일수록 더 크게 무너집니다',
      '모델을 바꿔 보세요. 랜덤포레스트나 부스팅은 로지스틱 회귀보다 <b>학습 AUC가 훨씬 높게</b> 나옵니다. ' +
      '그런데 시험 AUC는 나아지지 않거나 오히려 떨어집니다. ' +
      '표현력이 큰 모델은 신호가 없는 곳에서 <b>잡음까지 외워 버리기</b> 때문입니다. ' +
      '"더 좋은 모델을 쓰면 되지 않나"라는 생각이 왜 틀리는지를 직접 확인할 수 있는 자리입니다.');

    add('안 되는 것도 결과입니다',
      'AUC가 0.5 근처로 나왔다면 실패한 실험이 아닙니다. ' +
      '<b>"이 재료로는 개별 반등을 맞힐 수 없다"는 것을 확인한 것</b>이고, 그것도 발견입니다. ' +
      '실제로 학계에도 같은 결론의 연구가 많습니다. 결과를 좋게 만들려고 조건을 바꿔 가며 돌리는 순간 ' +
      '탐구가 아니라 숫자 맞추기가 됩니다.');

    add('생존 편향은 여기서도 그대로입니다',
      '학습 데이터에도 <b>결국 살아남은 종목만</b> 들어 있습니다. ' +
      '떨어진 뒤 사라진 회사가 없으므로 모델은 "떨어지면 대체로 돌아온다"는 편향된 세상에서 배웁니다. ' +
      '실제 시장에 그대로 쓸 수 없는 이유입니다.', 'warn');

    return p;
  }

  /* ------------------------------------------------------------------------
   *  정직성
   * ----------------------------------------------------------------------*/
  function honestyPanel() {
    const p = App.panel('이 결과를 믿기 전에 <span class="accent">READ THIS</span>',
      { sub: '이 화면에서 가장 중요한 패널입니다' });

    const add = function (title, html, cls) {
      const n = U.el('div', 'note' + (cls ? ' ' + cls : ''));
      n.innerHTML = '<b>' + title + '</b><br>' + html;
      p.body.appendChild(n);
    };

    add('생존 편향 — 이 화면에서 가장 큰 문제',
      '데이터에는 <b>지금 나스닥100에 남아 있는 98종목</b>만 있습니다. ' +
      '크게 떨어진 뒤 회복하지 못해 지수에서 빠지거나 상장폐지된 회사는 <b>아예 들어 있지 않습니다</b>. ' +
      '즉 우리는 "떨어졌지만 결국 살아남은 종목"만 보고 반등 확률을 재고 있습니다. ' +
      '여기 나온 반등 확률은 <b>실제보다 반드시 높습니다.</b> 얼마나 높은지는 이 데이터로 알 수 없습니다.', 'warn');

    add('표본이 서로 독립이 아닙니다',
      '시장 전체가 빠지는 날에는 수십 종목이 동시에 신호를 냅니다. ' +
      '그 표본들은 사실상 <b>하나의 사건</b>인데 통계는 여러 개로 셉니다. ' +
      '그래서 표의 t값은 <b>실제보다 크게 나옵니다</b>. |t|가 2를 넘었다고 바로 유의하다고 하면 안 됩니다. ' +
      '위의 <b>시장 탓인가 종목 탓인가</b> 패널이 이 문제의 한 단면을 보여 줍니다.', 'warn');

    add('여러 번 바꿔 보면 반드시 좋은 조합이 나옵니다',
      '신호 정의 ' + SIGNALS.length + '가지 × 보유 기간 ' + HORIZONS.length + '가지 × 쿨다운 3가지 = <b>' +
      (SIGNALS.length * HORIZONS.length * 3) + '가지</b>입니다. ' +
      '그중 제일 좋은 것을 고르면, 아무 신호가 없는 데이터에서도 그럴듯한 결과가 나옵니다. ' +
      '연구 노트에 시도 횟수가 남습니다. <b>발표할 때 몇 번째 조합인지 함께 밝히세요.</b>');

    add('"최적 보유 기간"은 예측이 아니라 과거 평균입니다',
      '보유 기간 ' + HORIZONS.length + '가지 중 가장 좋은 것을 고른 것이므로, 그 자체가 이미 한 번의 선택입니다. ' +
      '다음 구간에서도 같은 기간이 최적이라는 보장은 없습니다. 채점 구간에서 직접 확인해 보세요.');

    add('체결 가정',
      '신호는 그날 <b>종가</b>까지의 정보로 판단하고, 매수·매도도 종가로 가정했습니다. ' +
      '실제로는 그 가격에 살 수 없습니다. 거래비용은 설정에서 ' +
      (S.cost * 100).toFixed(1) + '%를 왕복으로 뺐습니다. 슬리피지와 세금은 들어 있지 않습니다.');

    return p;
  }

  function oosPanel(host) {
    const R = S.result;
    const p = App.panel('채점 구간에서 확인 <span class="accent">OUT-OF-SAMPLE</span>',
      { sub: '개발 구간에서 찾은 규칙이 처음 보는 1년에서도 통하는가' });

    if (!S.oos) {
      const w = U.el('div', 'note warn');
      w.innerHTML =
        '여기를 누르면 <b>그동안 잠겨 있던 최근 12개월</b>에서 같은 신호로 다시 셉니다.<br><br>' +
        '<b>주의.</b> 채점 구간을 여러 번 보면 그 구간도 결국 개발 구간이 됩니다. ' +
        '조건을 바꿔가며 여기서 잘 나올 때까지 돌리는 순간 이 구조는 무너집니다. ' +
        (S.peeks ? '지금까지 <b>' + S.peeks + '번</b> 봤습니다.' : '아직 한 번도 보지 않았습니다.');
      p.body.appendChild(w);

      const btn = U.el('button', 'btn' + (S.peeks >= 3 ? '' : ' primary'),
        S.oosRunning ? '확인 중…' : '채점 구간에서 돌리기');
      btn.disabled = S.oosRunning;
      btn.addEventListener('click', function () { runOOS(host); });
      p.body.appendChild(btn);
      if (S.oosRunning) {
        const bar = U.el('div', 'bar');
        bar.style.marginTop = '10px';
        const i = U.el('i'); i.id = 'bounceProg'; i.style.width = '0%';
        bar.appendChild(i);
        p.body.appendChild(bar);
      }
      return p;
    }

    const O = S.oos;
    const isRow = R.best;
    const osRow = O.rows.filter(function (r) { return r.h === R.best.h; })[0];

    p.body.appendChild(U.el('div', 'tiny',
      O.range.start + ' ~ ' + O.range.end + ' · 신호 ' + U.comma(O.nSignals) + '건 · ' + S.peeks + '번째 확인'));

    p.body.appendChild(App.table(
      ['항목 (보유 ' + R.best.h + '일 고정)', { label: '개발 구간', num: true },
        { label: '채점 구간', num: true }, { label: '차이', num: true }],
      [
        ['반등확률',
          isFinite(isRow.win) ? (isRow.win * 100).toFixed(1) + '%' : '—',
          osRow && isFinite(osRow.win) ? (osRow.win * 100).toFixed(1) + '%' : '—',
          (osRow && isFinite(isRow.win) && isFinite(osRow.win))
            ? ((osRow.win - isRow.win) * 100).toFixed(1) + '%p' : '—'],
        ['기준선 대비 초과',
          isFinite(isRow.excess) ? (isRow.excess * 100).toFixed(2) + '%p' : '—',
          osRow && isFinite(osRow.excess) ? (osRow.excess * 100).toFixed(2) + '%p' : '—',
          (osRow && isFinite(isRow.excess) && isFinite(osRow.excess))
            ? ((osRow.excess - isRow.excess) * 100).toFixed(2) + '%p' : '—'],
        ['표본 수', U.comma(isRow.n), osRow ? U.comma(osRow.n) : '—', '']
      ]));

    const held = osRow && isFinite(osRow.excess) && osRow.excess > 0;
    const n = U.el('div', 'note ' + (held ? 'ok' : 'warn'));
    n.innerHTML = held
      ? '채점 구간에서도 초과수익이 양수로 남았습니다. 다만 표본이 ' + (osRow ? osRow.n : 0) + '건뿐이고 ' +
        '1년치라 우연일 수 있습니다. <b>양수라는 것과 통한다는 것은 다릅니다.</b>'
      : '<b>채점 구간에서는 초과수익이 사라졌습니다.</b> 개발 구간에서 보인 것은 그 기간에만 맞는 규칙이었을 가능성이 큽니다. ' +
        '여기서 하지 말아야 할 것 — 조건을 바꿔 다시 돌리는 것. 그러면 채점 구간이 개발 구간이 됩니다.';
    p.body.appendChild(n);

    p.body.appendChild(U.el('div', 'tiny',
      '참고 — 채점 구간에서 가장 좋았던 보유 기간은 ' + O.best.h + '일입니다. ' +
      (O.best.h === R.best.h
        ? '개발 구간과 같습니다. 이건 의미 있는 신호입니다.'
        : '개발 구간의 ' + R.best.h + '일과 다릅니다. "최적 보유 기간"이 구간마다 달라진다는 뜻입니다.')));

    return p;
  }

  function introPanel() {
    const p = App.panel('무엇을 하는 화면인가');
    const d = U.el('div');
    d.innerHTML =
      '<p>"많이 떨어진 종목을 사면 반등하지 않을까?" — 누구나 한 번은 하는 생각입니다. ' +
      '이 화면은 그 생각을 <b>실제 데이터로 검증</b>합니다.</p>' +
      '<p>어떤 조건이 만족된 시점을 모두 찾고, 그 시점에 샀다면 1·3·5·10·20·40·60일 뒤에 각각 얼마가 ' +
      '되었는지를 셉니다. 학계에서 <b>이벤트 스터디</b>라고 부르는 방식입니다.</p>' +
      '<p><b>여기서 가장 중요한 것.</b> 반등 확률 62%라는 숫자 하나는 아무 의미가 없습니다. ' +
      '아무 날이나 샀어도 58%였다면 낙폭이 보탠 것은 4%p뿐이고, 그건 거래비용에 묻힙니다. ' +
      '그래서 이 화면은 모든 숫자 옆에 <b>기준선</b>을 나란히 놓습니다.</p>' +
      '<p><b>두 가지 모드가 있습니다.</b><br>' +
      '「하나 자세히 보기」는 신호 하나를 골라 보유 기간별로 훑고, 업종별로 갈라 보고, ' +
      '<b>시장이 같이 빠졌을 때와 그 종목만 빠졌을 때</b>를 나눠서 봅니다.<br>' +
      '「열 가지 전부 비교」는 낙폭·RSI·이동평균·급락 등 <b>' + SIGNALS.length + '가지 신호를 한 화면에</b> 놓습니다. ' +
      '하나씩 돌려 보고 제일 좋은 것을 고르는 것이 가장 흔한 함정이라서, 아예 다 같이 보게 만들었습니다.</p>' +
      '<p>그리고 이 화면에는 <b>생존 편향</b>이라는 큰 함정이 있습니다. ' +
      '떨어진 뒤 돌아오지 못한 회사는 데이터에서 이미 사라졌습니다. ' +
      '분석을 돌리면 그 이야기를 다시 자세히 적어 두겠습니다.</p>';
    p.body.appendChild(d);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  그리기
   * ----------------------------------------------------------------------*/
  function draw(host) {
    host.innerHTML = '';
    host.appendChild(setupPanel(host));

    if (S.mode === 'one' && S.result) {
      host.appendChild(resultPanel());
      const mp = splitPanel();
      if (mp) host.appendChild(mp);
      const sp = sectorPanel();
      if (sp) host.appendChild(sp);
      host.appendChild(honestyPanel());
      host.appendChild(oosPanel(host));
    } else if (S.mode === 'ai' && S.ai) {
      host.appendChild(aiPanel());
      if (!S.ai.tooFew) host.appendChild(aiHonesty());
    } else if (S.mode === 'compare' && S.compare) {
      host.appendChild(comparePanel(host));
      host.appendChild(honestyPanel());
    } else if (!S.running) {
      host.appendChild(introPanel());
    }
  }

  App.register('bounce', { render: draw });
})(window.QL = window.QL || {});
