/* ============================================================================
 *  market.js — 마켓 화면
 *  나스닥100 전 종목을 한 화면에서 훑고, 종목 하나를 골라 자세히 봅니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App;

  const S = { sortKey: 'chg1', sortDir: -1, query: '', sector: '', selected: null, range: 250 };

  const COLS = [
    { key: 'ticker', label: '종목' },
    { key: 'sector', label: '섹터' },
    { key: 'price', label: '종가', num: true },
    { key: 'chg1', label: '1일', num: true },
    { key: 'chg5', label: '1주', num: true },
    { key: 'chg21', label: '1개월', num: true },
    { key: 'chg63', label: '3개월', num: true },
    { key: 'chg252', label: '1년', num: true },
    { key: 'vol', label: '변동성', num: true },
    { key: 'spark', label: '3개월 흐름' }
  ];

  function rowsData() {
    return DATA.tradables().map(function (t) {
      const last = DATA.lastPrice(t);
      return {
        ticker: t, sector: DATA.sector(t),
        price: last ? last.price : NaN,
        chg1: DATA.change(t, 1), chg5: DATA.change(t, 5),
        chg21: DATA.change(t, 21), chg63: DATA.change(t, 63), chg252: DATA.change(t, 252),
        vol: DATA.vol(t, 60)
      };
    });
  }

  function sparkline(ticker, n) {
    const cv = U.el('canvas', 'spark');
    const s = DATA.series(ticker) || [];
    const vals = s.slice(Math.max(0, s.length - (n || 63)));
    setTimeout(function () {
      const dpr = window.devicePixelRatio || 1;
      const w = 72, h = 22;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fin = vals.filter(function (v) { return v !== null && isFinite(v); });
      if (fin.length < 2) return;
      const mn = Math.min.apply(null, fin), mx = Math.max.apply(null, fin);
      const up = fin[fin.length - 1] >= fin[0];
      ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue(up ? '--up' : '--down').trim() || '#888';
      ctx.lineWidth = 1.25; ctx.beginPath();
      let started = false;
      vals.forEach(function (v, i) {
        if (v === null || !isFinite(v)) return;
        const x = (i / (vals.length - 1)) * (w - 2) + 1;
        const y = h - 2 - ((v - mn) / ((mx - mn) || 1)) * (h - 4);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }, 0);
    return cv;
  }

  function renderTable(host) {
    const rows = rowsData().filter(function (r) {
      if (S.sector && r.sector !== S.sector) return false;
      if (S.query && r.ticker.toLowerCase().indexOf(S.query.toLowerCase()) < 0) return false;
      return true;
    });
    rows.sort(function (a, b) {
      const va = a[S.sortKey], vb = b[S.sortKey];
      if (typeof va === 'string') return S.sortDir * va.localeCompare(vb);
      const x = isFinite(va) ? va : -1e18, y = isFinite(vb) ? vb : -1e18;
      return S.sortDir * (x - y);
    });

    const headers = COLS.map(function (c) { return { label: c.label, num: !!c.num }; });
    const body = rows.map(function (r) {
      const tick = U.el('span', 'tick', r.ticker);
      return {
        __cls: S.selected === r.ticker ? 'sel' : '',
        __click: function () { S.selected = r.ticker; draw(host); },
        cells: [
          tick, U.el('span', 'sector', r.sector),
          isFinite(r.price) ? r.price.toFixed(2) : '—',
          App.chg(r.chg1), App.chg(r.chg5), App.chg(r.chg21), App.chg(r.chg63), App.chg(r.chg252),
          isFinite(r.vol) ? (r.vol * 100).toFixed(1) + '%' : '—',
          sparkline(r.ticker, 63)
        ]
      };
    });

    const tbl = App.table(headers, body, { scroll: true });
    // 정렬 헤더
    const ths = tbl.querySelectorAll('th');
    COLS.forEach(function (c, i) {
      const th = ths[i];
      th.classList.add('sortable');
      if (c.key === S.sortKey) th.classList.add('sorted');
      th.addEventListener('click', function () {
        if (S.sortKey === c.key) S.sortDir *= -1;
        else { S.sortKey = c.key; S.sortDir = (c.key === 'ticker' || c.key === 'sector') ? 1 : -1; }
        draw(host);
      });
    });
    return { el: tbl, count: rows.length };
  }

  function detailPanel() {
    const t = S.selected || DATA.tradables()[0];
    S.selected = t;
    const p = App.panel('종목 상세 <span class="accent">' + U.escape(t) + '</span>',
      { sub: DATA.sector(t) });

    const seg = U.el('div', 'seg');
    [[63, '3개월'], [250, '1년'], [750, '3년'], [0, '전체']].forEach(function (o) {
      const b = U.el('button', S.range === o[0] ? 'on' : '', o[1]);
      b.addEventListener('click', function () { S.range = o[0]; drawDetail(p.body, t);
        p.actions.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.textContent === o[1]); });
      });
      seg.appendChild(b);
    });
    p.actions.appendChild(seg);

    drawDetail(p.body, t);
    return p;
  }

  function drawDetail(host, t) {
    host.innerHTML = '';
    const s = DATA.series(t) || [];
    const n = S.range === 0 ? s.length : Math.min(s.length, S.range);
    const from = s.length - n;
    const vals = s.slice(from);
    const labels = DATA.state.dates.slice(from).map(function (d) { return d.slice(2, 7); });

    const last = DATA.lastPrice(t);
    const stats = U.el('div', 'grid g4');
    stats.style.marginBottom = '10px';
    const ch = DATA.change(t, 1);
    stats.appendChild(App.stat('종가', last ? last.price.toFixed(2) : '—',
      DATA.state.dates[last ? last.i : 0], ''));
    stats.appendChild(App.stat('1일', isFinite(ch) ? ((ch > 0 ? '+' : '') + (ch * 100).toFixed(2) + '%') : '—',
      '', isFinite(ch) ? (ch >= 0 ? 'up' : 'down') : ''));   // 이건 등락률이므로 색을 씁니다
    const y = DATA.change(t, 252);
    stats.appendChild(App.stat('1년', isFinite(y) ? ((y > 0 ? '+' : '') + (y * 100).toFixed(1) + '%') : '—',
      '', isFinite(y) ? (y >= 0 ? 'up' : 'down') : ''));
    stats.appendChild(App.stat('변동성(60일)', (DATA.vol(t, 60) * 100).toFixed(1) + '%', '연율화'));
    host.appendChild(stats);

    const cv = U.el('canvas', 'chart lg');
    host.appendChild(cv);
    C.line(cv, {
      labels: labels,
      series: [{ name: t, values: vals, color: C.seriesColor(0), area: true }],
      yFmt: function (v) { return v.toFixed(0); },
      tipFmt: function (v) { return '$' + v.toFixed(2); }
    });

    // 거래량
    const vol = DATA.state.volume[t];
    if (vol) {
      const cv2 = U.el('canvas', 'chart sm');
      host.appendChild(U.el('div', 'tiny mt', '거래량 (천 주)'));
      host.appendChild(cv2);
      C.line(cv2, {
        labels: labels,
        series: [{ name: '거래량', values: vol.slice(from), color: C.seriesColor(6), area: true }],
        yFmt: function (v) { return U.compact(v * 1000); }
      });
    }
  }

  function marketStrip() {
    const p = App.panel('지수 · 매크로', { sub: '나스닥 중심' });
    const g = U.el('div', 'grid g4');
    const bms = Object.keys((DATA.state.universe && DATA.state.universe.benchmarks) || {});
    bms.forEach(function (b) {
      const last = DATA.lastPrice(b);
      if (!last) return;
      const c = DATA.change(b, 1);
      const name = DATA.state.universe.benchmarks[b];
      // 값(가격)은 중립색으로 둡니다. 색은 '등락'에만 씁니다 — 표를 훑을 때 오해를 막기 위해서입니다.
      const st = App.stat(name + ' (' + b + ')',
        last.price.toLocaleString('en-US', { maximumFractionDigits: 2 }), '');
      const d = st.querySelector('.d');
      d.innerHTML = '';
      d.appendChild(App.chg(c));
      d.appendChild(document.createTextNode('  1일 · 1년 '));
      d.appendChild(App.chg(DATA.change(b, 252), 1));
      g.appendChild(st);
    });

    p.body.appendChild(g);

    // 매크로는 지수와 성격이 달라 한 줄로 따로 놓습니다 (전체 데이터 로드 후에만 있음)
    const mac = DATA.state.macro;
    if (mac && mac.series) {
      const strip = U.el('div', 'row center');
      strip.style.cssText = 'gap:18px;padding:8px 2px 0;margin-top:8px;border-top:1px solid var(--line)';
      ['DGS2', 'DGS10', 'T10Y2Y', 'VIXCLS', 'BAMLH0A0HYM2'].forEach(function (k) {
        const s = mac.series[k];
        if (!s) return;
        let v = null, prev = null;
        for (let i = s.values.length - 1; i >= 0; i--) {
          if (s.values[i] !== null) { if (v === null) v = s.values[i]; else { prev = s.values[i]; break; } }
        }
        if (v === null) return;
        const diff = prev === null ? NaN : v - prev;
        const item = U.el('span', 'small');
        item.innerHTML = '<span class="tiny" style="letter-spacing:.06em">' + U.escape(s.name) + '</span> ' +
          '<b class="mono">' + v.toFixed(2) + (k === 'VIXCLS' ? '' : '%') + '</b>';
        if (isFinite(diff) && Math.abs(diff) > 1e-9) {
          const d = U.el('span', 'mono tiny ' + (diff > 0 ? 'up' : 'down'));
          d.textContent = ' ' + (diff > 0 ? '▲' : '▼') + Math.abs(diff).toFixed(2);
          item.appendChild(d);
        }
        strip.appendChild(item);
      });
      if (strip.children.length) p.body.appendChild(strip);
    }
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(marketStrip());

    const p = App.panel('나스닥100 <span class="accent">종목</span>',
      { sub: '열 제목을 눌러 정렬 · 행을 눌러 아래에서 자세히', tight: true });

    // 필터 줄
    const bar = U.el('div', 'row center');
    bar.style.padding = '8px 12px';
    bar.style.borderBottom = '1px solid var(--line)';
    const q = U.el('input');
    q.type = 'search'; q.placeholder = '종목 검색 (예: NVDA)'; q.value = S.query;
    q.addEventListener('input', function () { S.query = q.value; refresh(); });
    bar.appendChild(q);

    const sectors = {};
    DATA.tradables().forEach(function (t) { sectors[DATA.sector(t)] = 1; });
    const sel = U.el('select');
    const o0 = U.el('option', '', '전체 섹터'); o0.value = ''; sel.appendChild(o0);
    Object.keys(sectors).sort().forEach(function (s) {
      const o = U.el('option', '', s); o.value = s;
      if (S.sector === s) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { S.sector = sel.value; refresh(); });
    bar.appendChild(sel);
    const count = U.el('span', 'tiny');
    bar.appendChild(count);
    p.body.appendChild(bar);

    const holder = U.el('div');
    p.body.appendChild(holder);

    function refresh() {
      const r = renderTable(host);
      holder.innerHTML = '';
      holder.appendChild(r.el);
      count.textContent = r.count + '개 종목';
      // 선택 상태 반영
      const d = host.querySelector('.panel.detail');
      if (d) d.remove();
      const dp = detailPanel();
      dp.classList.add('detail');
      host.appendChild(dp);
    }
    host.appendChild(p);
    refresh();
  }

  App.register('market', {
    render: function (host) { draw(host); },
    onFullData: function () { if (App.screen === 'market') draw(root.U.$('#main')); }
  });
})(window.QL = window.QL || {});
