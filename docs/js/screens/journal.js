/* ============================================================================
 *  journal.js (화면) — 연구 노트
 *
 *  학생이 스스로 적지 않아도 시도가 쌓이도록 자동 기록된 것을 보여 줍니다.
 *  가장 중요한 패널은 '시도할수록 최고 기록은 올라간다' 차트입니다.
 *  다중검정을 말로 설명하면 잘 안 와닿는데, 자기 기록으로 보면 바로 압니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, App = root.App, J = root.JOURNAL;

  const S = { open: {}, filter: 'all' };

  const KIND = {
    backtest: { label: '백테스트', cls: 'tag' },
    submit: { label: '제출', cls: 'tag ok' },
    factor: { label: '팩터 분석', cls: 'tag demo' },
    alpha: { label: '알파 평가', cls: 'tag demo' },
    'alpha-oos': { label: '알파 채점', cls: 'tag ok' }
  };

  function when(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' +
      d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ------------------------------------------------------------------------
   *  요약
   * ----------------------------------------------------------------------*/
  function summaryPanel() {
    const all = J.all();
    const p = App.panel('연구 노트 <span class="accent">RESEARCH LOG</span>',
      { sub: '백테스트·알파 평가·제출·팩터 분석이 자동으로 기록됩니다. 이 브라우저에만 저장됩니다' });

    const g = U.el('div', 'grid g4');
    g.appendChild(App.stat('백테스트', String(J.count('backtest')) + '회', '개발 구간 실행'));
    g.appendChild(App.stat('제출', String(J.count('submit')) + '회', '채점 구간 평가'));
    g.appendChild(App.stat('알파 평가', String(J.count('alpha')) + '회',
      '팩터 분석 ' + J.count('factor') + '회'));
    const first = all.length ? all[all.length - 1].ts : null;
    g.appendChild(App.stat('시작한 날', first ? new Date(first).toLocaleDateString('ko-KR') : '—',
      all.length ? '기록 ' + all.length + '건' : '아직 기록 없음'));
    p.body.appendChild(g);

    if (!all.length) {
      p.body.appendChild(U.el('div', 'note',
        '아직 기록이 없습니다. 알파 만들기나 전략 실험실에서 한 번 실행하면 여기에 자동으로 남습니다. ' +
        '실무 리서처는 실패한 시도까지 전부 적습니다. 몇 번째 시도인지 모르면 결과를 해석할 수 없기 때문입니다.'));
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  다중검정 — 가장 중요한 패널
   * ----------------------------------------------------------------------*/
  function searchPanel() {
    const pts = J.bestSoFar();
    if (pts.length < 2) return null;

    const p = App.panel('시도할수록 최고 기록은 <span class="accent">올라간다</span>',
      { sub: '실력이 늘어서가 아니라, 계속 찾았기 때문입니다' });

    const labels = pts.map(function (x) { return String(x.n); });
    const series = [
      { name: '그 시도의 샤프', values: pts.map(function (x) { return x.sharpe; }), color: C.mutedColor(), dash: [3, 3] },
      { name: '그때까지 최고', values: pts.map(function (x) { return x.best; }), color: C.seriesColor(0) }
    ];
    p.body.appendChild(C.legend
      ? C.legend(series.map(function (s) { return { name: s.name, color: s.color }; }))
      : U.el('div'));
    const cv = U.el('canvas', 'chart');
    p.body.appendChild(cv);
    C.line(cv, { labels: labels, series: series, zeroLine: 0, yFmt: function (v) { return v.toFixed(2); } });

    const firstBest = pts[0].best, lastBest = pts[pts.length - 1].best;
    const gain = (isFinite(lastBest) && isFinite(firstBest)) ? lastBest - firstBest : NaN;
    const note = U.el('div', 'note ' + (pts.length >= 10 ? 'warn' : ''));
    note.innerHTML =
      '지금까지 <b>' + pts.length + '번</b> 돌렸고, 최고 샤프는 첫 시도 ' +
      (isFinite(firstBest) ? firstBest.toFixed(2) : '—') + ' → 현재 ' +
      (isFinite(lastBest) ? lastBest.toFixed(2) : '—') +
      (isFinite(gain) && gain > 0.005 ? ' (<b>+' + gain.toFixed(2) + '</b>)' : '') + ' 입니다.<br><br>' +
      '이 곡선은 <b>절대 내려가지 않습니다</b>. 최고 기록만 남기기 때문입니다. ' +
      '그래서 "여러 번 돌려서 고른 최고 성적"은 그 자체로는 실력의 증거가 되지 못합니다. ' +
      '완전히 무작위인 전략을 20번 돌려도 그중 하나는 그럴듯하게 좋아 보입니다.<br><br>' +
      '<b>그래서 채점 구간이 있습니다.</b> 여기서 고른 전략이 처음 보는 구간에서도 같은 성적을 내는지, ' +
      '그것만이 증거입니다.';
    p.body.appendChild(note);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  기록 목록
   * ----------------------------------------------------------------------*/
  function detailOf(e) {
    const box = U.el('div');
    box.style.cssText = 'padding:8px 0 4px;border-top:1px dashed var(--line)';

    if (e.kind === 'backtest' && e.results) {
      const c = e.config || {};
      box.appendChild(U.el('div', 'tiny',
        '설정 · 개발 ' + c.years + '년 / ' + c.topK + '종목 / ' + c.rebalance + '일마다 / 편도 비용 ' +
        c.cost + '% / AI 시계 ' + c.aiHorizon + '일 · 구간 ' + (e.range ? e.range.start + ' ~ ' + e.range.end : '')));
      const rows = e.results.slice().sort(function (a, b) { return (b.sharpe || -9) - (a.sharpe || -9); })
        .map(function (r) {
          return {
            cells: [r.name, App.chg(r.total, 1), App.chg(r.cagr, 1),
              isFinite(r.sharpe) ? r.sharpe.toFixed(2) : '—',
              (r.mdd * 100).toFixed(1) + '%',
              App.chg(r.cagr - ((e.bench && e.bench.cagr) || 0), 1)]
          };
        });
      box.appendChild(App.table(['전략', { label: '누적', num: true }, { label: '연평균', num: true },
        { label: '샤프', num: true }, { label: 'MDD', num: true }, { label: 'QQQ 대비', num: true }], rows));
    } else if (e.kind === 'submit') {
      const g = U.el('div', 'grid g4');
      g.appendChild(App.stat('채점 구간', isFinite(e.oos.total) ? ((e.oos.total >= 0 ? '+' : '') + (e.oos.total * 100).toFixed(2) + '%') : '—',
        '개발 구간 ' + ((e.dev.total >= 0 ? '+' : '') + (e.dev.total * 100).toFixed(1) + '%'),
        e.oos.total >= 0 ? 'up' : 'down'));
      g.appendChild(App.stat('QQQ 대비', (e.excess >= 0 ? '+' : '') + (e.excess * 100).toFixed(2) + '%p',
        '초과수익', e.excess >= 0 ? 'up' : 'down'));
      g.appendChild(App.stat('샤프', isFinite(e.oos.sharpe) ? e.oos.sharpe.toFixed(2) : '—',
        '개발 구간 ' + (isFinite(e.dev.sharpe) ? e.dev.sharpe.toFixed(2) : '—')));
      g.appendChild(App.stat('그때까지 시도', (e.runCount || 0) + '회', '백테스트 실행 누적'));
      box.appendChild(g);
    } else if (e.kind === 'alpha') {
      box.appendChild(U.el('div', 'mono small', e.formula || ''));
      const g = U.el('div', 'grid g4');
      g.style.marginTop = '8px';
      const GATE = root.SIM ? root.SIM.GATE : { sharpe: 1.25, fitness: 1, turnoverMax: 0.7, selfCorr: 0.7 };
      if (isFinite(e.sharpe)) {
        // IQC 시뮬레이터 기록
        g.appendChild(App.stat('Sharpe', e.sharpe.toFixed(2),
          '기준 ≥ ' + GATE.sharpe, e.sharpe >= GATE.sharpe ? 'up' : 'down'));
        g.appendChild(App.stat('Fitness', isFinite(e.fitness) ? e.fitness.toFixed(2) : '—',
          '기준 ≥ ' + GATE.fitness, e.fitness >= GATE.fitness ? 'up' : 'down'));
        g.appendChild(App.stat('회전율', isFinite(e.turnover) ? (e.turnover * 100).toFixed(1) + '%' : '—',
          '기준 1~70%',
          (e.turnover >= 0.01 && e.turnover <= GATE.turnoverMax) ? 'up' : 'down'));
        g.appendChild(App.stat('자기상관', isFinite(e.maxCorr) ? e.maxCorr.toFixed(2) : '—',
          isFinite(e.maxCorr) ? '기준 < ' + GATE.selfCorr : '비교할 알파 없음',
          isFinite(e.maxCorr) ? (e.maxCorr < GATE.selfCorr ? 'up' : 'down') : ''));
        box.appendChild(g);
        const cfg = e.config || {};
        box.appendChild(U.el('div', 'tiny',
          '설정 · ' + (cfg.neutralize === 'sector' ? '섹터 중립' :
                      (cfg.neutralize === 'none' ? '중립화 없음' : '시장 중립')) +
          ' / 감쇠 ' + (cfg.decay > 1 ? cfg.decay + '일' : '없음') +
          ' / 종목 상한 ' + (cfg.maxWeight >= 1 ? '없음' : Math.round((cfg.maxWeight || 0) * 100) + '%') +
          ' / 평가 ' + (cfg.years || '?') + '년' +
          (e.passed ? ' · 제출 가능' : ' · 기준 미달')));
        if (e.origin) {
          const o = U.el('div', 'tiny');
          o.style.color = 'var(--amber)';
          o.textContent = '출처 · ' + e.origin;
          box.appendChild(o);
        }
      } else {
        // 옛 기록(IC 방식으로 재던 시절)
        g.appendChild(App.stat('IC', isFinite(e.ic) ? e.ic.toFixed(4) : '—',
          '시계 ' + (e.horizon || '?') + '일', e.ic > 0.02 ? 'up' : (e.ic < -0.02 ? 'down' : '')));
        g.appendChild(App.stat('t값', isFinite(e.t) ? e.t.toFixed(2) : '—',
          Math.abs(e.t) > 2 ? '우연으로 보기 어려움' : '우연일 수 있음'));
        g.appendChild(App.stat('상·하위 격차',
          isFinite(e.spread) ? ((e.spread >= 0 ? '+' : '') + (e.spread * 100).toFixed(2) + '%') : '—', ''));
        g.appendChild(App.stat('기존 팩터 최대상관',
          isFinite(e.maxCorr) ? e.maxCorr.toFixed(2) : '—',
          e.maxCorr >= 0.9 ? '사실상 같은 팩터' : '독립적', e.maxCorr >= 0.9 ? 'down' : 'up'));
        box.appendChild(g);
        box.appendChild(U.el('div', 'tiny', 'IQC 채점표가 생기기 전에 남긴 기록입니다.'));
      }
    } else if (e.kind === 'alpha-oos') {
      box.appendChild(U.el('div', 'mono small', e.formula || ''));
      const fmt = function (x, d) { return isFinite(x) ? x.toFixed(d === undefined ? 2 : d) : '—'; };
      const rows = [
        ['Sharpe', e.is.sharpe, e.oos.sharpe, 2],
        ['Fitness', e.is.fitness, e.oos.fitness, 2]
      ].map(function (r) {
        const g2 = U.el('span', (isFinite(r[1]) && isFinite(r[2]) && Math.abs(r[2] - r[1]) < 0.5) ? 'up' : 'down');
        g2.textContent = (isFinite(r[1]) && isFinite(r[2]))
          ? ((r[2] - r[1] >= 0 ? '+' : '') + (r[2] - r[1]).toFixed(2)) : '—';
        return { cells: [r[0], fmt(r[1], r[3]), fmt(r[2], r[3]), g2] };
      });
      box.appendChild(App.table(
        ['', { label: '개발(IS)', num: true }, { label: '채점(OS)', num: true }, { label: '차이', num: true }],
        rows));
      box.appendChild(U.el('div', 'tiny', e.peek + '번째 채점 구간 확인'));
    } else if (e.kind === 'factor' && e.top) {
      const rows = e.top.map(function (t) {
        return { cells: [t.name, t.ic.toFixed(4), isFinite(t.t) ? t.t.toFixed(2) : '—',
          isFinite(t.icir) ? t.icir.toFixed(3) : '—'] };
      });
      box.appendChild(App.table(['팩터', { label: 'IC 평균', num: true }, { label: 't값', num: true },
        { label: 'ICIR', num: true }], rows));
    }

    // 메모 — 나중에 발표할 때 쓰라고 남기는 자리
    const f = U.el('div', 'field');
    f.style.marginTop = '8px';
    f.appendChild(U.el('label', '', '메모 (무엇을 알게 됐나 / 다음엔 무엇을 바꿀까)'));
    const ta = U.el('textarea');
    ta.rows = 2;
    ta.value = e.note || '';
    ta.style.cssText = 'width:100%;resize:vertical';
    let timer = null;
    ta.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { J.setNote(e.id, ta.value); }, 400);
    });
    f.appendChild(ta);
    box.appendChild(f);
    return box;
  }

  function listPanel(host) {
    const all = J.all().filter(function (e) { return S.filter === 'all' || e.kind === S.filter; });
    if (!J.all().length) return null;

    const p = App.panel('기록', { sub: '줄을 누르면 자세히 볼 수 있습니다' });

    [['all', '전체'], ['backtest', '백테스트'], ['submit', '제출'],
     ['alpha', '알파'], ['alpha-oos', '알파 채점'], ['factor', '팩터']].forEach(function (o) {
      const b = U.el('button', 'btn sm' + (S.filter === o[0] ? ' primary' : ''), o[1]);
      b.addEventListener('click', function () { S.filter = o[0]; draw(host); });
      p.actions.appendChild(b);
    });

    all.forEach(function (e) {
      const row = U.el('div');
      row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--line)';

      const head = U.el('div', 'row center');
      head.style.cssText = 'gap:8px;cursor:pointer;justify-content:flex-start';
      const k = KIND[e.kind] || { label: e.kind, cls: 'tag' };
      const tag = U.el('span', k.cls, k.label + ' ' + e.n);
      const ts = U.el('span', 'tiny mono', when(e.ts));
      const title = U.el('span', 'small');
      title.style.flex = '1';
      title.innerHTML = U.escape(summaryLine(e));
      const caret = U.el('span', 'tiny', S.open[e.id] ? '▾' : '▸');
      head.appendChild(tag); head.appendChild(ts); head.appendChild(title); head.appendChild(caret);
      head.addEventListener('click', function () { S.open[e.id] = !S.open[e.id]; draw(host); });
      row.appendChild(head);

      if (e.hypothesis) {
        const h = U.el('div', 'tiny');
        h.style.margin = '3px 0 0 4px';
        h.textContent = '가설 · ' + e.hypothesis;
        row.appendChild(h);
      }
      if (S.open[e.id]) row.appendChild(detailOf(e));
      p.body.appendChild(row);
    });
    return p;
  }

  function summaryLine(e) {
    if (e.kind === 'backtest' && e.results && e.results.length) {
      const best = e.results.slice().sort(function (a, b) { return (b.sharpe || -9) - (a.sharpe || -9); })[0];
      const c = e.config || {};
      return best.name + ' 샤프 ' + (isFinite(best.sharpe) ? best.sharpe.toFixed(2) : '—') +
        ' · ' + e.results.length + '개 전략 · ' + c.topK + '종목 ' + c.rebalance + '일 비용 ' + c.cost + '%';
    }
    if (e.kind === 'submit') {
      return e.strategyName + ' 제출 · 채점 구간 ' +
        (e.oos.total >= 0 ? '+' : '') + (e.oos.total * 100).toFixed(1) + '% (QQQ 대비 ' +
        (e.excess >= 0 ? '+' : '') + (e.excess * 100).toFixed(1) + '%p)';
    }
    if (e.kind === 'alpha-oos') {
      const g2 = (isFinite(e.gap)) ? ((e.gap >= 0 ? '-' : '+') + Math.abs(e.gap).toFixed(2)) : '—';
      return (e.name || '알파') + ' 채점 구간 · Sharpe ' +
        (isFinite(e.is.sharpe) ? e.is.sharpe.toFixed(2) : '—') + ' → ' +
        (isFinite(e.oos.sharpe) ? e.oos.sharpe.toFixed(2) : '—') +
        ' (격차 ' + g2 + ') · ' + e.peek + '번째 확인';
    }
    if (e.kind === 'alpha') {
      if (isFinite(e.sharpe)) {
        return (e.name || '알파') + ' · Sharpe ' + e.sharpe.toFixed(2) +
          ' · Fitness ' + (isFinite(e.fitness) ? e.fitness.toFixed(2) : '—') +
          ' · 회전율 ' + (isFinite(e.turnover) ? (e.turnover * 100).toFixed(1) + '%' : '—') +
          (e.passed ? ' · 제출 가능' : '');
      }
      return (e.name || '알파') + ' · IC ' + (isFinite(e.ic) ? e.ic.toFixed(4) : '—') +
        ' t ' + (isFinite(e.t) ? e.t.toFixed(2) : '—');
    }
    if (e.kind === 'factor') {
      const t = (e.top && e.top[0]) || {};
      return '시계 ' + e.horizon + '일 · IC 1위 ' + (t.name || '—') +
        ' ' + (isFinite(t.ic) ? t.ic.toFixed(3) : '—') + ' · |t|>2 팩터 ' + (e.significant || 0) + '개';
    }
    return e.kind;
  }

  /* ------------------------------------------------------------------------
   *  내보내기
   * ----------------------------------------------------------------------*/
  function exportPanel(host) {
    if (!J.all().length) return null;
    const p = App.panel('내보내기', { sub: '발표자료·보고서에 그대로 붙일 수 있는 형식입니다' });

    const row = U.el('div', 'row');
    const dl = U.el('button', 'btn primary', '연구 노트 내려받기 (.md)');
    dl.addEventListener('click', function () {
      const who = localStorage.getItem('quantlab.nick') || '';
      const blob = new Blob([J.toMarkdown(who)], { type: 'text/markdown;charset=utf-8' });
      const a = U.el('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'quant-research-log.md';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    row.appendChild(dl);

    const cp = U.el('button', 'btn', '복사하기');
    cp.addEventListener('click', function () {
      const txt = J.toMarkdown(localStorage.getItem('quantlab.nick') || '');
      const done = function () { cp.textContent = '복사됨'; setTimeout(function () { cp.textContent = '복사하기'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () {});
      } else {
        const ta = U.el('textarea'); ta.value = txt;
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (err) {}
        ta.remove();
      }
    });
    row.appendChild(cp);

    const clr = U.el('button', 'btn', '전체 지우기');
    clr.addEventListener('click', function () {
      if (clr.dataset.armed) { J.clear(); S.open = {}; draw(host); return; }
      clr.dataset.armed = '1';
      clr.className = 'btn danger';
      clr.textContent = '정말 지웁니다 (다시 누르기)';
      setTimeout(function () {
        if (!clr.isConnected) return;
        delete clr.dataset.armed; clr.className = 'btn'; clr.textContent = '전체 지우기';
      }, 4000);
    });
    row.appendChild(clr);
    p.body.appendChild(row);

    p.body.appendChild(U.el('div', 'note',
      '대회 지원서나 수업 발표에서 가장 신뢰를 얻는 문장은 "저는 이 설정을 14번 바꿔 봤고, ' +
      '그중 가장 좋았던 것이 채점 구간에서 이만큼 재현됐습니다"입니다. ' +
      '숨기는 것보다 밝히는 쪽이 항상 강합니다.'));
    return p;
  }

  function whyPanel() {
    const p = App.panel('왜 기록을 남기는가');
    p.body.innerHTML =
      '<p class="small">헤지펀드의 리서처는 아이디어 하나마다 문서를 만듭니다. ' +
      '가설이 무엇이었고, 어떻게 검증했고, 결과가 어땠고, 왜 버렸는지를 남깁니다. ' +
      '버린 아이디어의 기록이 더 두꺼운 경우도 많습니다.</p>' +
      '<p class="small">이유는 <b>다중검정</b> 때문입니다. 유의수준 5%로 20번 시험하면 ' +
      '아무 신호가 없어도 평균 한 번은 "유의하다"고 나옵니다. ' +
      '몇 번 시험했는지를 모르면 그 한 번이 진짜인지 알 방법이 없습니다.</p>' +
      '<div class="note">실무에서 쓰는 보정 방법도 있습니다. ' +
      '<b>Deflated Sharpe Ratio</b>(López de Prado)는 시도 횟수를 넣어 샤프지수를 깎습니다. ' +
      '20번 시도해서 얻은 샤프 1.0은 한 번에 얻은 샤프 1.0과 같은 값이 아니라는 뜻입니다.</div>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(summaryPanel());
    const sp = searchPanel();
    if (sp) host.appendChild(sp);
    const lp = listPanel(host);
    if (lp) host.appendChild(lp);
    const ep = exportPanel(host);
    if (ep) host.appendChild(ep);
    host.appendChild(whyPanel());
  }

  App.register('journal', { render: draw });
})(window.QL = window.QL || {});
