/* ============================================================================
 *  home.js — 시작 화면
 *
 *  처음 온 학생이 보는 첫 화면입니다. 여기서 해야 할 일은 하나뿐입니다.
 *    "지금 무엇을 하면 되는지" 한 가지만 크게 보여 주기.
 *
 *  화면이 아홉 개나 되면 어디부터 눌러야 할지 모릅니다. 그래서 커리큘럼의
 *  '다음 단계'를 맨 위에 크게 놓고, 나머지는 그 아래로 내렸습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, CURR = root.CURR;

  const S = { showAll: false, showAnswer: {} };

  /* ------------------------------------------------------------------------
   *  지금 할 일 (가장 중요한 카드)
   * ----------------------------------------------------------------------*/
  function nextStepPanel(host) {
    const step = CURR.next();
    const done = CURR.doneCount();
    const total = CURR.steps.length;

    if (!step) {
      const p = App.panel('완주 <span class="accent">축하합니다</span>');
      p.body.innerHTML =
        '<p class="small">' + CURR.steps.length + '단계를 모두 마쳤습니다. 이제 이 사이트에서 배울 수 있는 것은 거의 다 다뤘습니다.</p>' +
        '<p class="small">다음은 실제 대회입니다. <b>배우기 → 대회 준비</b>에서 시기를 확인하고, ' +
        'WorldQuant BRAIN처럼 상시 연습이 가능한 곳부터 시작하세요. ' +
        '여기서 만든 전략과 순위표 기록을 그대로 지원서에 쓸 수 있습니다.</p>';
      const btn = U.el('button', 'btn primary', '대회 준비 보기');
      btn.addEventListener('click', function () { App.go('learn'); });
      p.body.appendChild(btn);
      return p;
    }

    const idx = CURR.indexOf(step.id);
    const p = App.panel('지금 할 일 <span class="accent">STEP ' + (idx + 1) + '</span>',
      { sub: step.part });

    const bar = U.el('div', 'bar');
    const fill = U.el('i');
    fill.style.width = Math.round(done / total * 100) + '%';
    bar.appendChild(fill);
    p.body.appendChild(U.el('div', 'tiny', done + ' / ' + total + ' 단계 완료'));
    p.body.appendChild(bar);

    const title = U.el('div');
    title.style.cssText = 'font-size:19px;font-weight:650;margin:12px 0 6px';
    title.textContent = step.title;
    p.body.appendChild(title);

    // why/do 는 우리가 쓴 문장이라 강조 태그를 그대로 살립니다.
    const why = U.el('div', 'small');
    why.innerHTML = step.why;
    p.body.appendChild(why);

    const doBox = U.el('div', 'note');
    doBox.innerHTML = '<b>해 볼 것</b><br>' + step.do;
    p.body.appendChild(doBox);

    const row = U.el('div', 'row center mt');
    const go = U.el('button', 'btn primary', '화면 열기 →');
    go.addEventListener('click', function () { App.go(step.screen); });
    row.appendChild(go);

    const doneBtn = U.el('button', 'btn', '완료했어요');
    doneBtn.addEventListener('click', function () {
      CURR.setDone(step.id, true);
      draw(host);
    });
    row.appendChild(doneBtn);
    p.body.appendChild(row);

    // 확인 질문 — 답은 눌러야 보입니다(먼저 생각하게 하려고)
    const q = U.el('div');
    q.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)';
    q.innerHTML = '<div class="tiny" style="letter-spacing:.08em;text-transform:uppercase">확인 질문</div>' +
      '<div class="small" style="margin:4px 0">' + U.escape(step.check) + '</div>';
    const ansBtn = U.el('button', 'btn sm', S.showAnswer[step.id] ? '답 숨기기' : '먼저 생각해 본 뒤 열기');
    ansBtn.addEventListener('click', function () {
      S.showAnswer[step.id] = !S.showAnswer[step.id];
      draw(host);
    });
    q.appendChild(ansBtn);
    if (S.showAnswer[step.id]) {
      const a = U.el('div', 'note ok');
      a.innerHTML = step.answer;
      q.appendChild(a);
    }
    p.body.appendChild(q);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  오늘의 시장
   * ----------------------------------------------------------------------*/
  function marketPanel() {
    const p = App.panel('오늘의 시장', { sub: (DATA.state.meta && DATA.state.meta.last_date) || '' });
    const g = U.el('div', 'grid g4');

    ['QQQ', '^IXIC'].forEach(function (b) {
      const last = DATA.lastPrice(b);
      if (!last) return;
      const name = (DATA.state.universe.benchmarks || {})[b] || b;
      const st = App.stat(name, last.price.toLocaleString('en-US', { maximumFractionDigits: 2 }), '');
      const d = st.querySelector('.d');
      d.innerHTML = '';
      d.appendChild(App.chg(DATA.change(b, 1)));
      d.appendChild(document.createTextNode(' 1일 · 1년 '));
      d.appendChild(App.chg(DATA.change(b, 252), 1));
      g.appendChild(st);
    });

    // 오른 종목 / 내린 종목
    const list = DATA.tradables();
    let up = 0, down = 0;
    list.forEach(function (t) {
      const c = DATA.change(t, 1);
      if (!isFinite(c)) return;
      if (c > 0) up++; else if (c < 0) down++;
    });
    const st = App.stat('오른 종목', up + ' / ' + (up + down), '내린 종목 ' + down + '개');
    g.appendChild(st);

    // 오늘 가장 많이 오른 종목
    const best = list.map(function (t) { return { t: t, c: DATA.change(t, 1) }; })
      .filter(function (x) { return isFinite(x.c); })
      .sort(function (a, b) { return b.c - a.c; })[0];
    if (best) {
      const s2 = App.stat('오늘 1위', best.t, '');
      const d2 = s2.querySelector('.d');
      d2.innerHTML = '';
      d2.appendChild(App.chg(best.c));
      g.appendChild(s2);
    }
    p.body.appendChild(g);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  전체 커리큘럼
   * ----------------------------------------------------------------------*/
  function curriculumPanel(host) {
    const p = App.panel('퀀트 트레이더가 되는 길',
      { sub: CURR.steps.length + '단계 · 진행 상황은 이 브라우저에 저장됩니다' });

    const toggle = U.el('button', 'btn sm', S.showAll ? '접기' : '전체 보기');
    toggle.addEventListener('click', function () { S.showAll = !S.showAll; draw(host); });
    p.actions.appendChild(toggle);

    const nextId = CURR.next() ? CURR.next().id : null;
    let lastPart = null;

    CURR.steps.forEach(function (st, i) {
      const isDone = CURR.isDone(st.id);
      const isNext = st.id === nextId;
      if (!S.showAll && !isDone && !isNext && i > CURR.indexOf(nextId || 'c1') + 2) return;

      if (st.part !== lastPart) {
        lastPart = st.part;
        const h = U.el('div', 'tiny');
        h.style.cssText = 'letter-spacing:.1em;text-transform:uppercase;margin:12px 0 4px;color:var(--amber)';
        h.textContent = st.part;
        p.body.appendChild(h);
      }

      const row = U.el('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:7px 0;' +
        'border-bottom:1px solid var(--line);cursor:pointer';
      const mark = U.el('div', 'mono');
      mark.style.cssText = 'flex:0 0 22px;height:22px;display:grid;place-items:center;font-size:11px;border:1px solid ' +
        (isDone ? 'var(--up);color:var(--up)' : (isNext ? 'var(--amber);color:var(--amber)' : 'var(--line-strong);color:var(--ink-3)'));
      mark.textContent = isDone ? '✓' : String(i + 1);
      const txt = U.el('div');
      txt.style.flex = '1';
      txt.innerHTML = '<div style="font-weight:' + (isNext ? '650' : '400') +
        (isDone ? ';color:var(--ink-3)' : '') + '">' + U.escape(st.title) +
        (isNext ? ' <span class="tag demo">지금</span>' : '') + '</div>' +
        (S.showAll ? '<div class="tiny">' + U.escape(st.check) + '</div>' : '');
      row.appendChild(mark); row.appendChild(txt);
      row.addEventListener('click', function () { App.go(st.screen); });
      p.body.appendChild(row);
    });

    if (!S.showAll) {
      p.body.appendChild(U.el('div', 'tiny mt', '"전체 보기"를 누르면 ' + CURR.steps.length + '단계 전부와 확인 질문을 볼 수 있습니다.'));
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  화면 안내
   * ----------------------------------------------------------------------*/
  const SCREENS = [
    ['market', '마켓', '나스닥100 전 종목을 훑고 종목 하나를 자세히 봅니다'],
    ['intraday', '장중', '30분봉으로 하루 안의 움직임과 밤사이 갭을 봅니다'],
    ['factor', '팩터 분석', '종목을 줄 세우는 기준이 실제로 통하는지 IC로 검증합니다'],
    ['alpha', '알파 만들기', '팩터를 조합해 나만의 식을 씁니다. 대회에서 제출하는 것이 이것입니다'],
    ['strategy', '전략 실험실', '퀀트 기법과 AI를 같은 조건에서 겨루고 채점 구간에 제출합니다'],
    ['trade', '모의투자', '과거 시점부터 하루씩 진행하며 직접 또는 전략으로 매매합니다'],
    ['rank', '순위표', '채점 구간 성과로 겨룹니다. 거래 기록까지 저장돼 재현할 수 있습니다'],
    ['journal', '연구 노트', '내가 몇 번 시도했는지 자동으로 쌓입니다. 발표자료로 내보낼 수 있습니다'],
    ['learn', '배우기', '흔한 함정, 실습 과제, 대회 준비, 용어집']
  ];

  function mapPanel() {
    const p = App.panel('화면 안내', { sub: '언제든 왼쪽 메뉴나 숫자키로 이동할 수 있습니다' });
    const g = U.el('div', 'grid g2');
    SCREENS.forEach(function (s, i) {
      const card = U.el('div');
      card.style.cssText = 'border:1px solid var(--line);padding:10px 12px;cursor:pointer';
      card.innerHTML = '<div style="font-weight:650">' + U.escape(s[1]) +
        ' <span class="tiny mono">' + (i + 1) + '</span></div>' +
        '<div class="tiny">' + U.escape(s[2]) + '</div>';
      card.addEventListener('click', function () { App.go(s[0]); });
      card.addEventListener('mouseenter', function () { card.style.borderColor = 'var(--amber)'; });
      card.addEventListener('mouseleave', function () { card.style.borderColor = 'var(--line)'; });
      g.appendChild(card);
    });
    p.body.appendChild(g);
    return p;
  }

  function introPanel() {
    const p = App.panel('QUANT LAB',
      { sub: '실제 나스닥100 데이터로 퀀트 기법과 AI를 시험하는 교육용 터미널' });
    p.body.innerHTML =
      '<p class="small">이곳에서 배우는 것은 "돈 버는 법"이 아니라 ' +
      '<b>좋아 보이는 숫자를 의심하는 법</b>입니다. 대회 심사위원도, 면접관도 같은 것을 봅니다.</p>' +
      '<p class="small">데이터는 실제 나스닥100 종목의 12년치이고, GitHub Actions가 평일 매일 자동으로 갱신합니다. ' +
      '설치할 것도 계정도 필요 없습니다. 진행 상황은 이 브라우저에 저장되니 언제든 이어서 하면 됩니다.</p>' +
      '<div class="note warn">교육·연구용입니다. 실제 투자 판단에 사용하지 마십시오. ' +
      '이 데이터는 생존 편향이 있고(지금 남아 있는 종목만 포함), 세금이 빠져 있으며, ' +
      '슬리피지를 낙관적으로 잡았습니다.</div>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    const first = CURR.doneCount() === 0;
    if (first) host.appendChild(introPanel());
    host.appendChild(nextStepPanel(host));
    host.appendChild(marketPanel());
    host.appendChild(curriculumPanel(host));
    if (!first) host.appendChild(introPanel());
    host.appendChild(mapPanel());
  }

  App.register('home', { render: draw, onFullData: function () { if (App.screen === 'home') draw(App.host()); } });
})(window.QL = window.QL || {});
