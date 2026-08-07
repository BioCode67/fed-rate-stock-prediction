/* ============================================================================
 *  expr.js — 알파 식 언어 (WorldQuant BRAIN의 Fast Expression 축소판)
 *
 *  IQC(International Quant Championship) 참가자가 실제로 쓰는 것이 이겁니다.
 *  슬라이더로 계수를 맞추는 게 아니라, 이런 한 줄을 씁니다.
 *
 *      rank(mom12_1) - 0.5 * rank(vol120)
 *      -ts_delta(close, 5) / ts_std_dev(returns, 20)
 *      group_neutralize(rank(volume / ts_mean(volume, 20)), sector)
 *
 *  값의 모양은 두 가지뿐입니다.
 *    스칼라  숫자 하나            (예: 0.5)
 *    벡터    그날 종목별 값 하나   (예: rank(close) → {AAPL: 0.83, ...})
 *  둘을 섞어 쓰면 스칼라가 모든 종목에 퍼집니다.
 *
 *  시계열 연산자(ts_*)는 과거 날짜의 같은 식을 다시 계산해서 씁니다.
 *  그래서 (노드, 날짜) 단위로 캐시를 둡니다. 캐시가 없으면 지수적으로 느려집니다.
 *
 *  ★ 미래를 보지 않습니다: 어떤 연산자도 i보다 뒤의 날짜를 읽지 않습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const DATA = root.DATA, STRAT = root.STRAT;
  const IND = STRAT.IND;

  const E = {};

  /* ------------------------------------------------------------------------
   *  데이터 필드
   * ----------------------------------------------------------------------*/
  const FIELDS = {
    close:   { desc: '수정 종가',        fn: function (s, i) { return IND.px(s, i); } },
    returns: { desc: '전일 대비 수익률',  fn: function (s, i) { return IND.mom(s, i, 1); } },
    volume:  { desc: '거래량',           fn: function (s, i, t) {
                 const v = DATA.state.volume[t]; return v ? v[i] : NaN; } },
    mom12_1: { desc: '12-1개월 모멘텀',   fn: function (s, i) { return IND.mom12_1(s, i); } },
    mom21:   { desc: '1개월 모멘텀',      fn: function (s, i) { return IND.mom(s, i, 21); } },
    mom5:    { desc: '1주 모멘텀',        fn: function (s, i) { return IND.mom(s, i, 5); } },
    vol120:  { desc: '변동성(6개월)',     fn: function (s, i) { return IND.vol(s, i, 120); } },
    vol20:   { desc: '변동성(1개월)',     fn: function (s, i) { return IND.vol(s, i, 20); } },
    trend:   { desc: '추세(50일/200일)',  fn: function (s, i) {
                 const a = IND.ma(s, i, 50), b = IND.ma(s, i, 200);
                 return (isFinite(a) && isFinite(b) && b > 0) ? a / b - 1 : NaN; } },
    rsi:     { desc: 'RSI(14일)',        fn: function (s, i) { return IND.rsi(s, i, 14); } },
    dd:      { desc: '고점 대비 낙폭',    fn: function (s, i) { return IND.drawdown(s, i, 126); } },
    vratio:  { desc: '거래량 급증(5일/60일)', fn: function (s, i, t) {
                 const v = DATA.state.volume[t];
                 if (!v) return NaN;
                 let a = 0, ca = 0, b = 0, cb = 0;
                 for (let k = Math.max(0, i - 4); k <= i; k++) if (v[k] !== null && isFinite(v[k])) { a += v[k]; ca++; }
                 for (let k = Math.max(0, i - 59); k <= i; k++) if (v[k] !== null && isFinite(v[k])) { b += v[k]; cb++; }
                 return (ca && cb && b > 0) ? (a / ca) / (b / cb) - 1 : NaN; } }
  };
  E.fields = FIELDS;

  // 그룹 연산자에 넘기는 특수 식별자
  const GROUPS = { sector: 1, market: 1 };

  /* ------------------------------------------------------------------------
   *  토크나이저
   * ----------------------------------------------------------------------*/
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        while (j < src.length && /[0-9.eE]/.test(src[j])) {
          if ((src[j] === 'e' || src[j] === 'E') && /[+-]/.test(src[j + 1] || '')) j++;
          j++;
        }
        out.push({ t: 'num', v: parseFloat(src.slice(i, j)), p: i });
        i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        out.push({ t: 'id', v: src.slice(i, j), p: i });
        i = j; continue;
      }
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!=', '&&', '||'].indexOf(two) >= 0) {
        out.push({ t: 'op', v: two, p: i }); i += 2; continue;
      }
      if ('+-*/%^(),<>'.indexOf(c) >= 0) { out.push({ t: 'op', v: c, p: i }); i++; continue; }
      throw new Error('알 수 없는 문자 "' + c + '" (' + i + '번째 글자)');
    }
    out.push({ t: 'end', v: '', p: src.length });
    return out;
  }

  /* ------------------------------------------------------------------------
   *  파서 (우선순위 오름차순으로 내려가는 방식)
   * ----------------------------------------------------------------------*/
  const BIN = [
    ['||'], ['&&'], ['<', '>', '<=', '>=', '==', '!='], ['+', '-'], ['*', '/', '%']
  ];

  function parse(src) {
    const tk = tokenize(src);
    let pos = 0;
    let nodeId = 0;
    const peek = function () { return tk[pos]; };
    const eat = function (v) {
      const t = tk[pos];
      if (v !== undefined && !(t.v === v)) throw new Error('"' + v + '" 가 필요합니다 (' + t.p + '번째 글자 근처)');
      pos++;
      return t;
    };
    const mk = function (n) { n.id = nodeId++; return n; };

    function parseBin(level) {
      if (level >= BIN.length) return parsePow();
      let left = parseBin(level + 1);
      for (;;) {
        const t = peek();
        if (t.t === 'op' && BIN[level].indexOf(t.v) >= 0) {
          eat();
          const right = parseBin(level + 1);
          left = mk({ type: 'bin', op: t.v, a: left, b: right });
        } else return left;
      }
    }

    // ^ 는 오른쪽 결합
    function parsePow() {
      const base = parseUnary();
      const t = peek();
      if (t.t === 'op' && t.v === '^') {
        eat();
        return mk({ type: 'bin', op: '^', a: base, b: parsePow() });
      }
      return base;
    }

    function parseUnary() {
      const t = peek();
      if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
        eat();
        const a = parseUnary();
        return t.v === '-' ? mk({ type: 'neg', a: a }) : a;
      }
      return parseAtom();
    }

    function parseAtom() {
      const t = peek();
      if (t.t === 'num') { eat(); return mk({ type: 'num', v: t.v }); }
      if (t.t === 'op' && t.v === '(') {
        eat();
        const e = parseBin(0);
        eat(')');
        return e;
      }
      if (t.t === 'id') {
        eat();
        if (peek().t === 'op' && peek().v === '(') {
          eat('(');
          const args = [];
          if (!(peek().t === 'op' && peek().v === ')')) {
            for (;;) {
              args.push(parseBin(0));
              if (peek().t === 'op' && peek().v === ',') { eat(','); continue; }
              break;
            }
          }
          eat(')');
          if (!FN[t.v]) throw new Error('모르는 연산자 "' + t.v + '"');
          const spec = FN[t.v];
          if (args.length < spec.min || args.length > spec.max) {
            throw new Error('"' + t.v + '" 는 인자가 ' + spec.min +
              (spec.min === spec.max ? '' : '~' + spec.max) + '개 필요합니다');
          }
          return mk({ type: 'call', name: t.v, args: args });
        }
        if (GROUPS[t.v]) return mk({ type: 'group', name: t.v });
        if (!FIELDS[t.v]) throw new Error('모르는 이름 "' + t.v + '" — 필드 목록을 확인하세요');
        return mk({ type: 'field', name: t.v });
      }
      throw new Error('식이 끝나지 않았습니다 (' + t.p + '번째 글자 근처)');
    }

    const e = parseBin(0);
    if (peek().t !== 'end') throw new Error('식 뒤에 남는 것이 있습니다 (' + peek().p + '번째 글자)');
    e.__nodes = nodeId;
    return e;
  }
  E.parse = parse;

  /* ------------------------------------------------------------------------
   *  평가
   * ----------------------------------------------------------------------*/
  function isVec(v) { return v !== null && typeof v === 'object'; }

  function universe(i, ctx) {
    let u = ctx.univ[i];
    if (!u) { u = ctx.univ[i] = DATA.tradables(i); }
    return u;
  }

  function vecOp(a, b, f, univ) {
    if (!isVec(a) && !isVec(b)) { const r = f(a, b); return isFinite(r) ? r : NaN; }
    const out = {};
    for (let k = 0; k < univ.length; k++) {
      const t = univ[k];
      const x = isVec(a) ? a[t] : a;
      const y = isVec(b) ? b[t] : b;
      if (x === undefined || y === undefined || !isFinite(x) || !isFinite(y)) continue;
      const r = f(x, y);
      if (isFinite(r)) out[t] = r;
    }
    return out;
  }

  function mapVec(a, f, univ) {
    if (!isVec(a)) { const r = f(a); return isFinite(r) ? r : NaN; }
    const out = {};
    for (let k = 0; k < univ.length; k++) {
      const t = univ[k];
      const x = a[t];
      if (x === undefined || !isFinite(x)) continue;
      const r = f(x);
      if (isFinite(r)) out[t] = r;
    }
    return out;
  }

  // 그날 종목들 사이의 순위 0~1
  function xsRank(v, univ) {
    const keys = univ.filter(function (t) { return isVec(v) ? isFinite(v[t]) : false; });
    if (keys.length < 2) return {};
    keys.sort(function (a, b) { return v[a] - v[b]; });
    const out = {};
    keys.forEach(function (t, k) { out[t] = k / (keys.length - 1); });
    return out;
  }

  function stats(v, univ) {
    let n = 0, s = 0;
    univ.forEach(function (t) { const x = v[t]; if (isFinite(x)) { n++; s += x; } });
    const m = n ? s / n : 0;
    let q = 0;
    univ.forEach(function (t) { const x = v[t]; if (isFinite(x)) q += (x - m) * (x - m); });
    return { n: n, mean: m, sd: n > 1 ? Math.sqrt(q / (n - 1)) : 0 };
  }

  function groupsOf(node, univ) {
    // group_neutralize(x, sector) 처럼 두 번째 인자가 그룹 이름일 때
    if (node && node.type === 'group' && node.name === 'sector') {
      const g = {};
      univ.forEach(function (t) { g[t] = DATA.sector(t) || '기타'; });
      return g;
    }
    const g = {};
    univ.forEach(function (t) { g[t] = 'ALL'; });
    return g;
  }

  /* ------------------------------------------------------------------------
   *  연산자 목록 (화면의 도움말도 이 표를 그대로 씁니다)
   * ----------------------------------------------------------------------*/
  const FN = {
    /* 횡단면 — 그날 종목들끼리 비교 */
    rank:      { min: 1, max: 1, cat: '횡단면', sig: 'rank(x)', desc: '그날 종목들 사이 순위를 0~1로. 이상치에 강해 거의 항상 씁니다.' },
    zscore:    { min: 1, max: 1, cat: '횡단면', sig: 'zscore(x)', desc: '(x − 평균) / 표준편차. 순위보다 크기 정보를 살립니다.' },
    scale:     { min: 1, max: 2, cat: '횡단면', sig: 'scale(x, a=1)', desc: '절대값 합이 a가 되게 맞춥니다. 비중을 만들 때 씁니다.' },
    winsorize: { min: 1, max: 2, cat: '횡단면', sig: 'winsorize(x, std=4)', desc: '평균에서 std배 넘게 벗어난 값을 잘라냅니다.' },
    quantile:  { min: 1, max: 2, cat: '횡단면', sig: 'quantile(x, n=5)', desc: 'n등분한 분위 번호(0~n-1).' },
    group_neutralize: { min: 2, max: 2, cat: '횡단면', sig: 'group_neutralize(x, sector)', desc: '그룹 평균을 뺍니다. 섹터 쏠림을 없앨 때. IQC에서 가장 많이 쓰는 연산자입니다.' },
    group_rank:       { min: 2, max: 2, cat: '횡단면', sig: 'group_rank(x, sector)', desc: '그룹 안에서만 순위를 매깁니다.' },

    /* 시계열 — 같은 종목의 과거와 비교 */
    ts_mean:    { min: 2, max: 2, cat: '시계열', sig: 'ts_mean(x, d)', desc: '최근 d일 평균.' },
    ts_std_dev: { min: 2, max: 2, cat: '시계열', sig: 'ts_std_dev(x, d)', desc: '최근 d일 표준편차.' },
    ts_sum:     { min: 2, max: 2, cat: '시계열', sig: 'ts_sum(x, d)', desc: '최근 d일 합.' },
    ts_max:     { min: 2, max: 2, cat: '시계열', sig: 'ts_max(x, d)', desc: '최근 d일 최댓값.' },
    ts_min:     { min: 2, max: 2, cat: '시계열', sig: 'ts_min(x, d)', desc: '최근 d일 최솟값.' },
    ts_rank:    { min: 2, max: 2, cat: '시계열', sig: 'ts_rank(x, d)', desc: '최근 d일 안에서 오늘 값이 몇 번째인지(0~1).' },
    ts_delta:   { min: 2, max: 2, cat: '시계열', sig: 'ts_delta(x, d)', desc: '오늘 값 − d일 전 값.' },
    ts_delay:   { min: 2, max: 2, cat: '시계열', sig: 'ts_delay(x, d)', desc: 'd일 전 값.' },
    ts_corr:    { min: 3, max: 3, cat: '시계열', sig: 'ts_corr(x, y, d)', desc: '최근 d일 동안 x와 y의 상관.' },
    decay_linear: { min: 2, max: 2, cat: '시계열', sig: 'decay_linear(x, d)', desc: '최근 d일을 가중평균(오늘이 가장 무겁게). 회전율을 낮추는 표준 기법입니다.' },

    /* 산술 */
    abs:     { min: 1, max: 1, cat: '산술', sig: 'abs(x)', desc: '절대값.' },
    log:     { min: 1, max: 1, cat: '산술', sig: 'log(x)', desc: '자연로그. 거래량처럼 꼬리가 긴 값에 씁니다.' },
    sqrt:    { min: 1, max: 1, cat: '산술', sig: 'sqrt(x)', desc: '제곱근.' },
    sign:    { min: 1, max: 1, cat: '산술', sig: 'sign(x)', desc: '부호(-1, 0, 1).' },
    power:   { min: 2, max: 2, cat: '산술', sig: 'power(x, n)', desc: 'x의 n제곱.' },
    min:     { min: 2, max: 2, cat: '산술', sig: 'min(x, y)', desc: '둘 중 작은 값.' },
    max:     { min: 2, max: 2, cat: '산술', sig: 'max(x, y)', desc: '둘 중 큰 값.' },
    if_else: { min: 3, max: 3, cat: '산술', sig: 'if_else(조건, a, b)', desc: '조건이 참이면 a, 아니면 b.' }
  };
  E.functions = FN;

  function constOf(node) {
    if (node.type === 'num') return node.v;
    if (node.type === 'neg' && node.a.type === 'num') return -node.a.v;
    throw new Error('여기에는 숫자가 들어가야 합니다 (예: ts_mean(close, 20))');
  }

  function evalNode(node, i, ctx) {
    if (i < 0) return {};
    const key = node.id + '|' + i;
    const hit = ctx.cache.get(key);
    if (hit !== undefined) return hit;
    const val = compute(node, i, ctx);
    ctx.cache.set(key, val);
    return val;
  }

  function compute(node, i, ctx) {
    const univ = universe(i, ctx);

    switch (node.type) {
      case 'num': return node.v;
      case 'group': return {};          // 그룹 이름 자체는 값이 아닙니다
      case 'neg': return mapVec(evalNode(node.a, i, ctx), function (x) { return -x; }, univ);

      case 'field': {
        const f = FIELDS[node.name];
        const out = {};
        for (let k = 0; k < univ.length; k++) {
          const t = univ[k];
          const v = f.fn(DATA.series(t), i, t);
          if (isFinite(v)) out[t] = v;
        }
        return out;
      }

      case 'bin': {
        const a = evalNode(node.a, i, ctx), b = evalNode(node.b, i, ctx);
        const f = {
          '+': function (x, y) { return x + y; },
          '-': function (x, y) { return x - y; },
          '*': function (x, y) { return x * y; },
          '/': function (x, y) { return y === 0 ? NaN : x / y; },
          '%': function (x, y) { return y === 0 ? NaN : x % y; },
          '^': function (x, y) { return Math.pow(x, y); },
          '<': function (x, y) { return x < y ? 1 : 0; },
          '>': function (x, y) { return x > y ? 1 : 0; },
          '<=': function (x, y) { return x <= y ? 1 : 0; },
          '>=': function (x, y) { return x >= y ? 1 : 0; },
          '==': function (x, y) { return x === y ? 1 : 0; },
          '!=': function (x, y) { return x !== y ? 1 : 0; },
          '&&': function (x, y) { return (x && y) ? 1 : 0; },
          '||': function (x, y) { return (x || y) ? 1 : 0; }
        }[node.op];
        return vecOp(a, b, f, univ);
      }

      case 'call': return callFn(node, i, ctx, univ);
    }
    throw new Error('알 수 없는 노드');
  }

  function callFn(node, i, ctx, univ) {
    const name = node.name, A = node.args;

    /* --- 시계열: 과거 날짜의 같은 식을 모읍니다 --- */
    if (name.indexOf('ts_') === 0 || name === 'decay_linear') {
      const dIdx = name === 'ts_corr' ? 2 : 1;
      const d = Math.max(1, Math.min(500, Math.round(constOf(A[dIdx]))));
      const hist = [];
      for (let k = 0; k < d; k++) hist.push(evalNode(A[0], i - k, ctx));
      let hist2 = null;
      if (name === 'ts_corr') {
        hist2 = [];
        for (let k = 0; k < d; k++) hist2.push(evalNode(A[1], i - k, ctx));
      }

      const out = {};
      for (let u = 0; u < univ.length; u++) {
        const t = univ[u];
        const xs = [];
        for (let k = 0; k < d; k++) {
          const v = isVec(hist[k]) ? hist[k][t] : hist[k];
          xs.push(isFinite(v) ? v : NaN);
        }
        const ok = xs.filter(function (x) { return isFinite(x); });
        if (ok.length < Math.max(2, d * 0.5)) continue;

        let r = NaN;
        if (name === 'ts_mean') r = ok.reduce(function (a, b) { return a + b; }, 0) / ok.length;
        else if (name === 'ts_sum') r = ok.reduce(function (a, b) { return a + b; }, 0);
        else if (name === 'ts_max') r = Math.max.apply(null, ok);
        else if (name === 'ts_min') r = Math.min.apply(null, ok);
        else if (name === 'ts_delay') r = xs[d - 1];
        else if (name === 'ts_delta') r = xs[0] - xs[d - 1];
        else if (name === 'ts_std_dev') {
          const m = ok.reduce(function (a, b) { return a + b; }, 0) / ok.length;
          let q = 0;
          ok.forEach(function (x) { q += (x - m) * (x - m); });
          r = Math.sqrt(q / Math.max(1, ok.length - 1));
        } else if (name === 'ts_rank') {
          if (isFinite(xs[0])) {
            let less = 0;
            ok.forEach(function (x) { if (x < xs[0]) less++; });
            r = ok.length > 1 ? less / (ok.length - 1) : 0.5;
          }
        } else if (name === 'decay_linear') {
          let s = 0, w = 0;
          for (let k = 0; k < d; k++) {
            if (!isFinite(xs[k])) continue;
            const wk = d - k;
            s += wk * xs[k]; w += wk;
          }
          r = w > 0 ? s / w : NaN;
        } else if (name === 'ts_corr') {
          const ys = [];
          for (let k = 0; k < d; k++) {
            const v = isVec(hist2[k]) ? hist2[k][t] : hist2[k];
            ys.push(isFinite(v) ? v : NaN);
          }
          const px = [], py = [];
          for (let k = 0; k < d; k++) if (isFinite(xs[k]) && isFinite(ys[k])) { px.push(xs[k]); py.push(ys[k]); }
          if (px.length >= 3) {
            const mx = px.reduce(function (a, b) { return a + b; }, 0) / px.length;
            const my = py.reduce(function (a, b) { return a + b; }, 0) / py.length;
            let sxy = 0, sxx = 0, syy = 0;
            for (let k = 0; k < px.length; k++) {
              const dx = px[k] - mx, dy = py[k] - my;
              sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
            }
            r = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : NaN;
          }
        }
        if (isFinite(r)) out[t] = r;
      }
      return out;
    }

    /* --- 횡단면 --- */
    if (name === 'rank') return xsRank(evalNode(A[0], i, ctx), univ);

    if (name === 'zscore') {
      const v = evalNode(A[0], i, ctx);
      const st = stats(v, univ);
      if (!(st.sd > 0)) return {};
      return mapVec(v, function (x) { return (x - st.mean) / st.sd; }, univ);
    }

    if (name === 'scale') {
      const v = evalNode(A[0], i, ctx);
      const a = A.length > 1 ? constOf(A[1]) : 1;
      let sum = 0;
      univ.forEach(function (t) { if (isFinite(v[t])) sum += Math.abs(v[t]); });
      if (!(sum > 0)) return {};
      return mapVec(v, function (x) { return x * a / sum; }, univ);
    }

    if (name === 'winsorize') {
      const v = evalNode(A[0], i, ctx);
      const k = A.length > 1 ? constOf(A[1]) : 4;
      const st = stats(v, univ);
      if (!(st.sd > 0)) return v;
      const lo = st.mean - k * st.sd, hi = st.mean + k * st.sd;
      return mapVec(v, function (x) { return x < lo ? lo : (x > hi ? hi : x); }, univ);
    }

    if (name === 'quantile') {
      const v = evalNode(A[0], i, ctx);
      const n = Math.max(2, Math.min(20, Math.round(A.length > 1 ? constOf(A[1]) : 5)));
      const r = xsRank(v, univ);
      return mapVec(r, function (x) { return Math.min(n - 1, Math.floor(x * n)); }, univ);
    }

    if (name === 'group_neutralize' || name === 'group_rank') {
      const v = evalNode(A[0], i, ctx);
      const g = groupsOf(A[1], univ);
      const acc = {};
      univ.forEach(function (t) {
        if (!isFinite(v[t])) return;
        const k = g[t];
        (acc[k] = acc[k] || []).push(t);
      });
      const out = {};
      Object.keys(acc).forEach(function (k) {
        const members = acc[k];
        if (name === 'group_neutralize') {
          let s = 0;
          members.forEach(function (t) { s += v[t]; });
          const m = s / members.length;
          members.forEach(function (t) { out[t] = v[t] - m; });
        } else {
          const sorted = members.slice().sort(function (a, b) { return v[a] - v[b]; });
          sorted.forEach(function (t, idx) {
            out[t] = sorted.length > 1 ? idx / (sorted.length - 1) : 0.5;
          });
        }
      });
      return out;
    }

    /* --- 산술 --- */
    const a0 = evalNode(A[0], i, ctx);
    if (name === 'abs')  return mapVec(a0, Math.abs, univ);
    if (name === 'log')  return mapVec(a0, function (x) { return x > 0 ? Math.log(x) : NaN; }, univ);
    if (name === 'sqrt') return mapVec(a0, function (x) { return x >= 0 ? Math.sqrt(x) : NaN; }, univ);
    if (name === 'sign') return mapVec(a0, function (x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }, univ);

    if (name === 'power') return vecOp(a0, evalNode(A[1], i, ctx), Math.pow, univ);
    if (name === 'min')   return vecOp(a0, evalNode(A[1], i, ctx), Math.min, univ);
    if (name === 'max')   return vecOp(a0, evalNode(A[1], i, ctx), Math.max, univ);

    if (name === 'if_else') {
      const b = evalNode(A[1], i, ctx), c = evalNode(A[2], i, ctx);
      const out = {};
      univ.forEach(function (t) {
        const cond = isVec(a0) ? a0[t] : a0;
        const x = isVec(b) ? b[t] : b, y = isVec(c) ? c[t] : c;
        if (cond === undefined) return;
        const r = cond ? x : y;
        if (isFinite(r)) out[t] = r;
      });
      return out;
    }

    throw new Error('구현되지 않은 연산자 "' + name + '"');
  }

  /* ------------------------------------------------------------------------
   *  바깥에서 쓰는 입구
   * ----------------------------------------------------------------------*/
  E.newContext = function () { return { cache: new Map(), univ: {} }; };

  // 식 하나를 날짜 i에서 계산 → {종목: 점수}
  E.evalAt = function (ast, i, ctx) {
    const v = evalNode(ast, i, ctx || E.newContext());
    return isVec(v) ? v : {};
  };

  // 문법·이름만 빠르게 검사 (실행 전에 오류를 알려 주려고)
  E.check = function (src) {
    try {
      const ast = parse(src);
      return { ok: true, ast: ast };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  root.EXPR = E;
})(window.QL = window.QL || {});
