/* ============================================================================
 *  trade.js — 모의투자 (실제 나스닥 데이터)
 *
 *  방식: '역사 재생'입니다. 과거 어느 시점으로 돌아가서 하루씩 진행하며 매매합니다.
 *  실제 데이터를 쓰되 결과를 그 자리에서 확인할 수 있어 수업·대회에 적합합니다.
 *
 *  체결 규칙 (현실에 맞춘 최소한의 규칙)
 *   - 주문은 '그날 종가'로 체결됩니다.
 *   - 살 때와 팔 때 각각 수수료+슬리피지를 뗍니다.
 *   - 현금이 모자라면 살 수 없고, 없는 주식은 팔 수 없습니다(공매도 없음).
 *   - 그날 가격이 없는 종목(상장 전 등)은 거래 목록에 나오지 않습니다.
 *
 *  진행 상황은 브라우저에 저장되므로 새로고침해도 이어집니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA, App = root.App, M = root.M;

  const KEY = 'quantlab.account.v1';
  let acc = null;

  /* ------------------------------------------------------------------------
   *  계좌
   * ----------------------------------------------------------------------*/
  function newAccount(opts) {
    return {
      created: new Date().toISOString(),
      cash: opts.cash,
      initial: opts.cash,
      fee: opts.fee,                 // 편도 비율 (수수료+슬리피지)
      t: opts.startIndex,            // 지금 날짜(인덱스)
      startIndex: opts.startIndex,
      positions: {},                 // ticker -> {qty, cost}
      trades: [],
      history: [],                   // [{d, equity, bench}]
      // 전략 자동매매용 (직접 매매면 null)
      strategy: opts.strategy || 'manual',
      strategyName: opts.strategyName || '직접 매매',
      rebalance: opts.rebalance || 21,
      topK: opts.topK || 10,
      lastReb: -1e9,
      interventions: 0               // 전략 계좌에서 사용자가 직접 손댄 횟수
    };
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(acc)); } catch (e) {} }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const a = JSON.parse(raw);
      if (!a || typeof a.t !== 'number' || a.t >= DATA.state.dates.length) return null;
      return a;
    } catch (e) { return null; }
  }

  function priceOf(ticker, i) {
    const s = DATA.series(ticker);
    if (!s) return NaN;
    const idx = (i === undefined) ? acc.t : i;
    for (let k = idx; k >= Math.max(0, idx - 5); k--) {   // 휴장 등으로 값이 비면 직전 값
      if (s[k] !== null && isFinite(s[k])) return s[k];
    }
    return NaN;
  }

  function equity(i) {
    let v = acc.cash;
    Object.keys(acc.positions).forEach(function (t) {
      const p = priceOf(t, i);
      if (isFinite(p)) v += acc.positions[t].qty * p;
    });
    return v;
  }

  function benchEquity(i) {
    // 같은 시점에 QQQ를 전액 샀다면
    const p0 = priceOf('QQQ', acc.startIndex), p1 = priceOf('QQQ', i);
    if (!isFinite(p0) || !isFinite(p1)) return NaN;
    return acc.initial * (p1 / p0) * (1 - acc.fee);   // 벤치마크도 한 번은 사야 하므로 비용 1회
  }

  function record() {
    acc.history.push({ d: DATA.state.dates[acc.t], e: Math.round(equity()), b: Math.round(benchEquity(acc.t)) });
  }

  function buy(ticker, qty) {
    const p = priceOf(ticker);
    if (!isFinite(p) || qty <= 0) return '가격을 확인할 수 없습니다.';
    const cost = qty * p * (1 + acc.fee);
    if (cost > acc.cash + 1e-9) return '현금이 부족합니다. (필요 ' + U.comma(cost) + ' / 보유 ' + U.comma(acc.cash) + ')';
    acc.cash -= cost;
    const pos = acc.positions[ticker] || { qty: 0, cost: 0 };
    pos.cost += cost;
    pos.qty += qty;
    acc.positions[ticker] = pos;
    acc.trades.push({ d: DATA.state.dates[acc.t], side: '매수', t: ticker, qty: qty, p: p, amt: cost });
    return null;
  }

  function sell(ticker, qty) {
    const pos = acc.positions[ticker];
    if (!pos || pos.qty <= 0) return '보유하고 있지 않습니다.';
    qty = Math.min(qty, pos.qty);
    const p = priceOf(ticker);
    if (!isFinite(p)) return '가격을 확인할 수 없습니다.';
    const proceeds = qty * p * (1 - acc.fee);
    acc.cash += proceeds;
    pos.cost *= (1 - qty / pos.qty);
    pos.qty -= qty;
    if (pos.qty < 1e-9) delete acc.positions[ticker];
    acc.trades.push({ d: DATA.state.dates[acc.t], side: '매도', t: ticker, qty: qty, p: p, amt: proceeds });
    return null;
  }

  // 전략이 시키는 대로 포트폴리오를 다시 짭니다 (그날 종가 체결).
  function rebalanceToStrategy() {
    const st = root.STRAT && root.STRAT.list.filter(function (x) { return x.id === acc.strategy; })[0];
    if (!st) return;
    const scores = st.score(acc.t);
    const keys = Object.keys(scores);
    if (keys.length < 5) return;
    keys.sort(function (a, b) { return scores[b] - scores[a]; });
    const chosen = (acc.strategy === 'equal' ? keys : keys.slice(0, acc.topK));
    const px = {};
    chosen.forEach(function (t) { px[t] = priceOf(t); });
    const usable = chosen.filter(function (t) { return isFinite(px[t]) && px[t] > 0; });
    if (!usable.length) return;

    // 1) 목표에 없는 종목을 전부 팝니다.
    Object.keys(acc.positions).forEach(function (t) {
      if (usable.indexOf(t) < 0) sell(t, acc.positions[t].qty);
    });

    // 2) 목표 금액을 정합니다.
    //    ★ 수수료를 목표에 반영해야 합니다. per = 자산/종목수 로 그냥 두면
    //      매수마다 per*(1+fee) 가 나가서 마지막 종목에서 현금이 모자라 조용히 실패합니다.
    const value = equity();
    const per = (value / usable.length) / (1 + acc.fee);

    // 3) 파는 것을 먼저, 사는 것을 나중에 합니다(현금을 확보한 뒤 사야 하므로).
    const orders = usable.map(function (t) {
      const cur = (acc.positions[t] ? acc.positions[t].qty : 0) * px[t];
      return { t: t, diff: per - cur };
    });
    orders.filter(function (o) { return o.diff < 0; }).forEach(function (o) {
      const qty = Math.floor(-o.diff / px[o.t]);
      if (qty > 0) sell(o.t, qty);
    });
    orders.filter(function (o) { return o.diff > 0; }).forEach(function (o) {
      const unit = px[o.t] * (1 + acc.fee);
      // 매도에도 수수료가 붙으므로 확보된 현금이 계산보다 조금 적습니다.
      // 가용 현금 한도를 함께 걸어 두면 마지막 종목이 통째로 빠지는 일이 없습니다.
      const qty = Math.min(Math.floor(o.diff / unit), Math.floor(acc.cash / unit));
      if (qty > 0) buy(o.t, qty);
    });

    // 정수 주식만 살 수 있어 남는 현금을, 살 수 있는 종목에 한 주씩 더 넣어 줄입니다.
    for (let pass = 0; pass < 3; pass++) {
      let bought = false;
      for (let k = 0; k < usable.length; k++) {
        const t = usable[k];
        const unit = px[t] * (1 + acc.fee);
        if (acc.cash >= unit) { buy(t, 1); bought = true; }
      }
      if (!bought) break;
    }
    acc.lastReb = acc.t;
  }

  function advance(days) {
    const last = DATA.state.dates.length - 1;
    for (let k = 0; k < days && acc.t < last; k++) {
      acc.t++;
      // 전략 계좌라면 리밸런싱 주기마다 자동으로 갈아탑니다.
      if (acc.strategy !== 'manual' && acc.t - acc.lastReb >= acc.rebalance) {
        rebalanceToStrategy();
      }
      record();
    }
    save();
  }

  /* ------------------------------------------------------------------------
   *  화면
   * ----------------------------------------------------------------------*/
  function setupScreen(host) {
    const p = App.panel('모의투자 <span class="accent">시작하기</span>',
      { sub: '실제 나스닥 데이터로 과거 어느 시점부터 하루씩 진행합니다' });

    const nDates = DATA.state.dates.length;
    const opts = [
      { label: '1년 전부터', back: 252 },
      { label: '2년 전부터', back: 504 },
      { label: '3년 전부터', back: 756 },
      { label: '5년 전부터', back: 1260 }
    ].filter(function (o) { return nDates - o.back > 60; });

    const row = U.el('div', 'row');
    const fStart = U.el('div', 'field');
    fStart.appendChild(U.el('label', '', '시작 시점'));
    const selStart = U.el('select');
    opts.forEach(function (o) {
      const e = U.el('option', '', o.label + ' (' + DATA.state.dates[nDates - 1 - o.back] + ')');
      e.value = String(nDates - 1 - o.back);
      selStart.appendChild(e);
    });
    fStart.appendChild(selStart); row.appendChild(fStart);

    const fCash = U.el('div', 'field');
    fCash.appendChild(U.el('label', '', '초기 자본 (USD)'));
    const selCash = U.el('select');
    [[10000, '$10,000'], [100000, '$100,000'], [1000000, '$1,000,000']].forEach(function (o) {
      const e = U.el('option', '', o[1]); e.value = String(o[0]);
      if (o[0] === 100000) e.selected = true;
      selCash.appendChild(e);
    });
    fCash.appendChild(selCash); row.appendChild(fCash);

    const fFee = U.el('div', 'field');
    fFee.appendChild(U.el('label', '', '편도 비용 (%)'));
    const inpFee = U.el('input'); inpFee.type = 'number'; inpFee.value = '0.05'; inpFee.step = '0.01'; inpFee.min = '0';
    fFee.appendChild(inpFee); row.appendChild(fFee);

    row.appendChild(btn0());
    p.body.appendChild(row);

    // --- 매매 방식 ---
    const row2 = U.el('div', 'row mt');
    const fMode = U.el('div', 'field');
    fMode.appendChild(U.el('label', '', '매매 방식'));
    const selMode = U.el('select');
    [['manual', '직접 매매 (내가 고른다)'], ['strategy', '전략 자동매매 (규칙이 고른다)']].forEach(function (o) {
      const e = U.el('option', '', o[1]); e.value = o[0]; selMode.appendChild(e);
    });
    fMode.appendChild(selMode); row2.appendChild(fMode);

    const fStrat = U.el('div', 'field hidden');
    fStrat.appendChild(U.el('label', '', '전략'));
    const selStrat = U.el('select');
    selStrat.style.minWidth = '170px';
    (root.STRAT ? root.STRAT.list : []).forEach(function (st) {
      const e = U.el('option', '', st.name + '  [' + st.cat + ']'); e.value = st.id;
      selStrat.appendChild(e);
    });
    fStrat.appendChild(selStrat); row2.appendChild(fStrat);

    const fReb = U.el('div', 'field hidden');
    fReb.appendChild(U.el('label', '', '리밸런싱'));
    const selReb = U.el('select');
    [[5, '1주마다'], [21, '1개월마다'], [63, '3개월마다']].forEach(function (o) {
      const e = U.el('option', '', o[1]); e.value = String(o[0]);
      if (o[0] === 21) e.selected = true;
      selReb.appendChild(e);
    });
    fReb.appendChild(selReb); row2.appendChild(fReb);

    const fK = U.el('div', 'field hidden');
    fK.appendChild(U.el('label', '', '보유 종목'));
    const selK = U.el('select');
    [5, 10, 20].forEach(function (k) {
      const e = U.el('option', '', k + '종목'); e.value = String(k);
      if (k === 10) e.selected = true;
      selK.appendChild(e);
    });
    fK.appendChild(selK); row2.appendChild(fK);

    selMode.addEventListener('change', function () {
      const on = selMode.value === 'strategy';
      [fStrat, fReb, fK].forEach(function (f) { f.classList.toggle('hidden', !on); });
      note.textContent = on
        ? '전략이 정해진 주기마다 자동으로 갈아탑니다. 중간에 직접 사고파는 것도 가능합니다 — 그 개입이 도움이 되는지 확인해 보세요.'
        : '내가 직접 종목을 고르고 사고팝니다.';
    });
    const note = U.el('div', 'tiny');
    note.textContent = '내가 직접 종목을 고르고 사고팝니다.';
    row2.appendChild(note);
    p.body.appendChild(row2);

    const status = U.el('div', 'small mt');
    p.body.appendChild(status);

    function btn0() {
      const btn = U.el('button', 'btn primary', '계좌 열고 시작');
      btn.addEventListener('click', async function () {
        const mode = selMode.value;
        const stId = selStrat.value;
        const st = (root.STRAT ? root.STRAT.list : []).filter(function (x) { return x.id === stId; })[0];

        acc = newAccount({
          cash: +selCash.value,
          fee: (+inpFee.value) / 100,
          startIndex: +selStart.value,
          strategy: mode === 'strategy' ? stId : 'manual',
          strategyName: mode === 'strategy' && st ? st.name : '직접 매매',
          rebalance: +selReb.value,
          topK: +selK.value
        });

        // AI 전략은 먼저 워크포워드 학습이 필요합니다.
        if (mode === 'strategy' && st && st.prepare) {
          btn.disabled = true;
          status.textContent = 'AI를 학습시키는 중… (구간마다 과거만 보고 다시 배웁니다)';
          const rebDates = [];
          for (let i = acc.startIndex; i < DATA.state.dates.length - 1; i += acc.rebalance) rebDates.push(i);
          try {
            await st.prepare(acc.startIndex, DATA.state.dates.length - 1, rebDates,
              { horizon: 21, retrainEvery: 63, trainWindow: 1000 },
              function (f) { status.textContent = 'AI 학습 ' + Math.round(f * 100) + '%'; });
          } catch (e) {
            status.textContent = '학습 실패: ' + e.message;
            btn.disabled = false;
            return;
          }
        }
        if (mode === 'strategy') rebalanceToStrategy();
        record();
        save();
        draw(host);
      });
      return btn;
    }

    p.body.appendChild(U.el('div', 'note',
      '주문은 그날 종가로 체결되고 매수·매도마다 비용을 뗍니다. 공매도와 레버리지는 없습니다. ' +
      '진행 상황은 이 브라우저에 저장되므로 새로고침해도 이어집니다.'));
    host.appendChild(p);
  }

  function accountPanel() {
    const auto = acc.strategy !== 'manual';
    const p = App.panel('계좌' + (auto ? ' <span class="accent">' + U.escape(acc.strategyName) + '</span>' : ''),
      { sub: DATA.state.dates[acc.t] + ' 기준' +
        (auto ? ' · 다음 리밸런싱까지 ' + Math.max(0, acc.rebalance - (acc.t - acc.lastReb)) + '일' : '') });
    const eq = equity(), be = benchEquity(acc.t);
    const ret = eq / acc.initial - 1;
    const bret = isFinite(be) ? be / acc.initial - 1 : NaN;

    const g = U.el('div', 'grid g4');
    // 총자산은 '값'이므로 중립색. 색은 아래 수익률에만 씁니다.
    g.appendChild(App.stat('총자산', '$' + U.comma(eq), '시작 $' + U.comma(acc.initial)));
    const st2 = App.stat('수익률', (ret >= 0 ? '+' : '') + (ret * 100).toFixed(2) + '%',
      '', ret >= 0 ? 'up' : 'down');
    g.appendChild(st2);
    g.appendChild(App.stat('QQQ 대비', isFinite(bret) ? ((ret - bret >= 0 ? '+' : '') + ((ret - bret) * 100).toFixed(2) + '%p') : '—',
      isFinite(bret) ? 'QQQ ' + ((bret >= 0 ? '+' : '') + (bret * 100).toFixed(2) + '%') : '',
      isFinite(bret) ? (ret - bret >= 0 ? 'up' : 'down') : ''));
    g.appendChild(App.stat('현금', '$' + U.comma(acc.cash),
      '주식 비중 ' + (eq > 0 ? ((1 - acc.cash / eq) * 100).toFixed(0) : 0) + '%'));
    p.body.appendChild(g);

    // 진행
    const row = U.el('div', 'row center mt');
    [[1, '+1일'], [5, '+1주'], [21, '+1개월'], [63, '+3개월']].forEach(function (o) {
      const b = U.el('button', 'btn', o[1]);
      b.addEventListener('click', function () { advance(o[0]); draw(U.$('#main')); });
      row.appendChild(b);
    });
    const left = DATA.state.dates.length - 1 - acc.t;
    row.appendChild(U.el('span', 'tiny', '남은 거래일 ' + U.comma(left) + '일'));

    const reset = U.el('button', 'btn sm', '계좌 초기화');
    reset.style.marginLeft = 'auto';
    reset.addEventListener('click', function () {
      if (confirm('지금까지의 거래 기록이 모두 지워집니다. 계속할까요?')) {
        localStorage.removeItem(KEY); acc = null; draw(U.$('#main'));
      }
    });
    row.appendChild(reset);
    p.body.appendChild(row);
    return p;
  }

  function orderPanel(onDone) {
    const p = App.panel('주문', { sub: '그날 종가로 체결' });
    const list = DATA.tradables(acc.t).sort();
    const row = U.el('div', 'row');

    const fT = U.el('div', 'field');
    fT.appendChild(U.el('label', '', '종목'));
    const sel = U.el('select');
    sel.style.minWidth = '150px';
    list.forEach(function (t) {
      const o = U.el('option', '', t + '  ' + DATA.sector(t)); o.value = t; sel.appendChild(o);
    });
    fT.appendChild(sel); row.appendChild(fT);

    const fQ = U.el('div', 'field');
    fQ.appendChild(U.el('label', '', '수량 (주)'));
    const qty = U.el('input'); qty.type = 'number'; qty.min = '1'; qty.step = '1'; qty.value = '10';
    qty.className = 'mono';
    fQ.appendChild(qty); row.appendChild(fQ);

    const info = U.el('div', 'field');
    info.appendChild(U.el('label', '', '예상 금액'));
    const amt = U.el('div', 'mono'); amt.style.paddingTop = '5px';
    info.appendChild(amt); row.appendChild(info);

    function refreshAmt() {
      const p0 = priceOf(sel.value);
      const q = Math.max(0, Math.floor(+qty.value || 0));
      amt.textContent = isFinite(p0) ? '$' + U.comma(q * p0 * (1 + acc.fee)) + '  @ $' + p0.toFixed(2) : '—';
    }
    sel.addEventListener('change', refreshAmt);
    qty.addEventListener('input', refreshAmt);
    refreshAmt();

    const msg = U.el('div', 'tiny');

    const bBuy = U.el('button', 'btn buy', '매수');
    bBuy.addEventListener('click', function () {
      const err = buy(sel.value, Math.floor(+qty.value || 0));
      if (err) { msg.textContent = err; msg.className = 'tiny down'; return; }
      if (acc.strategy !== 'manual') acc.interventions++;   // 전략 계좌에 손댄 횟수
      save(); onDone();
    });
    const bSell = U.el('button', 'btn sell', '매도');
    bSell.addEventListener('click', function () {
      const err = sell(sel.value, Math.floor(+qty.value || 0));
      if (err) { msg.textContent = err; msg.className = 'tiny down'; return; }
      if (acc.strategy !== 'manual') acc.interventions++;
      save(); onDone();
    });
    // 금액 기준 빠른 주문
    const bAll = U.el('button', 'btn sm', '현금의 25%');
    bAll.addEventListener('click', function () {
      const p0 = priceOf(sel.value);
      if (!isFinite(p0)) return;
      qty.value = String(Math.floor((acc.cash * 0.25) / (p0 * (1 + acc.fee))));
      refreshAmt();
    });
    row.appendChild(bBuy); row.appendChild(bSell); row.appendChild(bAll);
    p.body.appendChild(row);
    p.body.appendChild(msg);
    return p;
  }

  function holdingsPanel() {
    const p = App.panel('보유 종목', { tight: true });
    const tickers = Object.keys(acc.positions);
    if (!tickers.length) {
      p.body.appendChild(U.el('div', 'empty', '아직 보유한 종목이 없습니다. 위에서 주문해 보세요.'));
      return p;
    }
    const eq = equity();
    const rows = tickers.map(function (t) {
      const pos = acc.positions[t];
      const px = priceOf(t);
      const val = pos.qty * px;
      const avg = pos.cost / pos.qty;
      const pl = val / pos.cost - 1;
      return {
        cells: [
          U.el('span', 'tick', t),
          U.el('span', 'sector', DATA.sector(t)),
          U.comma(pos.qty),
          avg.toFixed(2),
          px.toFixed(2),
          '$' + U.comma(val),
          App.chg(pl),
          (val / eq * 100).toFixed(1) + '%'
        ]
      };
    });
    p.body.appendChild(App.table(
      ['종목', '섹터', { label: '수량', num: true }, { label: '평단', num: true },
       { label: '현재가', num: true }, { label: '평가액', num: true },
       { label: '손익', num: true }, { label: '비중', num: true }], rows));

    // --- 섹터 집중도 ---
    // 실무에서 반드시 확인하는 항목입니다. 종목을 10개 담아도 전부 같은 섹터면
    // 사실상 한 종목에 몰아넣은 것과 다르지 않습니다.
    const bySector = {};
    tickers.forEach(function (t) {
      const v = acc.positions[t].qty * priceOf(t);
      const sec = DATA.sector(t);
      bySector[sec] = (bySector[sec] || 0) + v;
    });
    const stockValue = Object.keys(bySector).reduce(function (a, k) { return a + bySector[k]; }, 0);
    const secs = Object.keys(bySector).sort(function (a, b) { return bySector[b] - bySector[a]; });

    const box = U.el('div');
    box.style.padding = '12px';
    box.appendChild(U.el('div', 'tiny', '섹터 집중도 — 주식 평가액 기준'));
    secs.forEach(function (sec) {
      const w = bySector[sec] / stockValue;
      const line = U.el('div', 'row center');
      line.style.cssText = 'gap:8px;margin:3px 0';
      const nm = U.el('span', 'tiny'); nm.style.width = '90px'; nm.textContent = sec;
      const bar = App.bar(w, w > 0.4 ? 'neg' : '');
      bar.style.cssText = 'flex:1;max-width:320px';
      const val = U.el('span', 'tiny mono'); val.textContent = (w * 100).toFixed(0) + '%';
      line.appendChild(nm); line.appendChild(bar); line.appendChild(val);
      box.appendChild(line);
    });
    const top = bySector[secs[0]] / stockValue;
    if (top > 0.4) {
      const warn = U.el('div', 'note warn');
      warn.innerHTML = '<b>' + U.escape(secs[0]) + ' 비중이 ' + (top * 100).toFixed(0) + '%입니다.</b> ' +
        '종목을 여러 개 담아도 같은 섹터면 사실상 한 곳에 몰아넣은 것입니다. ' +
        '그 섹터가 무너지면 분산 효과가 없습니다. 실무에서는 섹터별 상한(예: 30%)을 두는 것이 보통입니다.';
      box.appendChild(warn);
    }
    p.body.appendChild(box);
    return p;
  }

  function curvePanel() {
    const p = App.panel('자산 곡선', { sub: '내 계좌 vs QQQ 매수 후 보유' });
    const h = acc.history;
    if (h.length < 2) {
      p.body.appendChild(U.el('div', 'empty', '하루 이상 진행하면 곡선이 그려집니다.'));
      return p;
    }
    const cv = U.el('canvas', 'chart lg');
    p.body.appendChild(cv);
    const series = [
      { name: '내 계좌', values: h.map(function (x) { return x.e; }), color: C.seriesColor(1) },
      { name: 'QQQ 매수보유', values: h.map(function (x) { return x.b; }), color: C.seriesColor(0), dash: [4, 3] }
    ];
    const lg = U.el('div', 'legend');
    series.forEach(function (s) {
      const it = U.el('span', 'legend-item');
      const d = U.el('span', 'legend-dot'); d.style.background = s.color;
      it.appendChild(d); it.appendChild(U.el('span', '', s.name));
      lg.appendChild(it);
    });
    p.body.insertBefore(lg, cv);
    C.line(cv, {
      labels: h.map(function (x) { return x.d.slice(2, 10); }),
      series: series,
      zeroLine: acc.initial,
      yFmt: function (v) { return '$' + U.compact(v); },
      tipFmt: function (v) { return '$' + U.comma(v); }
    });

    // 성과 지표
    const rets = [];
    for (let i = 1; i < h.length; i++) rets.push(h[i].e / h[i - 1].e - 1);
    const perf = M.perf(rets);
    const g = U.el('div', 'grid g4');
    g.style.marginTop = '10px';
    g.appendChild(App.stat('연평균(CAGR)', isFinite(perf.cagr) ? ((perf.cagr >= 0 ? '+' : '') + (perf.cagr * 100).toFixed(1) + '%') : '—'));
    g.appendChild(App.stat('샤프지수', isFinite(perf.sharpe) ? perf.sharpe.toFixed(2) : '—', '위험 대비 수익'));
    g.appendChild(App.stat('최대낙폭', isFinite(perf.mdd) ? (perf.mdd * 100).toFixed(1) + '%' : '—', '고점 대비', 'down'));
    g.appendChild(App.stat('거래 횟수', U.comma(acc.trades.length), '비용 반영됨'));
    p.body.appendChild(g);
    return p;
  }

  function tradesPanel() {
    const p = App.panel('거래 기록', { tight: true });
    if (!acc.trades.length) {
      p.body.appendChild(U.el('div', 'empty', '아직 거래가 없습니다.'));
      return p;
    }
    const rows = acc.trades.slice().reverse().slice(0, 100).map(function (t) {
      const side = U.el('span', t.side === '매수' ? 'up' : 'down', t.side);
      return { cells: [t.d, side, U.el('span', 'tick', t.t), U.comma(t.qty), t.p.toFixed(2), '$' + U.comma(t.amt)] };
    });
    p.body.appendChild(App.table(
      ['날짜', '구분', '종목', { label: '수량', num: true }, { label: '체결가', num: true }, { label: '금액', num: true }],
      rows, { scroll: true }));
    return p;
  }


  /* ------------------------------------------------------------------------
   *  순위표에 올리기
   *  결과만 보내지 않고 거래 기록도 함께 보냅니다. 나중에 재현해서 확인할 수 있도록.
   * ----------------------------------------------------------------------*/
  function submitPanel() {
    const LB = root.LB, CFG = root.CONFIG;
    const p = App.panel('순위표에 올리기');
    const days = acc.history.length;
    const need = (CFG && CFG.minTradingDays) || 60;

    if (!LB || !LB.available) {
      p.body.innerHTML = '<div class="note warn">순위표 설정이 아직 없습니다.</div>';
      return p;
    }
    if (days < need) {
      p.body.innerHTML = '<div class="note">최소 <b>' + need + '거래일</b> 이상 진행해야 올릴 수 있습니다. ' +
        '지금 ' + days + '일 진행했습니다. 짧게 굴린 성적은 대부분 운이기 때문에 막아 두었습니다.</div>';
      return p;
    }
    if (DATA.state.synthetic) {
      p.body.innerHTML = '<div class="note warn">가상 데이터로 굴린 기록은 순위표에 올릴 수 없습니다.</div>';
      return p;
    }

    const row = U.el('div', 'row');
    const fN = U.el('div', 'field');
    fN.appendChild(U.el('label', '', '닉네임 (2~20자)'));
    const nick = U.el('input'); nick.type = 'text'; nick.maxLength = 20;
    nick.value = localStorage.getItem('quantlab.nick') || '';
    fN.appendChild(nick); row.appendChild(fN);

    const fT = U.el('div', 'field');
    fT.appendChild(U.el('label', '', '소속/팀 (선택)'));
    const team = U.el('input'); team.type = 'text'; team.maxLength = 30;
    team.value = localStorage.getItem('quantlab.team') || '';
    fT.appendChild(team); row.appendChild(fT);

    const btn = U.el('button', 'btn primary', '제출');
    row.appendChild(btn);
    p.body.appendChild(row);

    const msg = U.el('div', 'small mt');
    p.body.appendChild(msg);
    p.body.appendChild(U.el('div', 'note',
      '제출하면 거래 기록이 함께 저장되어 나중에 그대로 재현할 수 있습니다. ' +
      '한 번 올린 기록은 수정·삭제할 수 없습니다.'));

    btn.addEventListener('click', function () {
      const name = nick.value.trim();
      if (name.length < 2) { msg.textContent = '닉네임을 2자 이상 입력하세요.'; msg.className = 'small mt down'; return; }
      localStorage.setItem('quantlab.nick', name);
      localStorage.setItem('quantlab.team', team.value.trim());

      const eq = equity(), be = benchEquity(acc.t);
      const ret = eq / acc.initial - 1;
      const bret = isFinite(be) ? be / acc.initial - 1 : null;
      const rets = [];
      for (let i = 1; i < acc.history.length; i++) rets.push(acc.history[i].e / acc.history[i - 1].e - 1);
      const perf = M.perf(rets);

      btn.disabled = true;
      msg.textContent = '보내는 중…'; msg.className = 'small mt';
      LB.submit({
        nickname: name,
        team: team.value.trim() || null,
        strategy: acc.strategy || 'manual',
        strategy_name: acc.strategyName || '직접 매매',
        start_date: DATA.state.dates[acc.startIndex],
        end_date: DATA.state.dates[acc.t],
        trading_days: acc.history.length,
        initial: acc.initial,
        final_value: Math.round(eq),
        ret: +ret.toFixed(6),
        bench_ret: bret === null ? null : +bret.toFixed(6),
        excess: bret === null ? null : +(ret - bret).toFixed(6),
        sharpe: isFinite(perf.sharpe) ? +perf.sharpe.toFixed(4) : null,
        mdd: isFinite(perf.mdd) ? +perf.mdd.toFixed(4) : null,
        trades: acc.trades.length,
        fee: acc.fee,
        data_updated: (DATA.state.meta && DATA.state.meta.updated) || null,
        audit: { trades: acc.trades.slice(0, 500), history: acc.history.filter(function (_, i) { return i % 5 === 0; }) }
      }).then(function () {
        msg.textContent = '올렸습니다. 순위표에서 확인하세요.';
        msg.className = 'small mt up';
      }).catch(function (e) {
        msg.textContent = e.message;
        msg.className = 'small mt down';
        btn.disabled = false;
      });
    });
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    if (!acc) acc = load();
    if (!acc) { setupScreen(host); return; }

    host.appendChild(accountPanel());
    const grid = U.el('div', 'grid g-2-1');
    const leftCol = U.el('div');
    leftCol.appendChild(orderPanel(function () { draw(host); }));
    leftCol.appendChild(holdingsPanel());
    leftCol.appendChild(curvePanel());
    const rightCol = U.el('div');
    rightCol.appendChild(submitPanel());
    rightCol.appendChild(tradesPanel());
    grid.appendChild(leftCol); grid.appendChild(rightCol);
    host.appendChild(grid);
  }

  App.register('trade', { render: draw });
})(window.QL = window.QL || {});
