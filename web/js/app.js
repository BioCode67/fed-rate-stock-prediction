/* ============================================================================
 *  app.js — 화면 연결 (탭, 버튼, 결과 그리기)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, D = root.D, ML = root.ML, M = root.M, C = root.C, B = root.B, S = root.S;
  const $ = U.$, $$ = U.$$;

  const state = {
    data: null, feats: null, supCache: {},
    models: null, bt: null, sim: null, simTimer: null
  };

  /* ==========================================================================
   *  기본 뼈대: 탭 / 테마
   * ========================================================================*/
  function setTab(id) {
    $$('nav.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === id); });
    $$('.panel').forEach(function (p) { p.classList.toggle('on', p.id === 'panel-' + id); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(function () { C.redrawAll(); }, 30);
  }

  function initTheme() {
    const btn = $('#themeBtn');
    const saved = (function () { try { return localStorage.getItem('frsp-theme'); } catch (e) { return null; } })();
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    btn.addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-theme');
      const isDark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('frsp-theme', next); } catch (e) {}
      setTimeout(function () { C.redrawAll(); }, 20);
    });
  }

  function status(sel, msg) { const e = $(sel); if (e) e.textContent = msg || ''; }
  function progress(sel, frac) {
    const box = $(sel);
    if (!box) return;
    if (frac === null) { box.classList.remove('on'); return; }
    box.classList.add('on');
    box.firstElementChild.style.width = Math.round(U.clamp(frac, 0, 1) * 100) + '%';
  }

  /* ==========================================================================
   *  데이터
   * ========================================================================*/
  function setData(data) {
    state.data = data;
    state.feats = D.makeFeatures(data);
    state.supCache = {};
    state.models = null; state.bt = null;
    if (state.sim) { stopAuto(); state.sim = null; $('#simBoard').classList.add('hidden'); }
    $('#modelResult').classList.add('hidden');
    $('#abResult').classList.add('hidden');
    $('#btResult').classList.add('hidden');
    $('#volResult').classList.add('hidden');

    const badge = $('#dataBadge');
    badge.classList.toggle('demo', !!data.meta.synthetic);
    badge.classList.toggle('real', !data.meta.synthetic);
    $('#dataBadgeText').textContent = data.meta.name + (data.meta.synthetic ? ' · 가상' : '') +
      ' · ' + data.close.length.toLocaleString('ko-KR') + '일';
    renderDataTab();
  }

  function featureCols() {
    let cols = D.BASE_FEATURES.slice();
    if ($('#mRate').checked && state.data.rate) cols = cols.concat(D.RATE_FEATURES);
    if ($('#mExtra').checked) cols = cols.concat(D.EXTRA_FEATURES);
    return cols;
  }

  function getSup(horizon, cols) {
    const key = horizon + '|' + cols.join(',');
    if (!state.supCache[key]) state.supCache[key] = D.buildSupervised(state.data, state.feats, cols, horizon);
    return state.supCache[key];
  }

  function dateLabels(dates) {
    return dates.map(function (d) { return U.dstr(d).slice(2, 7); });
  }

  function renderDataTab() {
    const d = state.data;
    $('#dataResult').classList.remove('hidden');

    const ret = state.feats['return'];
    const clean = [];
    for (let i = 1; i < ret.length; i++) if (isFinite(ret[i])) clean.push(ret[i]);
    let ups = 0;
    for (let i = 0; i < clean.length; i++) if (clean[i] > 0) ups++;
    const years = clean.length / M.TRADING_DAYS;
    const totalRet = d.close[d.close.length - 1] / d.close[0] - 1;
    const cagr = years > 0 ? Math.pow(1 + totalRet, 1 / years) - 1 : NaN;
    const vol = U.std(clean) * Math.sqrt(M.TRADING_DAYS);

    const tiles = [
      ['기간', U.dstr(d.dates[0]) + ' ~', U.dstr(d.dates[d.dates.length - 1])],
      ['표본 수', d.close.length.toLocaleString('ko-KR') + '일', '거래일 기준'],
      ['상승일 비율', U.pct(ups / clean.length, 1), '기준선의 출발점'],
      ['연평균 수익률', U.signPct(cagr, 1), '연변동성 ' + U.pct(vol, 1)]
    ];
    const box = $('#dataTiles');
    box.innerHTML = '';
    tiles.forEach(function (t) {
      const el = U.el('div', 'tile');
      el.appendChild(U.el('div', 'label', t[0]));
      el.appendChild(U.el('div', 'value', t[1]));
      el.appendChild(U.el('div', 'sub', t[2]));
      box.appendChild(el);
    });

    if (d.meta.note) {
      const n = U.el('div', 'note' + (d.meta.synthetic ? ' warn' : ''));
      n.innerHTML = '<strong>' + (d.meta.synthetic ? '가상 데이터입니다. ' : '') + '</strong>' + d.meta.note;
      box.parentNode.insertBefore(n, box.nextSibling);
    }

    const labels = dateLabels(d.dates);
    $('#priceTitle').textContent = d.meta.priceLabel + (d.meta.synthetic ? ' (가상)' : '');
    C.line($('#chartPrice'), {
      labels: labels,
      series: [{ name: d.meta.priceLabel, values: Array.from(d.close), color: C.seriesColor(0), area: true }],
      yFmt: function (v) { return U.compact(v); }
    });

    if (d.rate) {
      $('#rateCard').classList.remove('hidden');
      $('#rateTitle').textContent = d.meta.rateLabel + (d.meta.synthetic ? ' (가상)' : '');
      C.line($('#chartRate'), {
        labels: labels,
        series: [{ name: d.meta.rateLabel, values: Array.from(d.rate), color: C.seriesColor(1) }],
        yFmt: function (v) { return U.fmt(v, 2) + '%'; }
      });
    } else {
      $('#rateCard').classList.add('hidden');
    }

    // 특징 미리보기 (마지막 6일)
    const cols = D.BASE_FEATURES.concat(d.rate ? D.RATE_FEATURES : []);
    const head = ['날짜', '종가'].concat(cols.map(function (c) { return D.FEATURE_SHORT[c] || c; }));
    const rows = [];
    for (let i = Math.max(0, d.close.length - 6); i < d.close.length; i++) {
      const r = [U.dstr(d.dates[i]), U.comma(d.close[i])];
      cols.forEach(function (c) {
        const v = state.feats[c] ? state.feats[c][i] : NaN;
        r.push(isFinite(v) ? (Math.abs(v) < 0.01 ? U.fmt(v, 4) : U.fmt(v, 3)) : '—');
      });
      rows.push(r);
    }
    const fp = $('#featPreview'); fp.innerHTML = '';
    fp.appendChild(U.table(head, rows));
    const legend = U.el('p', 'tiny', cols.map(function (c) {
      return (D.FEATURE_SHORT[c] || c) + ' = ' + D.FEATURE_LABEL[c];
    }).join(' · '));
    fp.appendChild(legend);
  }

  /* ==========================================================================
   *  모델 비교
   * ========================================================================*/
  function selectedModels() {
    return $$('#modelChips input:checked').map(function (i) { return i.value; });
  }

  async function runModels(quiet) {
    const ids = selectedModels();
    if (!ids.length) { status('#modelStatus', '모델을 하나 이상 선택하세요.'); return; }
    const horizon = +$('#mHorizon').value;
    const cols = featureCols();
    const sup = getSup(horizon, cols);
    const useWalk = $('#mValidation').value === 'walk';
    const opt = {
      trainRatio: +$('#mRatio').value,
      threshold: +$('#mThreshold').value,
      modelOpt: { classWeight: $('#mWeight').checked, seed: 42 }
    };

    $('#runModels').disabled = true;
    const results = [];
    for (let k = 0; k < ids.length; k++) {
      status('#modelStatus', '학습 중… (' + (k + 1) + '/' + ids.length + ') ' + ML.modelName(ids[k]));
      progress('#modelProg', k / ids.length);
      await U.yield_();
      try {
        let r;
        if (useWalk) {
          r = await B.walkForward(sup, ids[k], Object.assign({ startFrac: opt.trainRatio, step: 100 }, opt));
          r.split = r.start;
          r.yTest = sup.y.slice(r.start, sup.n);
          r.probaTest = r.proba.slice(r.start, sup.n);
        } else {
          r = B.holdout(sup, ids[k], opt);
          r.probaTest = r.proba;
        }
        r.name = ML.modelName(ids[k]);
        results.push(r);
      } catch (e) {
        status('#modelStatus', ids[k] + ' 학습 실패: ' + e.message);
      }
    }
    progress('#modelProg', null);
    $('#runModels').disabled = false;
    status('#modelStatus', '완료. 시험 구간 ' + (sup.n - Math.floor(sup.n * opt.trainRatio)).toLocaleString('ko-KR') +
      '일 · 예측 시계 ' + horizon + '일 · 특징 ' + cols.length + '개' + (useWalk ? ' · 워크포워드' : ' · 시간순 분할'));

    state.models = { results: results, sup: sup, horizon: horizon, cols: cols, opt: opt, walk: useWalk };
    renderModels();
    if (!quiet) setTab('models');
  }

  function renderModels() {
    const st = state.models;
    if (!st) return;
    $('#modelResult').classList.remove('hidden');
    const rs = st.results.slice().sort(function (a, b) {
      const A = isFinite(a.metrics.auc) ? a.metrics.auc : 0, Bv = isFinite(b.metrics.auc) ? b.metrics.auc : 0;
      return Bv - A;
    });

    // --- 성적표 ---
    const head = ['모델', '정확도', '기준선', '차이', 'AUC', '정밀도', '재현율', 'F1', 'MCC', '상승예측비율', 'p값(vs기준선)'];
    const rows = rs.map(function (r) {
      const m = r.metrics;
      const row = [
        r.name + (ML.isRule(r.modelId) ? ' <span class="tiny">(기준선)</span>' : ''),
        U.fmt(m.acc, 3), U.fmt(m.baseline, 3),
        '<span class="' + (m.edge > 0 ? 'up' : 'down') + '">' + (m.edge >= 0 ? '+' : '') + U.fmt(m.edge, 3) + '</span>',
        isFinite(m.auc) ? U.fmt(m.auc, 3) : '—',
        U.fmt(m.precision, 3), U.fmt(m.recall, 3), U.fmt(m.f1, 3), U.fmt(m.mcc, 3),
        U.fmt(m.upRate, 3), isFinite(m.pVsBaseline) ? U.fmt(m.pVsBaseline, 4) : '—'
      ];
      if (r === rs[0]) row.__cls = 'best';
      return row;
    });
    const tw = $('#modelTable'); tw.innerHTML = '';
    tw.appendChild(U.table(head, rows));

    // --- 경고 ---
    // 기준선 모델(항상 상승·무작위·모멘텀)은 원래 그렇게 동작하도록 만든 비교 대상이므로
    // 경고를 붙이지 않습니다. AI 모델의 경고만 보여야 신호가 묻히지 않습니다.
    const wbox = $('#modelWarnings'); wbox.innerHTML = '';
    const seen = {};
    rs.forEach(function (r) {
      if (ML.isRule(r.modelId)) return;
      r.metrics.warnings.forEach(function (w) {
        const key = r.name + w;
        if (seen[key]) return; seen[key] = 1;
        const n = U.el('div', 'note warn');
        n.innerHTML = '<strong>' + r.name + ':</strong> ' + w;
        wbox.appendChild(n);
      });
    });

    // --- AUC 막대 ---
    C.bars($('#chartAuc'), {
      items: rs.filter(function (r) { return isFinite(r.metrics.auc); }).map(function (r, i) {
        return { label: r.name, value: r.metrics.auc, color: ML.isRule(r.modelId) ? C.mutedColor() : C.seriesColor(i) };
      }),
      baseValue: 0.5, xMin: 0.42, xMax: 0.58,
      vFmt: function (v) { return U.fmt(v, 3); }
    });

    // --- ROC (상위 4개) ---
    const top = rs.filter(function (r) { return r.roc && isFinite(r.metrics.auc); }).slice(0, 4);
    C.roc($('#chartRoc'), top.map(function (r, i) { return { points: r.roc, color: C.seriesColor(i) }; }));
    const rl = $('#rocLegend'); rl.innerHTML = '';
    rl.appendChild(C.legend(top.map(function (r, i) { return { name: r.name + ' (AUC ' + U.fmt(r.metrics.auc, 3) + ')', color: C.seriesColor(i) }; })));

    // --- 혼동행렬 선택 ---
    const sel = $('#cmModel');
    const prev = sel.value;
    sel.innerHTML = '';
    rs.forEach(function (r) {
      const o = U.el('option', '', r.name); o.value = r.modelId; sel.appendChild(o);
    });
    if (prev && rs.some(function (r) { return r.modelId === prev; })) sel.value = prev;
    renderConfusion();
    sel.onchange = renderConfusion;

    // --- 해석 ---
    renderModelReading(rs);
  }

  function renderConfusion() {
    const st = state.models;
    const id = $('#cmModel').value;
    let r = null;
    st.results.forEach(function (x) { if (x.modelId === id) r = x; });
    if (!r) return;
    const m = r.metrics;
    const cm = $('#confMatrix');
    cm.innerHTML = '';
    const cell = function (v, label, hit) {
      const d = U.el('div', 'cell' + (hit ? ' hit' : ''));
      d.innerHTML = '<b>' + v.toLocaleString('ko-KR') + '</b><span>' + label + '</span>';
      return d;
    };
    cm.appendChild(U.el('div', 'h', ''));
    cm.appendChild(U.el('div', 'h', '예측: 상승'));
    cm.appendChild(U.el('div', 'h', '예측: 하락'));
    cm.appendChild(U.el('div', 'h', '실제 상승'));
    cm.appendChild(cell(m.tp, '맞힘', true));
    cm.appendChild(cell(m.fn, '놓침', false));
    cm.appendChild(U.el('div', 'h', '실제 하락'));
    cm.appendChild(cell(m.fp, '헛짚음', false));
    cm.appendChild(cell(m.tn, '맞힘', true));

    // 변수 중요도
    const imp = r.importance;
    const cols = st.cols;
    if (imp && imp.length === cols.length) {
      const items = cols.map(function (c, i) { return { label: D.FEATURE_LABEL[c] || c, value: imp[i] }; })
        .sort(function (a, b) { return b.value - a.value; })
        .map(function (it, i) { return { label: it.label, value: it.value, color: C.seriesColor(0) }; });
      $('#impNote').textContent = '모델이 어떤 값을 많이 참고했는지. 합이 1이 되도록 맞춘 상대값입니다.';
      C.bars($('#chartImp'), { items: items, xMin: 0, vFmt: function (v) { return U.pct(v, 1); }, padL: 190 });
    } else {
      const cv = $('#chartImp'), ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      cv.__redraw = null;
      $('#impNote').textContent = ML.isRule(id)
        ? '기준선 모델은 변수를 쓰지 않으므로 중요도가 없습니다.'
        : '워크포워드는 구간마다 모델을 새로 학습하므로 하나의 중요도를 보여주지 않습니다. 시간순 분할로 확인하세요.';
    }
  }

  function renderModelReading(rs) {
    const st = state.models;
    const ai = rs.filter(function (r) { return !ML.isRule(r.modelId); });
    const best = ai[0] || rs[0];
    const box = $('#modelReading');
    if (!best) { box.innerHTML = ''; return; }
    const m = best.metrics;
    let verdict, cls;
    if (isFinite(m.auc) && m.auc >= 0.55 && m.edge > 0) {
      verdict = '이 설정에서는 <strong>약한 예측력이 보입니다</strong>. 다만 백테스트에서 거래비용을 물려도 남는지 확인해야 합니다.';
      cls = 'ok';
    } else if (isFinite(m.auc) && m.auc >= 0.52) {
      verdict = '판별력이 <strong>아주 약하게</strong> 있습니다. 우연일 수 있으니 예측 시계·기간을 바꿔가며 반복해 보세요.';
      cls = '';
    } else {
      verdict = '이 설정에서는 <strong>예측력이 사실상 없습니다</strong>. 실패가 아니라 효율적 시장 가설과 어울리는 정직한 결과입니다.';
      cls = 'warn';
    }
    const alwaysUp = rs.filter(function (r) { return r.modelId === 'alwaysup'; })[0];
    let cmp = '';
    if (alwaysUp) {
      cmp = ' 참고로 "항상 상승"만 찍는 기준선의 정확도는 ' + U.fmt(alwaysUp.metrics.acc, 3) +
        '입니다. 모델이 이 숫자를 넘지 못하면 의미가 없습니다.';
    }
    box.innerHTML =
      '<h3>이 결과는 이렇게 읽습니다</h3>' +
      '<div class="note ' + cls + '">가장 좋은 모델은 <strong>' + best.name + '</strong>이고 AUC ' + U.fmt(m.auc, 3) +
      ', 정확도 ' + U.fmt(m.acc, 3) + ' (기준선 ' + U.fmt(m.baseline, 3) + ', 차이 ' + (m.edge >= 0 ? '+' : '') + U.fmt(m.edge, 3) + ')입니다. ' +
      verdict + cmp + '</div>' +
      '<p class="small">시험 구간 ' + m.n.toLocaleString('ko-KR') + '일 · 예측 시계 ' + st.horizon + '일 · 특징 ' +
      st.cols.length + '개 · ' + (st.walk ? '워크포워드' : '시간순 분할') + ' · 문턱값 ' + U.fmt(st.opt.threshold, 2) + '</p>' +
      '<p class="small">다음으로 해볼 것: 예측 시계를 바꿔 보기, 금리 특징을 빼 보기(H2), 그리고 <strong>3. 백테스트</strong>에서 거래비용을 물려 보기.</p>';
  }

  // 금리 특징 A/B (가설 H2)
  async function runRateAB() {
    if (!state.data.rate) { status('#modelStatus', '이 데이터에는 금리가 없어 비교할 수 없습니다.'); return; }
    const horizon = +$('#mHorizon').value;
    const opt = { trainRatio: +$('#mRatio').value, threshold: +$('#mThreshold').value, modelOpt: { classWeight: $('#mWeight').checked, seed: 42 } };
    const ids = selectedModels().filter(function (i) { return !ML.isRule(i); });
    if (!ids.length) ids.push('boosting');
    const extra = $('#mExtra').checked ? D.EXTRA_FEATURES : [];
    const withRate = D.BASE_FEATURES.concat(D.RATE_FEATURES).concat(extra);
    const without = D.BASE_FEATURES.concat(extra);

    $('#runRateAB').disabled = true;
    const rows = [];
    for (let k = 0; k < ids.length; k++) {
      status('#modelStatus', '금리 A/B 비교 중… ' + ML.modelName(ids[k]));
      progress('#modelProg', k / ids.length);
      await U.yield_();
      const a = B.holdout(getSup(horizon, withRate), ids[k], opt);
      await U.yield_();
      const b = B.holdout(getSup(horizon, without), ids[k], opt);
      const dAuc = a.metrics.auc - b.metrics.auc;
      rows.push([
        ML.modelName(ids[k]),
        U.fmt(b.metrics.acc, 3), U.fmt(b.metrics.auc, 3),
        U.fmt(a.metrics.acc, 3), U.fmt(a.metrics.auc, 3),
        '<span class="' + (dAuc > 0 ? 'up' : 'down') + '">' + (dAuc >= 0 ? '+' : '') + U.fmt(dAuc, 3) + '</span>'
      ]);
    }
    progress('#modelProg', null);
    $('#runRateAB').disabled = false;
    status('#modelStatus', '금리 A/B 비교 완료.');
    const tw = $('#abTable'); tw.innerHTML = '';
    tw.appendChild(U.table(['모델', '금리 없이 정확도', '금리 없이 AUC', '금리 넣고 정확도', '금리 넣고 AUC', 'AUC 변화'], rows));
    $('#abResult').classList.remove('hidden');
    const big = rows.filter(function (r) { return parseFloat(String(r[5]).replace(/<[^>]+>/g, '')) > 0.02; }).length;
    const note = U.el('div', 'note' + (big ? '' : ' warn'));
    note.innerHTML = big
      ? '금리를 넣었을 때 AUC가 뚜렷이(0.02 이상) 오른 모델이 ' + big + '개 있습니다. H2가 반박되는 쪽입니다. 다른 기간에서도 같은지 꼭 확인하세요.'
      : '금리를 넣어도 AUC가 뚜렷이 오르지 않았습니다. 가설 H2(금리를 넣어도 크게 나아지지 않는다)와 어울리는 결과입니다.';
    tw.appendChild(note);
  }

  /* ==========================================================================
   *  백테스트
   * ========================================================================*/
  async function runBacktest() {
    const modelId = $('#bModel').value;
    const horizon = +$('#bHorizon').value;
    const cols = featureCols();
    const sup = getSup(horizon, cols);
    const opt = {
      startFrac: +$('#bStart').value,
      step: +$('#bStep').value,
      threshold: +$('#bThreshold').value,
      modelOpt: { classWeight: $('#mWeight').checked, seed: 42 },
      onProgress: function (f, k, total) {
        progress('#btProg', f);
        status('#btStatus', '워크포워드 재학습 ' + k + '/' + total + '회…');
      }
    };
    $('#runBacktest').disabled = true;
    status('#btStatus', '준비 중…');
    await U.yield_();
    const wf = await B.walkForward(sup, modelId, opt);
    const bt = B.backtest(sup, wf.proba, wf.start, {
      costPerSide: (+$('#bCost').value) / 100,
      slippage: (+$('#bSlip').value) / 100,
      threshold: opt.threshold
    });
    progress('#btProg', null);
    $('#runBacktest').disabled = false;
    status('#btStatus', '완료. 재학습 ' + wf.retrains + '회 · 검증일 ' + bt.dates.length.toLocaleString('ko-KR') + '일 · ' +
      (wf.elapsedMs / 1000).toFixed(1) + '초');
    state.bt = { wf: wf, bt: bt, sup: sup, modelId: modelId, horizon: horizon };
    renderBacktest();
    setTab('backtest');
  }

  function renderBacktest() {
    const st = state.bt;
    if (!st) return;
    const bt = st.bt, wf = st.wf;
    $('#btResult').classList.remove('hidden');

    const diff = bt.perfStrat.total - bt.perfBH.total;
    const tiles = [
      ['전략 누적수익 (비용 후)', U.signPct(bt.perfStrat.total, 1), '샤프 ' + U.fmt(bt.perfStrat.sharpe, 2)],
      ['매수 후 보유', U.signPct(bt.perfBH.total, 1), '샤프 ' + U.fmt(bt.perfBH.sharpe, 2)],
      ['차이', U.signPct(diff, 1), diff > 0 ? '전략이 앞섬' : '전략이 뒤짐'],
      ['거래 / 총비용', U.comma(bt.nTrades) + '회', '누적 비용 ' + U.pct(bt.totalCost, 1) + ' · 보유비중 ' + U.pct(bt.exposure, 0)]
    ];
    const box = $('#btTiles'); box.innerHTML = '';
    tiles.forEach(function (t, i) {
      const el = U.el('div', 'tile');
      el.appendChild(U.el('div', 'label', t[0]));
      const v = U.el('div', 'value', t[1]);
      if (i === 2) v.className += diff > 0 ? ' up' : ' down';
      el.appendChild(v);
      el.appendChild(U.el('div', 'sub', t[2]));
      box.appendChild(el);
    });

    const labels = dateLabels(bt.dates);
    const series = [
      { name: '전략 (비용 후)', values: Array.from(bt.perfStrat.cum), color: C.seriesColor(0) },
      { name: '매수 후 보유', values: Array.from(bt.perfBH.cum), color: C.seriesColor(1) },
      { name: '전략 (비용 전)', values: Array.from(bt.perfGross.cum), color: C.seriesColor(2), dash: [5, 4] }
    ];
    C.line($('#chartEquity'), {
      labels: labels, series: series, zeroLine: 1,
      yFmt: function (v) { return U.fmt(v, 2) + '배'; }
    });
    const lg = $('#btLegend'); lg.innerHTML = '';
    lg.appendChild(C.legend(series.map(function (s) { return { name: s.name, color: s.color }; })));

    const rows = [
      ['전략 (비용 후)', U.signPct(bt.perfStrat.total, 1), U.signPct(bt.perfStrat.cagr, 1), U.fmt(bt.perfStrat.sharpe, 2), U.pct(bt.perfStrat.mdd, 1), U.comma(bt.nTrades)],
      ['전략 (비용 전)', U.signPct(bt.perfGross.total, 1), U.signPct(bt.perfGross.cagr, 1), U.fmt(bt.perfGross.sharpe, 2), U.pct(bt.perfGross.mdd, 1), U.comma(bt.nTrades)],
      ['매수 후 보유', U.signPct(bt.perfBH.total, 1), U.signPct(bt.perfBH.cagr, 1), U.fmt(bt.perfBH.sharpe, 2), U.pct(bt.perfBH.mdd, 1), '1']
    ];
    const tw = $('#btTable'); tw.innerHTML = '';
    tw.appendChild(U.table(['구분', '누적수익', '연평균(CAGR)', '샤프지수', '최대낙폭(MDD)', '거래 횟수'], rows));

    // 비용 민감도
    const levels = [0, 0.0005, 0.001, 0.002, 0.003, 0.005];
    const sweep = B.costSweep(st.sup, wf.proba, wf.start, levels, { threshold: (+$('#bThreshold').value) });
    C.bars($('#chartCost'), {
      items: sweep.map(function (s) {
        return {
          label: '왕복 ' + (s.level * 100).toFixed(2) + '%',
          value: s.strat,
          color: s.strat >= bt.perfBH.total ? C.seriesColor(0) : C.mutedColor()
        };
      }),
      baseValue: 0, vFmt: function (v) { return U.signPct(v, 0); }, padL: 100
    });

    const win = diff > 0;
    $('#btReading').innerHTML =
      '<h3>이 결과는 이렇게 읽습니다</h3>' +
      '<div class="note ' + (win ? 'ok' : 'warn') + '">' +
      '모델 <strong>' + ML.modelName(st.modelId) + '</strong>로 ' + wf.retrains + '번 재학습하며 굴린 결과, 비용 후 누적수익은 ' +
      U.signPct(bt.perfStrat.total, 1) + '이고 매수 후 보유는 ' + U.signPct(bt.perfBH.total, 1) + '입니다. ' +
      (win ? '이 구간에서는 전략이 앞섰습니다. 다만 기간을 바꾸면 쉽게 뒤집히므로 여러 구간에서 확인해야 합니다.'
           : '전략이 매수 후 보유를 이기지 못했습니다. 가설 H4와 어울리는, 흔하고 정직한 결과입니다.') +
      ' 거래비용으로만 누적 ' + U.pct(bt.totalCost, 1) + '를 지불했습니다.</div>' +
      '<p class="small">워크포워드 검증 구간 정확도 ' + U.fmt(wf.metrics.acc, 3) + ' (기준선 ' + U.fmt(wf.metrics.baseline, 3) +
      '), AUC ' + U.fmt(wf.metrics.auc, 3) + ' · 시장에 들어가 있던 시간 비중 ' + U.pct(bt.exposure, 0) + '</p>' +
      (st.horizon !== 1 ? '<p class="small">예측 시계가 ' + st.horizon + '일인데 포지션은 매일 조정합니다. 신호와 보유 기간이 어긋나므로 해석에 주의하세요.</p>' : '');
  }

  /* ==========================================================================
   *  모의투자
   * ========================================================================*/
  function stopAuto() {
    if (state.simTimer) { clearInterval(state.simTimer); state.simTimer = null; }
  }

  async function startSim() {
    const modelId = $('#sModel').value;
    const cols = featureCols();
    const sup = getSup(1, cols);
    $('#startSim').disabled = true;
    status('#simStatus', 'AI를 학습시키는 중… (미래를 보지 않도록 구간마다 다시 학습합니다)');
    await U.yield_();
    const wf = await B.walkForward(sup, modelId, {
      startFrac: 0.6, step: 100, threshold: +$('#sThreshold').value,
      modelOpt: { classWeight: $('#mWeight').checked, seed: 42 },
      onProgress: function (f, k, total) { progress('#simProg', f); status('#simStatus', '학습 ' + k + '/' + total + '…'); }
    });
    progress('#simProg', null);
    $('#startSim').disabled = false;

    state.sim = S.create({
      sup: sup, proba: wf.proba, start: wf.start,
      cash: +$('#sCash').value, feeRate: (+$('#sFee').value) / 100,
      threshold: +$('#sThreshold').value
    });
    state.sim.modelName = ML.modelName(modelId);
    status('#simStatus', '준비 완료. ' + U.dstr(sup.dates[wf.start]) + '부터 ' +
      U.dstr(sup.dates[sup.n - 1]) + '까지 ' + (sup.n - wf.start).toLocaleString('ko-KR') + '거래일을 진행합니다.');
    $('#simBoard').classList.remove('hidden');
    renderSim();
    setTab('sim');
  }

  function renderSim() {
    const sim = state.sim;
    if (!sim) return;
    const px = S.price(sim), h = sim.hist;
    const total = sim.user.value(px);
    const prevPx = sim.t > 0 ? sim.sup.close[sim.t - 1] : px;

    $('#simEquity').textContent = U.won(total);
    const pl = total / sim.initial - 1;
    const sub = $('#simEquitySub');
    sub.textContent = '시작 ' + U.won(sim.initial) + ' 대비 ' + U.signPct(pl, 2);
    sub.className = 'sub ' + (pl >= 0 ? 'up' : 'down');

    $('#simDate').textContent = U.dstr(S.date(sim));
    $('#simPrice').textContent = U.comma(px);
    const chg = px / prevPx - 1;
    const ce = $('#simChange');
    ce.textContent = '전일 대비 ' + U.signPct(chg, 2);
    ce.className = 'sub tiny ' + (chg >= 0 ? 'up' : 'down');

    const w = sim.user.weight(px);
    $('#simWeightBar').style.width = Math.round(w * 100) + '%';
    $('#simWeightText').textContent = '주식 ' + U.pct(w, 0) + ' · 현금 ' + U.won(sim.user.cash);

    const p = S.aiProbaNow(sim);
    $('#simProba').textContent = isFinite(p) ? U.pct(p, 1) : '—';
    $('#simProbaBar').style.width = (isFinite(p) ? Math.round(p * 100) : 50) + '%';
    $('#simProbaBar').style.background = isFinite(p) && p >= sim.threshold ? 'var(--series-1)' : 'var(--text-muted)';
    $('#simSignal').textContent = isFinite(p)
      ? (p >= sim.threshold ? sim.modelName + ': 내일 보유 권장' : sim.modelName + ': 내일 현금 권장')
      : '예측 없음';

    const left = sim.sup.n - 1 - sim.t;
    $('#simProgressText').textContent = '남은 거래일 ' + left.toLocaleString('ko-KR') + '일 · 진행 ' +
      (h.dates.length).toLocaleString('ko-KR') + '일 · 내 거래 ' + sim.user.trades + '회 (비용 ' + U.won(sim.user.costPaid) + ')';
    $$('[data-step]').forEach(function (b) { b.disabled = S.done(sim); });
    $$('[data-act]').forEach(function (b) { b.disabled = S.done(sim); });

    // 자산 곡선
    const labels = dateLabels(h.dates);
    const series = [
      { name: '내 계좌', values: h.user, color: C.seriesColor(0) },
      { name: 'AI 자동매매', values: h.ai, color: C.seriesColor(1) },
      { name: '사서 들고 있기', values: h.bh, color: C.seriesColor(2), dash: [5, 4] }
    ];
    C.line($('#chartSim'), {
      labels: labels, series: series, zeroLine: sim.initial,
      yFmt: function (v) { return U.compact(v); },
      tipFmt: function (v) { return U.won(v); }
    });
    const lg = $('#simLegend'); lg.innerHTML = '';
    lg.appendChild(C.legend(series.map(function (s) { return { name: s.name, color: s.color }; })));

    C.line($('#chartSimPrice'), {
      labels: labels,
      series: [{ name: '가격', values: h.price, color: C.seriesColor(0), area: true }],
      yFmt: function (v) { return U.compact(v); }
    });

    // 성적표
    const sm = S.summary(sim);
    const rows = sm.map(function (s) {
      const row = [s.name, U.won(s.final),
        '<span class="' + (s.total >= 0 ? 'up' : 'down') + '">' + U.signPct(s.total, 2) + '</span>',
        U.signPct(s.cagr, 1), U.fmt(s.sharpe, 2), U.pct(s.mdd, 1), U.comma(s.trades)];
      return row;
    });
    const tw = $('#simTable'); tw.innerHTML = '';
    tw.appendChild(U.table(['구분', '평가금액', '누적수익', '연평균', '샤프', '최대낙폭', '거래'], rows));

    // 거래 기록
    const lw = $('#simLog');
    if (!sim.log.length) { lw.innerHTML = '<p class="small">아직 거래가 없습니다. 위 버튼으로 사고팔아 보세요.</p>'; }
    else {
      lw.innerHTML = '';
      const lr = sim.log.slice().reverse().map(function (t) {
        return [U.dstr(t.date), t.type, U.comma(t.price), U.fmt(Math.abs(t.qty), 2) + '주', U.won(t.value)];
      });
      lw.appendChild(U.table(['날짜', '구분', '체결가', '수량', '거래 후 총자산'], lr));
    }

    if (S.done(sim)) {
      stopAuto();
      const my = sm[0], ai = sm[1], bh = sm[2];
      const best = [my, ai, bh].slice().sort(function (a, b) { return b.total - a.total; })[0];
      status('#simStatus', '끝까지 진행했습니다. 1위는 ' + best.name + ' (' + U.signPct(best.total, 2) + ') 입니다. ' +
        '내 계좌 ' + U.signPct(my.total, 2) + ' / AI ' + U.signPct(ai.total, 2) + ' / 매수보유 ' + U.signPct(bh.total, 2));
    }
  }

  function bindSim() {
    $$('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        const sim = state.sim; if (!sim) return;
        const a = b.dataset.act;
        if (a === 'buy1') S.buy(sim, 1);
        else if (a === 'buy05') S.buy(sim, 0.5);
        else if (a === 'sell05') S.sell(sim, 0.5);
        else if (a === 'sell1') S.sell(sim, 1);
        renderSim();
      });
    });
    $$('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        const sim = state.sim; if (!sim) return;
        const follow = $('#simFollow').checked;
        const s = b.dataset.step;
        stopAuto();
        if (s === 'end') {
          // 한 번에 다 돌리면 화면이 멈추므로 조금씩 나눠 진행
          state.simTimer = setInterval(function () {
            const moved = S.stepMany(sim, 60, follow);
            renderSim();
            if (!moved || S.done(sim)) stopAuto();
          }, 16);
        } else {
          S.stepMany(sim, +s, follow);
          renderSim();
        }
      });
    });
  }

  /* ==========================================================================
   *  변동성 (Phase 1-c)
   * ========================================================================*/
  // 미국 FOMC 정책 발표일 (federalreserve.gov 원문 기준, 2015~2024) — phase1c와 동일
  const FOMC_DATES = ('2015-01-28,2015-03-18,2015-04-29,2015-06-17,2015-07-29,2015-09-17,2015-10-28,2015-12-16,' +
    '2016-01-27,2016-03-16,2016-04-27,2016-06-15,2016-07-27,2016-09-21,2016-11-02,2016-12-14,' +
    '2017-02-01,2017-03-15,2017-05-03,2017-06-14,2017-07-26,2017-09-20,2017-11-01,2017-12-13,' +
    '2018-01-31,2018-03-21,2018-05-02,2018-06-13,2018-08-01,2018-09-26,2018-11-08,2018-12-19,' +
    '2019-01-30,2019-03-20,2019-05-01,2019-06-19,2019-07-31,2019-09-18,2019-10-30,2019-12-11,' +
    '2020-01-29,2020-03-03,2020-03-16,2020-04-29,2020-06-10,2020-07-29,2020-09-16,2020-11-05,2020-12-16,' +
    '2021-01-27,2021-03-17,2021-04-28,2021-06-16,2021-07-28,2021-09-22,2021-11-03,2021-12-15,' +
    '2022-01-26,2022-03-16,2022-05-04,2022-06-15,2022-07-27,2022-09-21,2022-11-02,2022-12-14,' +
    '2023-02-01,2023-03-22,2023-05-03,2023-06-14,2023-07-26,2023-09-20,2023-11-01,2023-12-13,' +
    '2024-01-31,2024-03-20,2024-05-01,2024-06-12,2024-07-31,2024-09-18,2024-11-07,2024-12-18').split(',');

  function eventMask(data, nextDay) {
    const n = data.close.length;
    const mask = new Uint8Array(n);
    let label = '';
    if (data.isPolicyDay) {                        // 데모 데이터는 발표일을 직접 알고 있음
      for (let i = 0; i < n; i++) if (data.isPolicyDay[i]) { mask[i] = 1; if (nextDay && i + 1 < n) mask[i + 1] = 1; }
      label = '가상 정책 발표일';
    } else {
      const set = {};
      FOMC_DATES.forEach(function (d) { set[d] = 1; });
      for (let i = 0; i < n; i++) {
        if (set[U.dstr(data.dates[i])]) { mask[i] = 1; if (nextDay && i + 1 < n) mask[i + 1] = 1; }
      }
      label = 'FOMC 발표일';
    }
    return { mask: mask, label: label };
  }

  function runVol() {
    const d = state.data;
    const retAll = state.feats['return'];
    const idx = [];
    for (let i = 1; i < retAll.length; i++) if (isFinite(retAll[i])) idx.push(i);
    const ret = Float64Array.from(idx.map(function (i) { return retAll[i]; }));
    if (ret.length < 200) { status('#volStatus', '표본이 너무 적습니다.'); return; }

    status('#volStatus', 'GARCH(1,1) 추정 중…');
    const g = M.garch(ret);
    const ew = M.ewma(ret, 0.94);
    const sg = M.volScores(g.sigma, ret), se = M.volScores(ew, ret);
    const ev = eventMask(d, $('#volNextDay').checked);

    const evAbs = [], noAbs = [];
    idx.forEach(function (i, k) {
      (ev.mask[i] ? evAbs : noAbs).push(Math.abs(ret[k]));
    });
    const tt = U.welchT(evAbs, noAbs);

    $('#volResult').classList.remove('hidden');
    const ann = Math.sqrt(M.TRADING_DAYS) * 100;
    const tiles = [
      ['α (충격 반응)', U.fmt(g.alpha, 3), '어제 충격이 오늘 변동성에 주는 영향'],
      ['β (지속성)', U.fmt(g.beta, 3), '어제 변동성이 이어지는 정도'],
      ['α+β', U.fmt(g.persistence, 3), '1에 가까울수록 오래 남습니다'],
      ['장기 평균 변동성', U.fmt(g.longRunVol * ann, 1) + '%', '연율화 기준']
    ];
    const box = $('#volTiles'); box.innerHTML = '';
    tiles.forEach(function (t) {
      const el = U.el('div', 'tile');
      el.appendChild(U.el('div', 'label', t[0]));
      el.appendChild(U.el('div', 'value', t[1]));
      el.appendChild(U.el('div', 'sub', t[2]));
      box.appendChild(el);
    });

    const labels = idx.map(function (i) { return U.dstr(d.dates[i]).slice(2, 7); });
    const series = [
      { name: 'GARCH(1,1)', values: Array.prototype.map.call(g.sigma, function (v) { return v * ann; }), color: C.seriesColor(0) },
      { name: 'EWMA(λ=0.94)', values: Array.prototype.map.call(ew, function (v) { return v * ann; }), color: C.seriesColor(1), dash: [5, 4] }
    ];
    C.line($('#chartVol'), { labels: labels, series: series, yFmt: function (v) { return U.fmt(v, 0) + '%'; } });
    const lg = $('#volLegend'); lg.innerHTML = '';
    lg.appendChild(C.legend(series.map(function (s) { return { name: s.name, color: s.color }; })));

    C.hist($('#chartVolHist'), [
      { values: evAbs, color: C.seriesColor(1) },
      { values: noAbs, color: C.seriesColor(0) }
    ], { xFmt: function (v) { return U.pct(v, 1); } });
    const hl = $('#volHistLegend'); hl.innerHTML = '';
    hl.appendChild(C.legend([
      { name: ev.label + ' 전후 (' + evAbs.length + '일)', color: C.seriesColor(1) },
      { name: '평소 (' + noAbs.length + '일)', color: C.seriesColor(0) }
    ]));

    const sig = isFinite(tt.p) && tt.p < 0.05;
    $('#volTest').innerHTML =
      '<div class="note ' + (sig ? 'ok' : 'warn') + '">' +
      '<strong>가설 H5 — ' + ev.label + '에 시장이 더 출렁이는가?</strong><br>' +
      ev.label + ' 전후 평균 |수익률| ' + U.pct(tt.ma, 3) + ' vs 평소 ' + U.pct(tt.mb, 3) +
      ' · t = ' + U.fmt(tt.t, 2) + ', p = ' + U.fmt(tt.p, 4) + '<br>' +
      (sig ? '차이가 통계적으로 유의합니다(p&lt;0.05). H5를 지지하는 결과입니다.'
           : '차이가 통계적으로 유의하지 않습니다. 표본이 적어서일 수도 있으니 기간을 늘려 확인해 보세요.') +
      '</div>' +
      '<p class="small">변동성 예측 성적(낮을수록 좋음) — GARCH: MSE ' + sg.mse.toExponential(2) + ', QLIKE ' + U.fmt(sg.qlike, 3) +
      ' / EWMA: MSE ' + se.mse.toExponential(2) + ', QLIKE ' + U.fmt(se.qlike, 3) + '</p>' +
      (d.meta.synthetic ? '<p class="small">지금은 <strong>가상 데이터</strong>의 가상 발표일로 계산한 결과입니다. 실제 FOMC 분석은 실제 데이터를 넣어야 합니다.</p>' : '');

    status('#volStatus', '완료. ω=' + g.omega.toExponential(2) + ', α=' + U.fmt(g.alpha, 3) + ', β=' + U.fmt(g.beta, 3));
  }

  /* ==========================================================================
   *  정적 표 (가설 / 용어 / 대응표)
   * ========================================================================*/
  const HYPOTHESES = [
    ['H1', '모델마다 정확도·속도·해석 용이성에 장단점이 있다', '한 모델이 세 가지 모두 최고다', '2. 모델 비교'],
    ['H2', '금리 정보를 넣어도 정확도가 크게 오르지 않는다 (효율적 시장)', '금리를 넣으니 정확도가 뚜렷이 오른다', '2. 모델 비교 → 금리 A/B'],
    ['H3', "금리 '수준'이 중요해 보이는 건 사실 '시기'를 알려주는 것이다", '시기를 통제해도 금리 수준이 계속 중요하다', '2. 모델 비교 (변수 중요도)'],
    ['H4', '거래비용을 물면 전략이 매수 후 보유를 못 이긴다', '비용을 빼고도 전략이 확실히 낫다', '3. 백테스트'],
    ['H5', '금리 발표일에는 시장이 평소보다 더 출렁인다', '발표일과 평소가 통계적으로 차이 없다', '5. 변동성'],
    ['H6', '비둘기 발표 뒤 주가가 매파 발표 뒤보다 더 오른다', '두 경우의 차이가 통계적으로 의미 없다', '파이썬 phase2 (NLP 필요)'],
    ['H7', '종목 순위를 맞히는 것이 지수 방향 맞히기보다 유용하다', '순위 전략이 코스피를 못 이긴다', '파이썬 phase3 (여러 종목 필요)']
  ];

  const GLOSSARY = [
    ['정확도 (Accuracy)', '100번 예측해서 몇 번 맞혔는지의 비율. 55번 맞히면 55%.'],
    ['기준선 (Baseline)', '아무 생각 없이 찍었을 때의 점수. 오르는 날이 더 많으면 "무조건 오른다"만 반복해도 어느 정도 맞는다. 우리 모델은 이 점수를 넘어야 의미가 있다.'],
    ['정밀도 (Precision)', '모델이 "오른다"고 한 것 중 실제로 오른 비율.'],
    ['재현율 (Recall)', '실제로 오른 날 중 모델이 잡아낸 비율.'],
    ['F1 점수', '정밀도와 재현율을 균형 있게 합친 점수.'],
    ['혼동행렬 (Confusion Matrix)', '맞힌 것과 틀린 것을 네 칸짜리 표로 정리한 것.'],
    ['ROC 곡선', "판정 기준(문턱값)을 바꿔가며 '오른다고 맞게 잡은 비율'과 '틀리게 잡은 비율'을 그린 그래프. 곡선이 왼쪽 위에 붙을수록 잘 구별하는 모델이다."],
    ['AUC', 'ROC 곡선 아래의 면적. 0.5면 찍기 수준(실력 없음), 1.0이면 완벽. 정확도에 잘 속지 않아 주 지표로 쓴다.'],
    ['MCC / 균형정확도', '한쪽으로 치우친 데이터에서도 잘 속지 않는 지표. MCC가 0, 균형정확도가 0.5면 찍기 수준.'],
    ['상승예측비율', '모델이 "오른다"고 답한 비율. 0.9를 넘으면 예측이 아니라 다수결을 흉내내는 중이라는 신호.'],
    ['p값 (p-value)', "이 결과가 '순전히 우연'일 가능성을 나타내는 숫자. 작을수록(보통 0.05 미만) 우연으로 보기 어렵다는 뜻이다."],
    ['t검정', '두 집단의 평균이 통계적으로 다른지 확인하는 방법.'],
    ['다중검정', '여러 번 시도할수록 그중 하나가 우연히 좋아 보일 확률이 커지는 문제. 그래서 시도 횟수를 기록해야 한다.'],
    ['데이터 누수 (Data Leakage)', '미래 정보가 학습에 새어드는 것. 시험 문제를 미리 본 것과 같아 점수가 가짜로 높아진다.'],
    ['과적합 (Overfitting)', '연습문제만 외워서 처음 보는 문제는 틀리는 것.'],
    ['정상성 (Stationarity)', '값의 성질이 시간이 지나도 크게 변하지 않는 것. 그래서 주가 자체 대신 "평균 대비 몇 %"를 쓴다.'],
    ['예측 시계 (HORIZON)', '며칠 뒤를 맞힐지. 1이면 내일, 20이면 약 한 달 뒤.'],
    ['하이퍼파라미터', '모델이 스스로 배우는 값이 아니라, 사람이 미리 정해주는 설정값.'],
    ['백테스트 (Backtest)', '과거 데이터로 "이 전략을 썼다면 어땠을까"를 돌려보는 모의실험.'],
    ['워크포워드 검증', '한 번 학습하고 끝내지 않고, 시간이 지나며 새 데이터로 다시 학습하는 더 현실적인 검증 방식.'],
    ['이벤트 스터디', '특정 사건(예: FOMC 발표) 전후로 주가가 어떻게 움직였는지 비교하는 분석.'],
    ['거래비용', '주식을 사고팔 때마다 떼이는 수수료. 자주 거래하면 무시할 수 없는 크기가 된다.'],
    ['슬리피지', '주문한 가격과 실제 체결 가격의 차이. 비용처럼 수익을 깎는다.'],
    ['샤프지수 (Sharpe)', '위험(출렁임) 대비 수익. 높을수록 안정적으로 번 것.'],
    ['최대낙폭 (MDD)', '고점 대비 가장 크게 떨어진 폭.'],
    ['변동성 (Volatility)', '가격이 얼마나 심하게 오르내리는지.'],
    ['MSE / QLIKE', '변동성 예측이 얼마나 정확한지 재는 지표(정확도 대신 사용). 둘 다 낮을수록 좋다.'],
    ['GARCH', '오늘의 변동성이 어제의 충격과 어제의 변동성에 의존한다고 보는 모델. "변동성은 뭉쳐서 온다"를 잡아낸다.'],
    ['매파 / 비둘기', '매파(hawkish)는 금리를 올리자는 긴축, 비둘기(dovish)는 금리를 내리자는 완화.'],
    ['서프라이즈 (Surprise)', "발표가 시장의 '예상'과 얼마나 달랐는가. 금리 자체보다 '예상 밖'인지가 주가를 더 움직인다."],
    ['생존 편향', '살아남은 것만 보고 판단하는 착각.'],
    ['클래스 가중치', '한쪽 답이 많을 때 적은 쪽에 더 큰 무게를 줘서, 모델이 다수결만 흉내내지 못하게 하는 장치.'],
    ['문턱값 (Threshold)', '확률이 얼마 이상일 때 "상승"이라고 판정할지 정하는 기준. 보통 0.5.']
  ];

  const MAPPING = [
    ['phase1a_model_comparison.py', '2. 모델 비교', '4개 모델 비교, AUC·혼동행렬·변수 중요도, 예측 시계 실험'],
    ['phase1b_backtest.py', '3. 백테스트', '워크포워드 재학습 + 거래비용·슬리피지 반영 백테스트'],
    ['phase1c_garch_volatility.py', '5. 변동성', 'GARCH(1,1) 추정, 정책 발표일 전후 변동성 비교(H5)'],
    ['phase2_event_study.py', '(웹 미지원)', 'FOMC 성명서 NLP가 필요해 파이썬으로 실행하세요'],
    ['phase3_cross_section.py', '(웹 미지원)', '여러 종목 데이터가 필요해 파이썬으로 실행하세요'],
    ['—', '4. 모의투자', '웹 전용. 워크포워드 예측을 그대로 써서 직접 매매해 보는 기능']
  ];

  function renderStaticTables() {
    $('#hypoTable').appendChild(U.table(['#', '가설', '이 가설이 틀렸다고 볼 신호', '확인하는 곳'],
      HYPOTHESES.map(function (h) { return [h[0], h[1], h[2], h[3]]; }), { text: true }));

    const render = function (filter) {
      const box = $('#glossTable'); box.innerHTML = '';
      const rows = GLOSSARY.filter(function (g) {
        if (!filter) return true;
        const f = filter.toLowerCase();
        return g[0].toLowerCase().indexOf(f) >= 0 || g[1].toLowerCase().indexOf(f) >= 0;
      }).map(function (g) { return [g[0], g[1]]; });
      box.appendChild(U.table(['용어', '쉬운 설명'], rows, { text: true }));
      $$('#glossTable td').forEach(function (td) { td.style.whiteSpace = 'normal'; });
    };
    render('');
    $('#glossSearch').addEventListener('input', function () { render(this.value.trim()); });

    $('#mapTable').appendChild(U.table(['파이썬 파일', '웹 탭', '내용'], MAPPING.map(function (m) { return m.slice(); }), { text: true }));
    $$('#mapTable td, #hypoTable td').forEach(function (td) { td.style.whiteSpace = 'normal'; });
  }

  /* ==========================================================================
   *  초기화
   * ========================================================================*/
  function buildModelChips() {
    const box = $('#modelChips');
    const defaults = { logistic: 1, forest: 1, boosting: 1, momentum: 1, alwaysup: 1 };
    ML.MODELS.forEach(function (m) {
      const l = U.el('label', 'chip' + (defaults[m.id] ? ' on' : ''));
      l.title = m.desc;
      const i = U.el('input');
      i.type = 'checkbox'; i.value = m.id; i.checked = !!defaults[m.id];
      i.addEventListener('change', function () { l.classList.toggle('on', i.checked); });
      l.appendChild(i);
      l.appendChild(document.createTextNode(m.name));
      box.appendChild(l);
    });

    // 백테스트·모의투자용 모델 선택 상자
    [['#bModel', 'boosting'], ['#sModel', 'forest']].forEach(function (pair) {
      const sel = $(pair[0]);
      ML.MODELS.forEach(function (m) {
        const o = U.el('option', '', m.name + (ML.isRule(m.id) ? ' (기준선)' : ''));
        o.value = m.id;
        sel.appendChild(o);
      });
      sel.value = pair[1];
    });
  }

  function bindControls() {
    $('#tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-tab]');
      if (b) setTab(b.dataset.tab);
    });
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.goto); });
    });

    // 데이터 소스 전환
    $$('#sourceChips input').forEach(function (r) {
      r.addEventListener('change', function () {
        $$('#sourceChips .chip').forEach(function (c) { c.classList.toggle('on', c.querySelector('input').checked); });
        const v = r.value;
        $('#srcDemo').classList.toggle('hidden', v !== 'demo');
        $('#srcFile').classList.toggle('hidden', v !== 'file');
        $('#srcPaste').classList.toggle('hidden', v !== 'paste');
        $('#srcNet').classList.toggle('hidden', v !== 'net');
      });
    });

    $('#demoSignal').addEventListener('input', function () { $('#demoSignalV').textContent = (+this.value).toFixed(2); });
    $('#mRatio').addEventListener('input', function () { $('#mRatioV').textContent = (+this.value).toFixed(2); });
    $('#mThreshold').addEventListener('input', function () { $('#mThresholdV').textContent = (+this.value).toFixed(2); });
    $('#bThreshold').addEventListener('input', function () { $('#bThresholdV').textContent = (+this.value).toFixed(2); });
    $('#sThreshold').addEventListener('input', function () { $('#sThresholdV').textContent = (+this.value).toFixed(2); });
    $('#bStart').addEventListener('input', function () { $('#bStartV').textContent = Math.round(+this.value * 100) + '%'; });

    $('#loadDemo').addEventListener('click', function () {
      setData(D.makeDemo({ n: +$('#demoN').value, signal: +$('#demoSignal').value, seed: +$('#demoSeed').value }));
    });

    $('#csvFile').addEventListener('change', function () {
      const f = this.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        try { setData(D.parseCSV(rd.result, f.name)); }
        catch (e) { alert('CSV를 읽지 못했습니다: ' + e.message); }
      };
      rd.readAsText(f, 'utf-8');
    });

    $('#loadPaste').addEventListener('click', function () {
      try { setData(D.parseCSV($('#csvText').value, '붙여넣은 데이터')); }
      catch (e) { alert('CSV를 읽지 못했습니다: ' + e.message); }
    });

    $('#netProvider').addEventListener('change', function () {
      const v = this.value;
      $('#fKey').classList.toggle('hidden', v === 'stooq');
      $('#fRate').classList.toggle('hidden', v === 'stooq');
      $('#netSymbol').value = v === 'av' ? 'SPY' : (v === 'fred' ? 'SP500' : '^spx');
      $('#netRate').value = v === 'av' ? '2year' : 'DGS2';
    });

    $('#loadNet').addEventListener('click', function () {
      const v = $('#netProvider').value;
      const sym = $('#netSymbol').value.trim();
      const key = $('#netKey').value.trim();
      const rate = $('#netRate').value.trim();
      status('#netStatus', '불러오는 중…');
      const onLog = function (m) { status('#netStatus', m); };
      let p;
      if (v === 'av') {
        if (!key) { status('#netStatus', 'Alpha Vantage 키를 입력하세요.'); return; }
        p = D.fetchAlphaVantage(sym, key, rate, onLog);
      } else if (v === 'fred') {
        if (!key) { status('#netStatus', 'FRED 키를 입력하세요.'); return; }
        p = D.fetchFred(sym, rate || 'DGS2', key, '2010-01-01', U.dstr(new Date()), onLog);
      } else {
        p = D.fetchStooq(sym);
      }
      p.then(function (data) { setData(data); status('#netStatus', '불러왔습니다: ' + data.meta.name); })
        .catch(function (e) {
          status('#netStatus', '실패: ' + e.message + ' — 브라우저 보안 정책(CORS)이나 키 문제일 수 있습니다. CSV 방식을 대신 써 보세요.');
        });
    });

    $('#runModels').addEventListener('click', function () { runModels(false); });
    $('#runRateAB').addEventListener('click', runRateAB);
    $('#runBacktest').addEventListener('click', runBacktest);
    $('#startSim').addEventListener('click', startSim);
    $('#runVol').addEventListener('click', runVol);
    bindSim();

    // 한 번에 실행
    $('#quickRun').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true;
      try {
        if (!state.data) setData(D.makeDemo({ n: 3800, signal: 0.06, seed: 42 }));
        status('#quickStatus', '모델 학습 중… 잠시만 기다려 주세요.');
        progress('#quickProg', 0.15);
        await U.yield_();
        await runModels(true);
        progress('#quickProg', 0.6);
        status('#quickStatus', '백테스트 실행 중…');
        await U.yield_();
        await runBacktest();
        progress('#quickProg', null);
        status('#quickStatus', '완료했습니다. 위 탭에서 결과를 확인하세요.');
        setTab('models');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function init() {
    initTheme();
    buildModelChips();
    bindControls();
    renderStaticTables();
    // 처음 열면 바로 볼 수 있도록 데모 데이터를 미리 넣어 둡니다.
    setData(D.makeDemo({ n: 3800, signal: 0.06, seed: 42 }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.app = { state: state, setTab: setTab };
})(window.FRSP = window.FRSP || {});
