/* ============================================================================
 *  strategies.js — 실제 퀀트 운용에서 쓰는 기법들
 *
 *  전략은 모두 같은 모양입니다.
 *      score(i) → { 종목: 점수 }
 *  점수가 높은 종목을 사면 됩니다. 점수의 절대값은 의미가 없고 '순서'만 씁니다.
 *  이렇게 통일해 두면 어떤 기법이든 같은 방식으로 공정하게 비교할 수 있습니다.
 *
 *  ★ 미래를 보지 않습니다: 점수는 i일 종가까지의 정보만으로 계산합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const DATA = root.DATA;

  /* ------------------------------------------------------------------------
   *  지표 계산 (모두 i 시점까지만 사용)
   * ----------------------------------------------------------------------*/
  const IND = {};

  IND.px = function (s, i) {
    for (let k = i; k >= Math.max(0, i - 5); k--) if (s[k] !== null && isFinite(s[k])) return s[k];
    return NaN;
  };

  // n일 수익률
  IND.mom = function (s, i, n) {
    const a = IND.px(s, i - n), b = IND.px(s, i);
    return (isFinite(a) && isFinite(b) && a > 0) ? b / a - 1 : NaN;
  };

  // 12개월 모멘텀에서 최근 1개월을 뺀 값 — 학계·업계에서 가장 널리 쓰는 모멘텀 정의
  IND.mom12_1 = function (s, i) {
    const a = IND.px(s, i - 252), b = IND.px(s, i - 21);
    return (isFinite(a) && isFinite(b) && a > 0) ? b / a - 1 : NaN;
  };

  IND.ma = function (s, i, n) {
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) {
      if (s[k] !== null && isFinite(s[k])) { sum += s[k]; cnt++; }
    }
    return cnt >= n * 0.6 ? sum / cnt : NaN;
  };

  IND.vol = function (s, i, n) {
    const r = [];
    for (let k = Math.max(1, i - n + 1); k <= i; k++) {
      const a = s[k - 1], b = s[k];
      if (a !== null && b !== null && isFinite(a) && isFinite(b) && a > 0) r.push(b / a - 1);
    }
    if (r.length < n * 0.5) return NaN;
    const m = r.reduce(function (x, y) { return x + y; }, 0) / r.length;
    let v = 0;
    for (let k = 0; k < r.length; k++) v += (r[k] - m) * (r[k] - m);
    return Math.sqrt(v / (r.length - 1)) * Math.sqrt(252);
  };

  IND.rsi = function (s, i, n) {
    let up = 0, down = 0, cnt = 0;
    for (let k = Math.max(1, i - n + 1); k <= i; k++) {
      const a = s[k - 1], b = s[k];
      if (a === null || b === null || !isFinite(a) || !isFinite(b)) continue;
      const d = b - a;
      if (d > 0) up += d; else down -= d;
      cnt++;
    }
    if (cnt < n * 0.5 || up + down === 0) return NaN;
    return 100 * up / (up + down);
  };

  // 최근 고점 대비 낙폭
  IND.drawdown = function (s, i, n) {
    let peak = -Infinity;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) {
      if (s[k] !== null && isFinite(s[k]) && s[k] > peak) peak = s[k];
    }
    const p = IND.px(s, i);
    return (isFinite(p) && peak > 0) ? p / peak - 1 : NaN;
  };

  /* ------------------------------------------------------------------------
   *  전략 목록
   * ----------------------------------------------------------------------*/
  function scoreAll(i, fn) {
    const out = {};
    DATA.tradables(i).forEach(function (t) {
      const s = DATA.series(t);
      const v = fn(s, i, t);
      if (isFinite(v)) out[t] = v;
    });
    return out;
  }

  const LIST = [
    {
      id: 'momentum',
      name: '모멘텀 (12-1개월)',
      cat: '추세',
      desc: '지난 1년 동안 많이 오른 종목을 삽니다. 다만 최근 한 달은 빼는데, 단기에는 오히려 되돌림이 나오기 때문입니다. 학계에서 가장 오래 검증된 팩터입니다.',
      score: function (i) { return scoreAll(i, function (s, k) { return IND.mom12_1(s, k); }); }
    },
    {
      id: 'shortmom',
      name: '단기 모멘텀 (1개월)',
      cat: '추세',
      desc: '최근 한 달 성적이 좋은 종목을 삽니다. 회전율이 높아 거래비용에 취약합니다.',
      score: function (i) { return scoreAll(i, function (s, k) { return IND.mom(s, k, 21); }); }
    },
    {
      id: 'reversal',
      name: '단기 반전 (1주)',
      cat: '평균회귀',
      desc: '지난 일주일 많이 떨어진 종목을 삽니다. 과도하게 팔린 종목이 되돌아온다는 생각입니다. 모멘텀과 정반대 방향이라 함께 보면 재미있습니다.',
      score: function (i) { return scoreAll(i, function (s, k) { return -IND.mom(s, k, 5); }); }
    },
    {
      id: 'lowvol',
      name: '저변동성',
      cat: '위험',
      desc: '덜 출렁이는 종목을 삽니다. "위험을 더 지면 더 번다"는 통념과 반대로, 실제로는 저변동 종목의 위험 대비 성과가 좋았다는 관찰에서 나왔습니다(저변동성 이상현상).',
      score: function (i) { return scoreAll(i, function (s, k) { return -IND.vol(s, k, 120); }); }
    },
    {
      id: 'trend',
      name: '추세추종 (50일>200일)',
      cat: '추세',
      desc: '50일 이동평균이 200일선 위에 있는 정도로 줄 세웁니다. 골든크로스를 점수로 만든 것입니다.',
      score: function (i) {
        return scoreAll(i, function (s, k) {
          const a = IND.ma(s, k, 50), b = IND.ma(s, k, 200);
          return (isFinite(a) && isFinite(b) && b > 0) ? a / b - 1 : NaN;
        });
      }
    },
    {
      id: 'rsi',
      name: 'RSI 과매도',
      cat: '평균회귀',
      desc: 'RSI가 낮은(많이 팔린) 종목을 삽니다. 개인 투자자에게 가장 익숙한 보조지표입니다.',
      score: function (i) { return scoreAll(i, function (s, k) { return -IND.rsi(s, k, 14); }); }
    },
    {
      id: 'dipbuy',
      name: '고점 대비 낙폭 매수',
      cat: '평균회귀',
      desc: '최근 6개월 고점에서 많이 내려온 종목을 삽니다. "싸게 사자"를 규칙으로 만든 것입니다.',
      score: function (i) { return scoreAll(i, function (s, k) { return -IND.drawdown(s, k, 126); }); }
    },
    {
      id: 'quality_mom',
      name: '위험조정 모멘텀',
      cat: '복합',
      desc: '모멘텀을 변동성으로 나눠, 흔들리지 않으면서 꾸준히 오른 종목을 고릅니다. 실무에서 자주 쓰는 조합입니다.',
      score: function (i) {
        return scoreAll(i, function (s, k) {
          const m = IND.mom12_1(s, k), v = IND.vol(s, k, 120);
          return (isFinite(m) && isFinite(v) && v > 0) ? m / v : NaN;
        });
      }
    },
    {
      id: 'multifactor',
      name: '멀티팩터 (모멘텀+저변동+반전)',
      cat: '복합',
      desc: '여러 팩터의 순위를 합쳐서 씁니다. 한 팩터가 안 통하는 시기를 다른 팩터가 메워 주기를 기대하는, 실제 퀀트 펀드의 기본 구성입니다.',
      score: function (i) {
        const a = rankMap(scoreAll(i, function (s, k) { return IND.mom12_1(s, k); }));
        const b = rankMap(scoreAll(i, function (s, k) { return -IND.vol(s, k, 120); }));
        const c = rankMap(scoreAll(i, function (s, k) { return -IND.mom(s, k, 5); }));
        const out = {};
        Object.keys(a).forEach(function (t) {
          if (b[t] === undefined || c[t] === undefined) return;
          out[t] = 0.5 * a[t] + 0.3 * b[t] + 0.2 * c[t];
        });
        return out;
      }
    },
    {
      id: 'equal',
      name: '동일가중 (비교 기준)',
      cat: '기준선',
      desc: '그날 살 수 있는 모든 종목을 똑같이 담습니다. 종목을 고르는 실력이 있는지 판단하는 기준선입니다. 이걸 못 이기면 고른 의미가 없습니다.',
      score: function (i) { return scoreAll(i, function () { return 0; }); }
    },
    {
      id: 'random',
      name: '무작위 (비교 기준)',
      cat: '기준선',
      desc: '아무 종목이나 고릅니다. 전략의 성적이 운과 구별되는지 보는 대조군입니다.',
      score: function (i) {
        let seed = 12345 + i;
        return scoreAll(i, function () {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
        });
      }
    }
  ];

  // 점수를 순위(-1~1)로 바꿉니다. 여러 팩터를 합칠 때 단위를 맞추기 위해서입니다.
  function rankMap(scores) {
    const keys = Object.keys(scores);
    if (keys.length < 2) return {};
    keys.sort(function (a, b) { return scores[a] - scores[b]; });
    const out = {};
    keys.forEach(function (t, i) { out[t] = 2 * i / (keys.length - 1) - 1; });
    return out;
  }

  root.STRAT = { list: LIST, IND: IND, rankMap: rankMap, scoreAll: scoreAll };
})(window.QL = window.QL || {});
