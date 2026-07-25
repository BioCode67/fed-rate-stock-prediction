/* ============================================================================
 *  data.js — 데이터 준비
 *   1) 데모용 가상 데이터 생성 (시드 고정)   ※ 실제 시장 데이터가 아닙니다
 *   2) CSV 불러오기 (파일 업로드 / 붙여넣기)
 *   3) 인터넷에서 직접 받기 (Alpha Vantage / FRED / Stooq)
 *   4) 특징(feature) 생성 — phase1a_model_comparison.py의 make_features와 동일
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;
  const D = {};

  /* --------------------------------------------------------------------------
   *  특징 정의 — 파이썬 코드와 같은 구성
   *  정상성(stationarity): 주가·금리를 그대로 쓰지 않고 비율/변화량으로 바꿔 씁니다.
   * ------------------------------------------------------------------------*/
  D.BASE_FEATURES = ['return', 'px_vs_ma5', 'px_vs_ma20', 'ma5_vs_ma20'];
  D.RATE_FEATURES = ['rate_change', 'rate_change_20'];
  D.EXTRA_FEATURES = ['vol20', 'mom60'];
  D.FEATURE_LABEL = {
    'return': '일간 등락률',
    'px_vs_ma5': '주가/5일평균-1 (단기 이격도)',
    'px_vs_ma20': '주가/20일평균-1 (중기 이격도)',
    'ma5_vs_ma20': '5일평균/20일평균-1 (모멘텀)',
    'rate_change': '하루 금리 변화',
    'rate_change_20': '20일 금리 변화',
    'vol20': '20일 변동성 (확장)',
    'mom60': '60일 모멘텀 (확장)'
  };
  // 좁은 표에서 쓰는 짧은 이름
  D.FEATURE_SHORT = {
    'return': '등락률', 'px_vs_ma5': '단기이격', 'px_vs_ma20': '중기이격', 'ma5_vs_ma20': '모멘텀',
    'rate_change': '금리변화(1일)', 'rate_change_20': '금리변화(20일)', 'vol20': '변동성', 'mom60': '장기모멘텀'
  };

  /* ==========================================================================
   *  [1] 데모용 가상 데이터
   * ------------------------------------------------------------------------
   *  실제 시장 데이터를 흉내 낸 '가상' 시계열입니다. 화면 어디에서나 '가상'이라고
   *  표시합니다. 실제 시장 데이터가 필요하면 CSV 탭 또는 인터넷 불러오기를 쓰세요.
   *
   *  구성
   *   - 금리: 시기별로 다른 목표금리를 향해 천천히 움직이고, 정책 발표일에 점프
   *   - 주가: 대부분 예측 불가능한 잡음 + (선택) 아주 약한 숨은 신호
   *   - 변동성: 뭉쳐서 온다(volatility clustering) — GARCH 비슷한 구조
   *  '숨은 신호 강도'를 0으로 두면 이론상 예측이 전혀 되지 않아야 하며,
   *  그때 모델의 AUC가 0.5 근처로 나오는지 확인하는 것이 좋은 점검이 됩니다.
   * ========================================================================*/
  D.makeDemo = function (opts) {
    opts = opts || {};
    const n = opts.n || 3800;                 // 거래일 수 (약 15년)
    const signal = (opts.signal === undefined ? 0.06 : opts.signal); // 숨은 신호 강도 0~0.3
    const seed = opts.seed || 42;
    const rnd = U.rng(seed);

    // 시기별 금리 목표 (실제 역사를 흉내 낸 가상의 값)
    const regimes = [
      { until: 0.42, target: 0.5 },   // 저금리기
      { until: 0.62, target: 2.4 },   // 정상화기
      { until: 0.74, target: 0.2 },   // 위기 대응 인하기
      { until: 0.90, target: 4.8 },   // 급격한 인상기
      { until: 1.01, target: 3.6 }    // 완화 전환기
    ];

    const dates = [], close = new Float64Array(n), rate = new Float64Array(n);
    const isPolicyDay = new Uint8Array(n);

    // GARCH(1,1) 계수: ω=2.2e-6, α=0.08, β=0.90 → 장기 평균 변동성 연 16~17%
    const OMEGA = 2.2e-6, ALPHA = 0.08, BETA = 0.90;
    let px = 1000, r = 0.6, vol = 0.0105, prevShock = 0;
    // 시작일: 데모는 2010-01-04(월)부터 주말을 건너뛰며 하루씩
    let cur = new Date(Date.UTC(2010, 0, 4));

    for (let i = 0; i < n; i++) {
      // 날짜 (주말 제외)
      while (cur.getUTCDay() === 0 || cur.getUTCDay() === 6) cur.setUTCDate(cur.getUTCDate() + 1);
      dates.push(new Date(cur.getTime()));
      cur.setUTCDate(cur.getUTCDate() + 1);

      // 정책 발표일: 약 6주(30거래일)마다
      const policy = (i % 30 === 12);
      isPolicyDay[i] = policy ? 1 : 0;

      // 금리: 목표를 향해 천천히 + 발표일엔 점프
      const frac = i / n;
      let target = regimes[regimes.length - 1].target;
      for (let k = 0; k < regimes.length; k++) { if (frac < regimes[k].until) { target = regimes[k].target; break; } }
      r += (target - r) * 0.004 + rnd.normal() * 0.012;
      if (policy) r += rnd.normal() * 0.09;
      r = Math.max(0.02, r);
      rate[i] = r;

      // 변동성 뭉침 (GARCH(1,1) 형태)
      vol = Math.sqrt(OMEGA + ALPHA * prevShock * prevShock + BETA * vol * vol);
      // 발표일엔 그날만 더 출렁이게 합니다 (가설 H5 확인용).
      // 상태값 vol 자체를 키우면 발표 때마다 변동성이 계단식으로 커져 버리므로
      // '그날의 변동성'에만 배수를 곱합니다.
      const dayVol = policy ? vol * 1.4 : vol;

      // 수익률 = 완만한 추세 + 잡음 + (선택) 숨은 신호
      let hidden = 0;
      if (signal > 0 && i > 60) {
        const mom = px / close[i - 20] - 1;           // 최근 한 달 모멘텀
        const dRate = rate[i] - rate[i - 20];         // 최근 한 달 금리 변화
        hidden = signal * (0.35 * Math.tanh(mom * 8) - 0.45 * Math.tanh(dRate * 2)) * dayVol;
      }
      const shock = rnd.normal() * dayVol;
      const ret = 0.0004 + hidden + shock;            // 연 8~10% 정도의 완만한 상승 추세
      prevShock = shock;
      px = px * (1 + ret);
      close[i] = px;
    }

    return {
      dates: dates, close: close, rate: rate, isPolicyDay: isPolicyDay,
      meta: {
        name: '데모(가상) 데이터',
        source: 'demo',
        synthetic: true,
        priceLabel: '가상 주가지수',
        rateLabel: '가상 정책금리(%)',
        note: '실제 시장 데이터가 아닌, 시드를 고정해 만든 가상 시계열입니다.',
        signal: signal
      }
    };
  };

  /* ==========================================================================
   *  [1-2] 데모용 가상 '여러 종목' 데이터 — Phase 3(종목 순위)용
   * ------------------------------------------------------------------------
   *  구성: 시장 전체가 함께 움직이는 부분(시장 요인) + 종목마다 다른 부분(고유 변동)
   *       + (선택) 아주 약한 모멘텀 신호. 실제 종목이 아니라 가상의 A~T사입니다.
   * ========================================================================*/
  D.makeDemoUniverse = function (opts) {
    opts = opts || {};
    const nStock = opts.nStock || 24;
    const n = opts.n || 2600;                       // 약 10년치 거래일
    const signal = (opts.signal === undefined ? 0.05 : opts.signal);
    const rnd = U.rng(opts.seed || 7);

    const dates = [];
    let cur = new Date(Date.UTC(2015, 0, 2));
    for (let i = 0; i < n; i++) {
      while (cur.getUTCDay() === 0 || cur.getUTCDay() === 6) cur.setUTCDate(cur.getUTCDate() + 1);
      dates.push(new Date(cur.getTime()));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const names = [];
    for (let s = 0; s < nStock; s++) {
      names.push('가상' + String.fromCharCode(65 + (s % 26)) + (s >= 26 ? Math.floor(s / 26) : '') + '사');
    }
    const MKT_DRIFT = 0.00035;                      // 시장 요인의 하루 평균 상승
    const beta = [], idioVol = [], drift = [];
    for (let s = 0; s < nStock; s++) {
      beta.push(0.6 + rnd() * 0.9);                 // 시장 민감도 0.6~1.5
      idioVol.push(0.010 + rnd() * 0.012);          // 고유 변동성
      // 종목별 추세는 베타의 영향을 상쇄해서 넣습니다.
      // 이렇게 하지 않으면 '베타가 높은 종목이 원래 더 오른다'는 관계가 생겨,
      // 숨은 신호를 0으로 둬도 변동성만 보고 순위를 맞힐 수 있게 됩니다.
      // 그러면 "신호 0 = 예측 불가"라는 점검이 성립하지 않습니다.
      drift.push(MKT_DRIFT + (rnd() - 0.5) * 0.00012 - beta[s] * MKT_DRIFT);
    }

    const close = {}, px = new Float64Array(nStock);
    names.forEach(function (t) { close[t] = new Float64Array(n); });
    for (let s = 0; s < nStock; s++) px[s] = 10000 + rnd() * 40000;

    const bench = new Float64Array(n);
    let mkt = 1000, mktVol = 0.0105, prevShock = 0;

    for (let i = 0; i < n; i++) {
      mktVol = Math.sqrt(2.2e-6 + 0.08 * prevShock * prevShock + 0.90 * mktVol * mktVol);
      const mShock = rnd.normal() * mktVol;
      prevShock = mShock;
      const mRet = MKT_DRIFT + mShock;
      mkt *= (1 + mRet);
      bench[i] = mkt;

      for (let s = 0; s < nStock; s++) {
        let hidden = 0;
        if (signal > 0 && i > 130) {
          // 6개월 모멘텀이 높은 종목이 아주 조금 더 오르는 구조 (찾아낼 수 있는지 확인용)
          const arr = close[names[s]];
          const mom6 = arr[i - 1] / arr[i - 126] - 1;
          hidden = signal * Math.tanh(mom6 * 2) * idioVol[s] * 0.6;
        }
        const ret = drift[s] + beta[s] * mRet + hidden + rnd.normal() * idioVol[s];
        px[s] *= (1 + ret);
        close[names[s]][i] = px[s];
      }
    }

    return {
      dates: dates, tickers: names, close: close, bench: bench,
      meta: {
        name: '데모(가상) 종목 ' + nStock + '개', synthetic: true,
        benchLabel: '가상 시장지수',
        signal: signal,
        note: '실제 종목이 아닙니다. 시드를 고정해 만든 가상의 주가입니다.'
      }
    };
  };

  /* --------------------------------------------------------------------------
   *  여러 종목 CSV 읽기
   *  (1) 넓은 형식: 첫 열이 날짜, 나머지 열이 종목별 종가
   *  (2) 좁은 형식: Date, Ticker, Close 세 열
   * ------------------------------------------------------------------------*/
  D.parseUniverseCSV = function (text, name) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim().length; });
    if (lines.length < 30) throw new Error('줄이 너무 적습니다(' + lines.length + '줄).');
    const split = function (l) { return l.split(/[,\t;]/).map(function (s) { return s.trim().replace(/^"|"$/g, ''); }); };
    const head = split(lines[0]);
    const lower = head.map(function (h) { return h.toLowerCase().replace(/\s+/g, ''); });
    const num = function (s) { const v = parseFloat(String(s).replace(/[",$₩\s]/g, '')); return isFinite(v) ? v : NaN; };

    const iTicker = lower.indexOf('ticker') >= 0 ? lower.indexOf('ticker')
      : (lower.indexOf('종목') >= 0 ? lower.indexOf('종목') : (lower.indexOf('symbol') >= 0 ? lower.indexOf('symbol') : -1));
    const rows = {};      // ticker -> {dateStr: close}
    const dateSet = {};

    if (iTicker >= 0) {                                  // 좁은 형식
      const iDate = 0;
      let iClose = lower.indexOf('close');
      if (iClose < 0) iClose = lower.indexOf('종가');
      if (iClose < 0) throw new Error("종가(Close) 열을 찾지 못했습니다.");
      for (let k = 1; k < lines.length; k++) {
        const c = split(lines[k]);
        const d = U.parseDate(c[iDate]); const v = num(c[iClose]);
        if (!d || !isFinite(v) || v <= 0) continue;
        const t = c[iTicker];
        (rows[t] = rows[t] || {})[U.dstr(d)] = v;
        dateSet[U.dstr(d)] = 1;
      }
    } else {                                             // 넓은 형식
      for (let j = 1; j < head.length; j++) rows[head[j]] = {};
      for (let k = 1; k < lines.length; k++) {
        const c = split(lines[k]);
        const d = U.parseDate(c[0]);
        if (!d) continue;
        const key = U.dstr(d);
        let any = false;
        for (let j = 1; j < head.length; j++) {
          const v = num(c[j]);
          if (isFinite(v) && v > 0) { rows[head[j]][key] = v; any = true; }
        }
        if (any) dateSet[key] = 1;
      }
    }

    const dateKeys = Object.keys(dateSet).sort();
    if (dateKeys.length < 30) throw new Error('날짜가 너무 적습니다(' + dateKeys.length + '개).');
    const tickers = Object.keys(rows).filter(function (t) {
      return Object.keys(rows[t]).length > dateKeys.length * 0.6;   // 결측이 많은 종목 제외
    });
    if (tickers.length < 5) throw new Error('쓸 수 있는 종목이 ' + tickers.length + '개뿐입니다. 최소 5종목이 필요합니다.');

    const close = {};
    tickers.forEach(function (t) {
      const arr = new Float64Array(dateKeys.length);
      let last = NaN;
      for (let i = 0; i < dateKeys.length; i++) {
        const v = rows[t][dateKeys[i]];
        if (v !== undefined) last = v;
        arr[i] = last;                                   // 휴장일은 직전 값 유지
      }
      close[t] = arr;
    });
    return {
      dates: dateKeys.map(function (k) { return U.parseDate(k); }),
      tickers: tickers, close: close, bench: null,
      meta: { name: name || '내 종목 데이터', synthetic: false, benchLabel: '', note: '' }
    };
  };

  /* ==========================================================================
   *  [2] CSV 읽기
   *  허용 열 이름: 날짜 = Date/date/날짜/일자,  종가 = Close/Adj Close/종가/현재가
   *               금리 = Rate/rate/금리/DGS2  (없으면 금리 없이 진행)
   * ========================================================================*/
  D.parseCSV = function (text, name) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim().length; });
    if (lines.length < 30) throw new Error('줄이 너무 적습니다(' + lines.length + '줄). 최소 30줄 이상 필요합니다.');

    const splitLine = function (line) {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { q = !q; continue; }
        if ((c === ',' || c === '\t' || c === ';') && !q) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      out.push(cur);
      return out.map(function (s) { return s.trim(); });
    };

    const head = splitLine(lines[0]).map(function (h) { return h.toLowerCase().replace(/\s+/g, ''); });
    const find = function (cands) {
      for (let i = 0; i < head.length; i++) if (cands.indexOf(head[i]) >= 0) return i;
      return -1;
    };
    const iDate = find(['date', '날짜', '일자', 'time', 'datetime', 'index']);
    let iClose = find(['close', 'adjclose', 'close/last', '종가', '현재가', 'price', 'sp500', 'value']);
    const iRate = find(['rate', '금리', 'dgs2', 'dgs10', 'yield', 'interest']);

    if (iDate < 0) throw new Error("날짜 열을 찾지 못했습니다. 첫 줄에 'Date' 또는 '날짜' 열이 있어야 합니다.");
    if (iClose < 0) throw new Error("종가 열을 찾지 못했습니다. 'Close' 또는 '종가' 열이 있어야 합니다.");

    const num = function (s) {
      const v = parseFloat(String(s).replace(/[",$₩\s]/g, ''));
      return isFinite(v) ? v : NaN;
    };

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = splitLine(lines[i]);
      const d = U.parseDate(c[iDate]);
      const p = num(c[iClose]);
      if (!d || !isFinite(p) || p <= 0) continue;
      const rt = iRate >= 0 ? num(c[iRate]) : NaN;
      rows.push({ d: d, p: p, r: rt });
    }
    if (rows.length < 30) throw new Error('쓸 수 있는 행이 ' + rows.length + '개뿐입니다. 날짜/종가 형식을 확인하세요.');
    rows.sort(function (a, b) { return a.d - b.d; });

    const dates = [], close = new Float64Array(rows.length), rate = new Float64Array(rows.length);
    let lastRate = NaN, hasRate = false;
    for (let i = 0; i < rows.length; i++) {
      dates.push(rows[i].d);
      close[i] = rows[i].p;
      if (isFinite(rows[i].r)) { lastRate = rows[i].r; hasRate = true; }
      rate[i] = lastRate;               // 금리는 휴일 결측 → 직전 값 유지(ffill)
    }
    // 앞부분 금리 결측은 첫 유효값으로 채움
    if (hasRate) {
      let first = NaN;
      for (let i = 0; i < rate.length; i++) { if (isFinite(rate[i])) { first = rate[i]; break; } }
      for (let i = 0; i < rate.length; i++) { if (!isFinite(rate[i])) rate[i] = first; else break; }
    }

    return {
      dates: dates, close: close, rate: hasRate ? rate : null, isPolicyDay: null,
      meta: {
        name: name || '내 CSV 데이터',
        source: 'csv', synthetic: false,
        priceLabel: '종가', rateLabel: '금리(%)',
        note: hasRate ? '' : '금리 열이 없어 금리 특징은 사용할 수 없습니다.'
      }
    };
  };

  /* ==========================================================================
   *  [3] 인터넷에서 직접 받기
   *  브라우저에서 직접 부르므로 CORS를 허용하는 곳만 됩니다.
   *  가장 안정적인 것은 Alpha Vantage(무료 키)입니다.
   * ========================================================================*/
  const jget = function (url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  };

  // Alpha Vantage: 주가(TIME_SERIES_DAILY) + 금리(TREASURY_YIELD)
  D.fetchAlphaVantage = function (symbol, key, maturity, onLog) {
    const log = onLog || function () {};
    const base = 'https://www.alphavantage.co/query?';
    log('주가 내려받는 중… (' + symbol + ')');
    return jget(base + 'function=TIME_SERIES_DAILY&outputsize=full&symbol=' + encodeURIComponent(symbol) + '&apikey=' + encodeURIComponent(key))
      .then(function (js) {
        if (js['Note'] || js['Information']) throw new Error('Alpha Vantage 제한/안내: ' + (js['Note'] || js['Information']));
        if (js['Error Message']) throw new Error('종목 코드를 확인하세요: ' + js['Error Message']);
        const ts = js['Time Series (Daily)'];
        if (!ts) throw new Error('주가 응답 형식이 예상과 다릅니다.');
        const rows = Object.keys(ts).sort().map(function (d) {
          return { d: U.parseDate(d), p: parseFloat(ts[d]['4. close']) };
        }).filter(function (r) { return r.d && isFinite(r.p); });
        log('주가 ' + rows.length.toLocaleString('ko-KR') + '일 확보. 금리 내려받는 중…');
        return jget(base + 'function=TREASURY_YIELD&interval=daily&maturity=' + (maturity || '2year') + '&apikey=' + encodeURIComponent(key))
          .then(function (rj) {
            const rd = {};
            (rj['data'] || []).forEach(function (o) {
              const v = parseFloat(o.value);
              if (isFinite(v)) rd[o.date] = v;
            });
            return { rows: rows, rateMap: rd, hasRate: Object.keys(rd).length > 50 };
          })
          .catch(function () { return { rows: rows, rateMap: {}, hasRate: false }; });
      })
      .then(function (res) {
        const dates = [], close = new Float64Array(res.rows.length), rate = new Float64Array(res.rows.length);
        let last = NaN;
        for (let i = 0; i < res.rows.length; i++) {
          dates.push(res.rows[i].d);
          close[i] = res.rows[i].p;
          const key2 = U.dstr(res.rows[i].d);
          if (res.rateMap[key2] !== undefined) last = res.rateMap[key2];
          rate[i] = last;
        }
        if (res.hasRate) {
          let first = NaN;
          for (let i = 0; i < rate.length; i++) if (isFinite(rate[i])) { first = rate[i]; break; }
          for (let i = 0; i < rate.length; i++) { if (!isFinite(rate[i])) rate[i] = first; else break; }
        }
        return {
          dates: dates, close: close, rate: res.hasRate ? rate : null, isPolicyDay: null,
          meta: {
            name: symbol + ' (Alpha Vantage)', source: 'alphavantage', synthetic: false,
            priceLabel: symbol + ' 종가', rateLabel: '미국 국채금리(%)',
            note: res.hasRate ? '' : '금리를 받지 못해 금리 특징은 사용할 수 없습니다.'
          }
        };
      });
  };

  // FRED: 주가 시리즈 + 금리 시리즈 (CORS가 막히면 실패할 수 있음)
  D.fetchFred = function (priceSeries, rateSeries, key, start, end, onLog) {
    const log = onLog || function () {};
    const base = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + encodeURIComponent(key);
    const one = function (sid) {
      return jget(base + '&series_id=' + encodeURIComponent(sid) +
        '&observation_start=' + start + '&observation_end=' + end)
        .then(function (js) {
          const out = {};
          (js.observations || []).forEach(function (o) {
            const v = parseFloat(o.value);
            if (isFinite(v)) out[o.date] = v;
          });
          return out;
        });
    };
    log('FRED에서 ' + priceSeries + ' 내려받는 중…');
    return one(priceSeries).then(function (pm) {
      log('FRED에서 ' + rateSeries + ' 내려받는 중…');
      return one(rateSeries).then(function (rm) {
        const keys = Object.keys(pm).sort();
        if (keys.length < 100) throw new Error('주가 관측치가 너무 적습니다(' + keys.length + '개).');
        const dates = [], close = new Float64Array(keys.length), rate = new Float64Array(keys.length);
        let last = NaN;
        for (let i = 0; i < keys.length; i++) {
          dates.push(U.parseDate(keys[i]));
          close[i] = pm[keys[i]];
          if (rm[keys[i]] !== undefined) last = rm[keys[i]];
          rate[i] = last;
        }
        let first = NaN;
        for (let i = 0; i < rate.length; i++) if (isFinite(rate[i])) { first = rate[i]; break; }
        for (let i = 0; i < rate.length; i++) { if (!isFinite(rate[i])) rate[i] = first; else break; }
        return {
          dates: dates, close: close, rate: isFinite(first) ? rate : null, isPolicyDay: null,
          meta: {
            name: priceSeries + ' + ' + rateSeries + ' (FRED)', source: 'fred', synthetic: false,
            priceLabel: priceSeries, rateLabel: rateSeries + '(%)', note: ''
          }
        };
      });
    });
  };

  // Stooq: 키가 필요 없지만 CORS 정책상 브라우저에서 막힐 수 있습니다.
  D.fetchStooq = function (symbol) {
    const url = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(symbol) + '&i=d';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      const data = D.parseCSV(t, symbol + ' (Stooq)');
      data.meta.source = 'stooq';
      return data;
    });
  };

  /* ==========================================================================
   *  [4] 특징 만들기 — phase1a/1b의 make_features와 동일한 정의
   * ========================================================================*/
  D.makeFeatures = function (data) {
    const n = data.close.length;
    const c = data.close, rt = data.rate;
    const f = {};
    const nan = function () { const a = new Float64Array(n); a.fill(NaN); return a; };

    const ret = nan(), ma5 = nan(), ma20 = nan();
    for (let i = 1; i < n; i++) ret[i] = c[i] / c[i - 1] - 1;
    let s5 = 0, s20 = 0;
    for (let i = 0; i < n; i++) {
      s5 += c[i]; if (i >= 5) s5 -= c[i - 5];
      s20 += c[i]; if (i >= 20) s20 -= c[i - 20];
      if (i >= 4) ma5[i] = s5 / 5;
      if (i >= 19) ma20[i] = s20 / 20;
    }
    f['return'] = ret;
    f['px_vs_ma5'] = nan(); f['px_vs_ma20'] = nan(); f['ma5_vs_ma20'] = nan();
    for (let i = 0; i < n; i++) {
      if (isFinite(ma5[i])) f['px_vs_ma5'][i] = c[i] / ma5[i] - 1;
      if (isFinite(ma20[i])) f['px_vs_ma20'][i] = c[i] / ma20[i] - 1;
      if (isFinite(ma5[i]) && isFinite(ma20[i])) f['ma5_vs_ma20'][i] = ma5[i] / ma20[i] - 1;
    }
    // 확장 특징
    f['vol20'] = nan(); f['mom60'] = nan();
    for (let i = 20; i < n; i++) {
      let m = 0; for (let k = i - 19; k <= i; k++) m += ret[k]; m /= 20;
      let v = 0; for (let k = i - 19; k <= i; k++) v += (ret[k] - m) * (ret[k] - m);
      f['vol20'][i] = Math.sqrt(v / 19);
    }
    for (let i = 60; i < n; i++) f['mom60'][i] = c[i] / c[i - 60] - 1;

    // 금리 특징 (금리 '수준'이 아니라 '변화'를 씁니다)
    if (rt) {
      f['rate_change'] = nan(); f['rate_change_20'] = nan();
      for (let i = 1; i < n; i++) f['rate_change'][i] = rt[i] - rt[i - 1];
      for (let i = 20; i < n; i++) f['rate_change_20'][i] = rt[i] - rt[i - 20];
    }
    return f;
  };

  /* --------------------------------------------------------------------------
   *  지도학습용 표 만들기
   *  목표 = horizon일 뒤 종가가 오늘보다 높으면 1, 아니면 0
   *  누수 방지: 특징은 '오늘까지'만, 마지막 horizon일은 정답이 없어 제외
   * ------------------------------------------------------------------------*/
  D.buildSupervised = function (data, feats, featureCols, horizon) {
    const n = data.close.length, c = data.close;
    const rows = [];
    for (let i = 0; i < n; i++) {
      if (i + horizon >= n) break;                       // 미래가 없는 마지막 구간 제거
      let ok = isFinite(feats['return'][i]);
      const x = new Float64Array(featureCols.length);
      for (let j = 0; ok && j < featureCols.length; j++) {
        const v = feats[featureCols[j]] ? feats[featureCols[j]][i] : NaN;
        if (!isFinite(v)) { ok = false; break; }
        x[j] = v;
      }
      if (!ok) continue;                                  // 워밍업 결측 제거
      rows.push({
        i: i, date: data.dates[i], close: c[i],
        x: x, y: c[i + horizon] > c[i] ? 1 : 0,
        ret: feats['return'][i]
      });
    }
    const X = rows.map(function (r) { return r.x; });
    const y = Int8Array.from(rows.map(function (r) { return r.y; }));
    return {
      rows: rows, X: X, y: y, n: rows.length,
      featureCols: featureCols.slice(), horizon: horizon,
      dates: rows.map(function (r) { return r.date; }),
      close: Float64Array.from(rows.map(function (r) { return r.close; })),
      ret: Float64Array.from(rows.map(function (r) { return r.ret; }))
    };
  };

  root.D = D;
})(window.FRSP = window.FRSP || {});
