/* ============================================================================
 *  events.js — 이벤트 스터디 (Phase 2 대응)
 *
 *  왜 이벤트 스터디인가
 *    FOMC는 1년에 8번뿐이라 10년을 모아도 표본이 약 80개입니다. 머신러닝으로
 *    학습하기엔 턱없이 적습니다. 표본이 적을 때 쓰는 정석이 이벤트 스터디이고,
 *    Bernanke & Kuttner(2005)가 쓴 방법이 바로 이것입니다.
 *
 *  브라우저에서 할 수 있는 것과 없는 것 (정직하게)
 *    할 수 있음: 발표일 전후 주가가 어떻게 움직였는지(누적 비정상수익률, CAR),
 *               발표일의 2년물 금리 변화로 매파적/비둘기적 반응을 나눠 비교하기.
 *    할 수 없음: 성명서 원문을 받아 오는 것(사이트 접근 제한)과
 *               FOMC-RoBERTa 같은 대형 언어모델을 돌리는 것.
 *    그래서 톤 점수는 파이썬 phase2가 만든 결과를 붙여넣어 쓰거나,
 *    금리 변화 대용치로 대신합니다. 텍스트나 점수를 지어내지 않습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;
  const E = {};

  /* --------------------------------------------------------------------------
   *  이벤트 날짜를 데이터의 거래일 위치로 옮기기
   *  성명서는 장 마감 뒤에 나오기도 하므로, '발표일 이후 첫 거래일'을 기준일로 봅니다.
   * ------------------------------------------------------------------------*/
  E.locate = function (dates, eventDateStrings) {
    const keys = dates.map(function (d) { return U.dstr(d); });
    const out = [];
    let j = 0;
    const sorted = eventDateStrings.slice().sort();
    for (let k = 0; k < sorted.length; k++) {
      while (j < keys.length && keys[j] < sorted[k]) j++;
      if (j >= keys.length) break;
      out.push({ date: sorted[k], i: j });
    }
    return out;
  };

  /* --------------------------------------------------------------------------
   *  이벤트 창(window) 평균 누적수익률
   *  before일 전부터 after일 뒤까지, 기준일(0일)을 0%로 맞춘 뒤 평균을 냅니다.
   *  "시장 전체가 그 무렵 원래 얼마나 움직였나"를 빼려면 기대수익률 모형이 필요한데,
   *  여기서는 표본 전체 평균수익률을 기대치로 보는 가장 단순한 방식을 씁니다.
   * ------------------------------------------------------------------------*/
  E.car = function (ret, events, before, after) {
    const n = ret.length;
    let mu = 0, cnt = 0;
    for (let i = 0; i < n; i++) if (isFinite(ret[i])) { mu += ret[i]; cnt++; }
    mu = cnt ? mu / cnt : 0;

    const len = before + after + 1;
    const sum = new Float64Array(len), sq = new Float64Array(len), num = new Float64Array(len);
    const paths = [];
    events.forEach(function (ev) {
      if (ev.i - before < 1 || ev.i + after >= n) return;
      let acc = 0;
      const path = new Float64Array(len);
      for (let k = 0; k < len; k++) {
        const idx = ev.i - before + k;
        if (k > 0) acc += (ret[idx] - mu);          // 기준일 이전 구간부터 누적
        path[k] = acc;
        sum[k] += acc; sq[k] += acc * acc; num[k] += 1;
      }
      paths.push({ date: ev.date, path: path });
    });

    const mean = new Float64Array(len), se = new Float64Array(len);
    for (let k = 0; k < len; k++) {
      mean[k] = num[k] ? sum[k] / num[k] : NaN;
      const v = num[k] > 1 ? (sq[k] / num[k] - mean[k] * mean[k]) * num[k] / (num[k] - 1) : NaN;
      se[k] = isFinite(v) && v > 0 ? Math.sqrt(v / num[k]) : 0;
    }
    return { mean: mean, se: se, count: num[0] || 0, before: before, after: after, paths: paths, mu: mu };
  };

  /* --------------------------------------------------------------------------
   *  이벤트별 반응 표 만들기
   *   sameDay : 기준일(발표 이후 첫 거래일) 수익률
   *   nextDay : 그 다음 거래일 수익률
   *   rateChg : 기준일의 금리 변화 (서프라이즈의 '대용치')
   * ------------------------------------------------------------------------*/
  E.reactions = function (data, ret, events) {
    const n = ret.length;
    const rows = [];
    events.forEach(function (ev) {
      if (ev.i + 1 >= n) return;
      const rc = data.rate ? (data.rate[ev.i] - data.rate[ev.i - 1]) : NaN;
      rows.push({
        date: ev.date,
        tradeDate: U.dstr(data.dates[ev.i]),
        i: ev.i,
        sameDay: ret[ev.i],
        nextDay: ret[ev.i + 1],
        rateChg: rc,
        tone: NaN
      });
    });
    return rows;
  };

  /* --------------------------------------------------------------------------
   *  두 집단 비교 (매파적 반응 vs 비둘기적 반응)
   *  groupBy(row) 가 +면 매파, -면 비둘기, 0/NaN이면 제외.
   * ------------------------------------------------------------------------*/
  E.compare = function (rows, groupBy, field) {
    const hawk = [], dove = [];
    rows.forEach(function (r) {
      const g = groupBy(r);
      const v = r[field];
      if (!isFinite(g) || !isFinite(v) || g === 0) return;
      (g > 0 ? hawk : dove).push(v);
    });
    const t = U.welchT(hawk, dove);
    return { hawk: hawk, dove: dove, t: t.t, p: t.p, meanHawk: t.ma, meanDove: t.mb, diff: t.ma - t.mb };
  };

  /* --------------------------------------------------------------------------
   *  톤 점수 붙여넣기 (파이썬 phase2가 만든 값)
   *  형식: 날짜,톤   (한 줄에 하나. 예: 2015-01-28,0.12)
   * ------------------------------------------------------------------------*/
  E.parseTone = function (text) {
    const map = {};
    let count = 0;
    String(text).replace(/\r/g, '').split('\n').forEach(function (line) {
      const c = line.split(/[,\t;]/);
      if (c.length < 2) return;
      const d = U.parseDate(c[0]);
      const v = parseFloat(c[1]);
      if (!d || !isFinite(v)) return;
      map[U.dstr(d)] = v;
      count++;
    });
    if (!count) throw new Error("읽을 수 있는 줄이 없습니다. '2015-01-28,0.12' 형식인지 확인하세요.");
    return map;
  };

  root.E = E;
})(window.FRSP = window.FRSP || {});
