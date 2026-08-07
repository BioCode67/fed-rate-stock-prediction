/* ============================================================================
 *  journal.js — 연구 노트
 *
 *  실무 퀀트 리서처는 시도한 것을 전부 적습니다. 잘된 것만이 아니라
 *  실패한 것까지 적습니다. 이유는 두 가지입니다.
 *
 *    1) 몇 번째 시도인지 모르면 결과를 해석할 수 없다.
 *       20번 돌려서 나온 "유의한" 결과는 우연히 그럴 확률이 이미 64%입니다.
 *    2) 나중에 남에게 설명해야 한다.
 *       대회 발표도 면접도 "무엇을 왜 시도했는가"를 묻습니다.
 *
 *  그래서 이 파일은 백테스트·제출·팩터 분석을 돌릴 때마다 자동으로
 *  기록을 남깁니다. 학생이 따로 적을 필요가 없게 만드는 것이 핵심입니다.
 *  기록은 이 브라우저에만 저장되고 서버로 가지 않습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const KEY = 'quantlab.journal';
  const MAX = 300;

  const J = {};

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) {}
  }

  // 최신순
  J.all = function () { return read(); };
  J.count = function (kind) {
    const l = read();
    return kind ? l.filter(function (e) { return e.kind === kind; }).length : l.length;
  };

  J.add = function (entry) {
    const list = read();
    const e = Object.assign({}, entry);
    e.id = 'j' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    e.ts = new Date().toISOString();
    // 같은 종류의 몇 번째 시도인가
    e.n = list.filter(function (x) { return x.kind === e.kind; }).length + 1;
    if (!e.note) e.note = '';
    list.unshift(e);
    write(list);
    return e;
  };

  J.setNote = function (id, text) {
    const list = read();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) { list[i].note = text; break; }
    write(list);
  };

  J.remove = function (id) {
    write(read().filter(function (e) { return e.id !== id; }));
  };

  J.clear = function () { write([]); };

  /* ------------------------------------------------------------------------
   *  다중검정을 눈으로 보여 주는 계열
   *
   *  백테스트를 시도 순서대로 놓고 "그때까지의 최고 샤프"를 그리면
   *  반드시 우상향합니다. 실력이 는 게 아니라 계속 찾았기 때문입니다.
   *  이 곡선이 가팔랐다면 그만큼 우연을 골랐을 가능성이 큽니다.
   * ----------------------------------------------------------------------*/
  J.bestSoFar = function () {
    const runs = read().filter(function (e) { return e.kind === 'backtest' && e.results && e.results.length; })
      .slice().reverse();                                    // 오래된 것부터
    let best = -Infinity;
    return runs.map(function (e, i) {
      const top = Math.max.apply(null, e.results.map(function (r) {
        return isFinite(r.sharpe) ? r.sharpe : -Infinity;
      }));
      if (top > best) best = top;
      return { n: i + 1, sharpe: isFinite(top) ? top : null, best: isFinite(best) ? best : null, ts: e.ts };
    });
  };

  /* ------------------------------------------------------------------------
   *  마크다운 내보내기 — 발표자료·보고서에 그대로 붙입니다
   * ----------------------------------------------------------------------*/
  function pct(x, d) {
    return isFinite(x) ? ((x >= 0 ? '+' : '') + (x * 100).toFixed(d === undefined ? 1 : d) + '%') : '—';
  }
  function num(x, d) { return isFinite(x) ? x.toFixed(d === undefined ? 2 : d) : '—'; }

  J.toMarkdown = function (who) {
    const list = read();
    const runs = list.filter(function (e) { return e.kind === 'backtest'; });
    const subs = list.filter(function (e) { return e.kind === 'submit'; });
    const facs = list.filter(function (e) { return e.kind === 'factor'; });

    const out = [];
    out.push('# 퀀트 연구 노트');
    out.push('');
    if (who) out.push('- 작성자: ' + who);
    out.push('- 내보낸 시각: ' + new Date().toLocaleString('ko-KR'));
    out.push('- 백테스트 ' + runs.length + '회 · 제출 ' + subs.length + '회 · 팩터 분석 ' + facs.length + '회');
    out.push('');
    out.push('> 시도 횟수를 밝히는 것은 결과를 깎아내리는 일이 아니라, 결과를 해석 가능하게 만드는 일입니다.');
    out.push('');

    if (subs.length) {
      out.push('## 제출 기록 (채점 구간 성적)');
      out.push('');
      out.push('| 시각 | 전략 | 개발 구간 | 채점 구간 | QQQ 대비 | 격차 |');
      out.push('|---|---|---|---|---|---|');
      subs.slice().reverse().forEach(function (e) {
        out.push('| ' + new Date(e.ts).toLocaleString('ko-KR') + ' | ' + e.strategyName +
          ' | ' + pct(e.dev && e.dev.total) + ' | ' + pct(e.oos && e.oos.total) +
          ' | ' + pct(e.excess) + ' | ' + pct((e.dev && e.dev.total) - (e.oos && e.oos.total)) + ' |');
      });
      out.push('');
    }

    if (runs.length) {
      out.push('## 백테스트 기록 (개발 구간)');
      out.push('');
      out.push('| # | 시각 | 바꾼 것 / 가설 | 설정 | 최고 전략 | 샤프 | 연평균 | QQQ 대비 |');
      out.push('|---|---|---|---|---|---|---|---|');
      runs.slice().reverse().forEach(function (e, i) {
        const best = e.results.slice().sort(function (a, b) { return (b.sharpe || -9) - (a.sharpe || -9); })[0] || {};
        const c = e.config || {};
        const cfg = c.topK + '종목 · ' + c.rebalance + '일 · 비용 ' + c.cost + '%';
        out.push('| ' + (i + 1) + ' | ' + new Date(e.ts).toLocaleDateString('ko-KR') +
          ' | ' + (e.hypothesis || '—').replace(/\|/g, '/') +
          ' | ' + cfg + ' | ' + (best.name || '—') + ' | ' + num(best.sharpe) +
          ' | ' + pct(best.cagr) + ' | ' + pct(best.cagr - ((e.bench && e.bench.cagr) || 0)) + ' |');
      });
      out.push('');
    }

    if (facs.length) {
      out.push('## 팩터 분석 기록');
      out.push('');
      out.push('| 시각 | 예측 시계 | IC 1위 팩터 | IC | t값 | \\|t\\|>2 팩터 수 |');
      out.push('|---|---|---|---|---|---|');
      facs.slice().reverse().forEach(function (e) {
        const t = (e.top && e.top[0]) || {};
        out.push('| ' + new Date(e.ts).toLocaleDateString('ko-KR') + ' | ' + e.horizon + '일 | ' +
          (t.name || '—') + ' | ' + num(t.ic, 4) + ' | ' + num(t.t) + ' | ' + (e.significant || 0) + ' |');
      });
      out.push('');
    }

    const notes = list.filter(function (e) { return e.note; });
    if (notes.length) {
      out.push('## 메모');
      out.push('');
      notes.slice().reverse().forEach(function (e) {
        out.push('- **' + new Date(e.ts).toLocaleDateString('ko-KR') + '** (' + e.kind + ') ' + e.note);
      });
      out.push('');
    }

    out.push('## 스스로 답해 볼 것');
    out.push('');
    out.push('- 이 중 가장 좋은 결과는 몇 번째 시도였는가?');
    out.push('- 그 결과가 채점 구간에서도 재현되었는가?');
    out.push('- 재현되지 않았다면, 무엇을 과하게 맞췄던 것인가?');
    out.push('');
    out.push('---');
    out.push('QUANT LAB에서 자동 생성. 교육·연구용이며 실제 투자 판단에 사용하지 마십시오.');
    return out.join('\n');
  };

  root.JOURNAL = J;
})(window.QL = window.QL || {});
