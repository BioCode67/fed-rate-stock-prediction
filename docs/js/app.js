/* ============================================================================
 *  app.js — 화면 뼈대 (메뉴, 상태바, 화면 전환)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA;
  const $ = U.$, $$ = U.$$;

  const App = { screen: null, screens: {} };

  App.register = function (id, def) { App.screens[id] = def; };

  App.go = function (id) {
    if (!App.screens[id]) return;
    App.screen = id;
    $$('.nav-item').forEach(function (b) { b.classList.toggle('on', b.dataset.screen === id); });
    const main = $('#main');
    main.innerHTML = '';
    main.scrollTop = 0;
    try {
      App.screens[id].render(main);
      App.stepHint(main, id);
    } catch (e) {
      main.innerHTML = '<div class="panel"><div class="panel-body"><div class="note bad">' +
        '화면을 그리는 중 문제가 생겼습니다: ' + U.escape(e.message) + '</div></div></div>';
      console.error(e);
    }
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    setTimeout(function () { C.redrawAll(); }, 30);
  };

  /* ------------------------------------------------------------------------
   *  공통 부품
   * ----------------------------------------------------------------------*/
  App.panel = function (title, opts) {
    opts = opts || {};
    const p = U.el('div', 'panel' + (opts.cls ? ' ' + opts.cls : ''));
    const head = U.el('div', 'panel-head');
    const t = U.el('div', 'panel-title');
    t.innerHTML = title;
    head.appendChild(t);
    if (opts.sub) head.appendChild(U.el('div', 'panel-sub', opts.sub));
    const actions = U.el('div', 'panel-actions');
    head.appendChild(actions);
    p.appendChild(head);
    const body = U.el('div', 'panel-body' + (opts.tight ? ' tight' : ''));
    p.appendChild(body);
    p.head = head; p.body = body; p.actions = actions;
    return p;
  };

  App.stat = function (label, value, detail, cls) {
    const d = U.el('div', 'stat');
    d.appendChild(U.el('div', 'k', label));
    const v = U.el('div', 'v' + (cls ? ' ' + cls : ''), value);
    d.appendChild(v);
    if (detail !== undefined) d.appendChild(U.el('div', 'd', detail));
    return d;
  };

  App.table = function (headers, rows, opts) {
    opts = opts || {};
    const t = U.el('table', 't');
    const thead = U.el('thead'), tr = U.el('tr');
    headers.forEach(function (h) {
      const th = U.el('th', h.num ? 'num' : '', h.label !== undefined ? h.label : h);
      if (h.width) th.style.width = h.width;
      tr.appendChild(th);
    });
    thead.appendChild(tr); t.appendChild(thead);
    const tb = U.el('tbody');
    rows.forEach(function (r) {
      const trr = U.el('tr');
      if (r.__cls) trr.className = r.__cls;
      if (r.__click) { trr.style.cursor = 'pointer'; trr.addEventListener('click', r.__click); }
      (r.cells || r).forEach(function (c, j) {
        const td = U.el('td', headers[j] && headers[j].num ? 'num' : '');
        if (c && c.nodeType) td.appendChild(c);
        else td.innerHTML = (c === null || c === undefined) ? '' : String(c);
        trr.appendChild(td);
      });
      tb.appendChild(trr);
    });
    t.appendChild(tb);
    if (opts.scroll) {
      const w = U.el('div', 'tbl-scroll');
      w.appendChild(t);
      return w;
    }
    return t;
  };

  // 등락률 표시 (색 + 부호)
  App.chg = function (x, digits) {
    const s = U.el('span', isFinite(x) ? (x > 0 ? 'up' : (x < 0 ? 'down' : 'flat')) : 'flat');
    s.textContent = isFinite(x) ? ((x > 0 ? '+' : '') + (x * 100).toFixed(digits === undefined ? 2 : digits) + '%') : '—';
    return s;
  };

  App.bar = function (frac, cls) {
    const b = U.el('div', 'bar' + (cls ? ' ' + cls : ''));
    const i = U.el('i');
    i.style.width = Math.max(0, Math.min(1, Math.abs(frac))) * 100 + '%';
    b.appendChild(i);
    return b;
  };

  /* ------------------------------------------------------------------------
   *  커리큘럼 안내
   *  "화면 열기"로 넘어온 학생이 무엇을 하러 왔는지 잊지 않도록,
   *  지금 단계가 이 화면을 가리키면 맨 위에 할 일을 띄웁니다.
   * ----------------------------------------------------------------------*/
  App.stepHint = function (main, screenId) {
    const CURR = root.CURR;
    if (!CURR || screenId === 'home') return;
    const step = CURR.next();
    if (!step || step.screen !== screenId) return;

    const idx = CURR.indexOf(step.id);
    const box = U.el('div', 'panel');
    box.style.borderColor = 'var(--amber-dim)';
    const head = U.el('div', 'panel-head');
    head.style.background = 'var(--amber-dim)';
    const t = U.el('div', 'panel-title');
    t.innerHTML = 'STEP ' + (idx + 1) + ' <span class="accent">' + U.escape(step.title) + '</span>';
    head.appendChild(t);
    const actions = U.el('div', 'panel-actions');
    const doneBtn = U.el('button', 'btn sm', '완료했어요');
    doneBtn.addEventListener('click', function () {
      CURR.setDone(step.id, true);
      App.go(screenId);
    });
    const homeBtn = U.el('button', 'btn sm', '시작하기로');
    homeBtn.addEventListener('click', function () { App.go('home'); });
    actions.appendChild(doneBtn);
    actions.appendChild(homeBtn);
    head.appendChild(actions);
    box.appendChild(head);
    const body = U.el('div', 'panel-body');
    body.innerHTML = '<div class="small"><b>해 볼 것</b> · ' + step.do + '</div>' +
      '<div class="tiny" style="margin-top:5px">확인 질문 — ' + U.escape(step.check) + '</div>';
    box.appendChild(body);
    main.insertBefore(box, main.firstChild);
  };

  /* ------------------------------------------------------------------------
   *  상태바
   * ----------------------------------------------------------------------*/
  App.setStatus = function () {
    const m = DATA.state.meta || {};
    const bar = $('#statusbar');
    bar.innerHTML = '';
    const add = function (txt, cls) { bar.appendChild(U.el('span', cls || '', txt)); };
    const sep = function () { bar.appendChild(U.el('span', 'sep', '│')); };

    if (m.synthetic) add('◆ 가상 데이터 (실제 시장 아님)', 'amber');
    else add('◆ 실데이터', 'up');
    sep();
    add('갱신 ' + (m.updated || '—'));
    sep();
    add('종목 ' + (m.n_tickers || DATA.state.tickers.length));
    sep();
    add('기간 ' + (DATA.state.dates[0] || '—') + ' ~ ' + (DATA.state.dates[DATA.state.dates.length - 1] || '—'));
    sep();
    add(DATA.state.full ? '전체 기간 로드됨' : '최근 구간만 로드됨');
    sep();
    add('교육·연구용 · 실제 투자 판단에 사용 금지');
  };

  /* ------------------------------------------------------------------------
   *  시작
   * ----------------------------------------------------------------------*/
  App.boot = function () {
    // 메뉴 연결
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.dataset.screen); });
    });
    // 숫자키 단축키 (터미널답게). 0 = 시작하기, 1~9 = 각 화면
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea')) return;
      const items = $$('.nav-item');
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 0 && n < items.length) App.go(items[n].dataset.screen);
    });

    const boot = $('#boot');
    DATA.loadFast().then(function () {
      boot.classList.add('hidden');
      App.setStatus();
      const first = (location.hash || '').replace('#', '') || 'home';
      App.go(App.screens[first] ? first : 'home');
      // 전체 기간은 뒤에서 조용히
      DATA.loadFull().then(function () {
        App.setStatus();
        if (App.screens[App.screen] && App.screens[App.screen].onFullData) {
          App.screens[App.screen].onFullData();
        }
      }).catch(function (e) { console.warn('전체 데이터 로드 실패', e); });
    }).catch(function (e) {
      boot.innerHTML = '<div class="note bad" style="max-width:640px">' +
        '<b>데이터를 불러오지 못했습니다.</b><br>' + U.escape(e.message) +
        '<br><br>아직 데이터 파일이 만들어지지 않았을 수 있습니다. ' +
        '저장소에서 <code>시장 데이터 자동 갱신</code> 워크플로를 한 번 실행하거나, ' +
        '로컬에서 <code>python -m pipeline.fetch_market</code> 를 돌리세요.</div>';
    });
  };

  root.App = App;
})(window.QL = window.QL || {});
