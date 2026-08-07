/* ============================================================================
 *  alpha.js — 내가 만든 알파 (사용자 정의 팩터)
 *
 *  WorldQuant IQC에서 참가자가 실제로 제출하는 것이 이것입니다.
 *  "알파"란 종목을 줄 세우는 식 하나입니다. 예를 들면
 *
 *      알파 = 1.0 × 모멘텀(12-1) − 0.5 × 변동성(6개월) + 0.3 × 거래량급증
 *
 *  이 사이트의 9개 팩터는 이미 '그날 종목들 사이의 순위(-1~1)'로 바뀌어 있습니다.
 *  단위가 같으니 그대로 가중합하면 됩니다. 그래서 계수만 정하면 알파가 됩니다.
 *
 *  저장한 알파는 전략 실험실 목록에 '내 알파'로 나타나고, 고전 팩터·AI와
 *  똑같은 조건에서 백테스트되고 똑같이 채점 구간에 제출됩니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const KEY = 'quantlab.alphas';
  const STRAT = root.STRAT;

  const A = {};

  A.load = function () {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  };
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }

  A.save = function (alpha) {
    const list = A.load();
    let found = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === alpha.id) { list[i] = alpha; found = true; break; }
    }
    if (!found) list.unshift(alpha);
    save(list);
    A.sync();
    return alpha;
  };

  A.remove = function (id) {
    save(A.load().filter(function (a) { return a.id !== id; }));
    A.sync();
  };

  A.newId = function () { return 'a' + Date.now().toString(36); };

  /* ------------------------------------------------------------------------
   *  점수 계산 — 가중합. 계수가 0인 팩터는 건너뜁니다.
   * ----------------------------------------------------------------------*/
  A.scoreWith = function (w, i) {
    const F = STRAT.featuresAt(i);
    const out = {};
    const used = [];
    for (let j = 0; j < w.length; j++) if (w[j]) used.push(j);
    if (!used.length) return out;
    F.tickers.forEach(function (t, k) {
      const row = F.X[k];
      let v = 0;
      for (let u = 0; u < used.length; u++) v += w[used[u]] * row[used[u]];
      out[t] = v;
    });
    return out;
  };

  // 사람이 읽는 식으로 (발표에서 이 한 줄을 말할 수 있어야 합니다)
  A.formula = function (w) {
    if (!w || !w.length) return '(비어 있음)';
    const F = STRAT.aiFeatures;
    const parts = [];
    for (let j = 0; j < w.length; j++) {
      if (!w[j]) continue;
      const sign = w[j] > 0 ? (parts.length ? ' + ' : '') : (parts.length ? ' − ' : '−');
      parts.push(sign + Math.abs(w[j]).toFixed(1) + '×' + F[j].name);
    }
    return parts.length ? parts.join('') : '(비어 있음)';
  };

  /* ------------------------------------------------------------------------
   *  전략 목록에 붙이기 / 떼기
   *  저장한 알파가 전략 실험실 picker에 그대로 나타나게 합니다.
   * ----------------------------------------------------------------------*/
  A.sync = function () {
    const list = STRAT.list;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].id.indexOf('alpha:') === 0) list.splice(i, 1);
    }
    A.load().forEach(function (a) {
      let score, desc;
      if (a.src && root.EXPR) {
        // 식 모드 알파. 파싱은 한 번만 하고 캐시는 전략마다 따로 둡니다.
        const chk = root.EXPR.check(a.src);
        if (!chk.ok) return;                      // 문법이 깨진 알파는 목록에 올리지 않습니다
        let ctx = root.EXPR.newContext();
        let seen = 0;
        score = function (i) {
          // 백테스트가 여러 번 돌면 캐시가 무한정 커지므로 가끔 비웁니다.
          if (++seen % 4000 === 0) ctx = root.EXPR.newContext();
          return root.EXPR.evalAt(chk.ast, i, ctx);
        };
        desc = a.src;
      } else {
        const w = a.w || [];
        score = function (i) { return A.scoreWith(w, i); };
        desc = A.formula(w);
      }
      list.push({
        id: 'alpha:' + a.id,
        name: a.name,
        cat: '내 알파',
        desc: desc,
        isAlpha: true,
        weights: a.w,
        src: a.src,
        score: score
      });
    });
  };

  root.ALPHA = A;
  A.sync();
})(window.QL = window.QL || {});
