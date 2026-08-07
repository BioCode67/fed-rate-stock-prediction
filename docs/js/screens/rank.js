/* ============================================================================
 *  rank.js — 순위표 화면
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, DATA = root.DATA, App = root.App, LB = root.LB, CFG = root.CONFIG;

  const S = { rows: null, error: null, loading: false, order: 'ret.desc' };

  function fetchRows(host) {
    S.loading = true; S.error = null;
    LB.list({ order: S.order, limit: 200 }).then(function (rows) {
      S.rows = rows; S.loading = false; draw(host);
    }).catch(function (e) {
      S.error = e.message; S.loading = false; draw(host);
    });
  }

  function medal(i) {
    return i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : String(i + 1)));
  }

  function tablePanel(host) {
    const p = App.panel('순위표 <span class="accent">LEADERBOARD</span>',
      { sub: '실제 나스닥 데이터로 굴린 결과만 올라옵니다', tight: true });

    const seg = U.el('div', 'seg');
    [['ret.desc', '수익률'], ['excess.desc', 'QQQ 대비'], ['sharpe.desc', '샤프'], ['created_at.desc', '최신']]
      .forEach(function (o) {
        const b = U.el('button', S.order === o[0] ? 'on' : '', o[1]);
        b.addEventListener('click', function () { S.order = o[0]; fetchRows(host); });
        seg.appendChild(b);
      });
    p.actions.appendChild(seg);
    const refresh = U.el('button', 'btn sm', '새로고침');
    refresh.addEventListener('click', function () { fetchRows(host); });
    p.actions.appendChild(refresh);

    if (S.loading) {
      const d = U.el('div', 'empty');
      d.innerHTML = '<span class="spinner"></span> 불러오는 중…';
      p.body.appendChild(d);
      return p;
    }
    if (S.error) {
      const d = U.el('div', 'note bad');
      d.style.margin = '12px';
      d.innerHTML = '<b>순위표를 불러오지 못했습니다.</b><br>' + U.escape(S.error);
      p.body.appendChild(d);
      return p;
    }
    if (!S.rows || !S.rows.length) {
      p.body.appendChild(U.el('div', 'empty', '아직 올라온 기록이 없습니다. 모의투자를 60거래일 이상 진행한 뒤 제출해 보세요.'));
      return p;
    }

    const rows = S.rows.map(function (r, i) {
      const name = U.el('span');
      name.innerHTML = '<b>' + U.escape(r.nickname) + '</b>' +
        (r.team ? ' <span class="tiny">' + U.escape(r.team) + '</span>' : '');

      // 개발 구간 성과가 함께 저장돼 있으면 채점 구간과의 격차를 보여 줍니다.
      // 격차가 크다는 것은 개발 구간에 과적합했다는 뜻입니다.
      let devCell = U.el('span', 'tiny', '—');
      let gapCell = U.el('span', 'tiny', '—');
      if (r.dev && r.dev.total !== undefined && r.dev.total !== null) {
        const dv = Number(r.dev.total);
        devCell = App.chg(dv, 1);
        const gap = Number(r.ret) - dv;
        const g = U.el('span', Math.abs(gap) < 0.1 ? 'up' : 'down');
        g.textContent = (gap >= 0 ? '+' : '') + (gap * 100).toFixed(1) + '%p';
        g.title = Math.abs(gap) < 0.1
          ? '개발 구간과 채점 구간의 성적이 비슷합니다 (과적합 신호 약함)'
          : '개발 구간과 채점 구간의 차이가 큽니다 (과적합 가능성)';
        gapCell = g;
      }

      return {
        cells: [
          medal(i), name,
          U.el('span', 'tiny', r.strategy_name || r.strategy),
          App.chg(r.ret, 1),
          App.chg(r.excess, 1),
          isFinite(r.sharpe) && r.sharpe !== null ? Number(r.sharpe).toFixed(2) : '—',
          r.mdd !== null ? (Number(r.mdd) * 100).toFixed(1) + '%' : '—',
          devCell, gapCell,
          U.comma(r.trading_days) + '일',
          (r.start_date || '').slice(2) + ' ~ ' + (r.end_date || '').slice(2)
        ]
      };
    });

    p.body.appendChild(App.table(
      [{ label: '#' }, '참가자', '전략',
       { label: '채점 수익률', num: true }, { label: 'QQQ 대비', num: true },
       { label: '샤프', num: true }, { label: 'MDD', num: true },
       { label: '개발 구간', num: true }, { label: '격차', num: true },
       { label: '기간', num: true }, '구간'],
      rows, { scroll: true }));

    const legend = U.el('div', 'note');
    legend.style.margin = '10px 12px';
    legend.innerHTML =
      '<b>채점 수익률</b>은 제출 후에 처음 열린 구간의 성적입니다. 순위는 이 값으로 매깁니다.<br>' +
      '<b>격차</b>는 채점 − 개발입니다. <span class="up">0에 가까우면</span> 개발 구간과 채점 구간에서 ' +
      '비슷하게 작동했다는 뜻이고, <span class="down">크게 벌어지면</span> 개발 구간에 과적합했을 ' +
      '가능성이 큽니다. 실제 대회에서 순위가 뒤집히는 지점이 바로 여기입니다.';
    p.body.appendChild(legend);
    return p;
  }

  function guidePanel() {
    const p = App.panel('제출 규칙');
    p.body.innerHTML =
      '<div class="note"><b>순위표는 결과만 받지 않습니다.</b> 거래 기록 전체를 함께 저장하므로, ' +
      '나중에 그대로 재현해서 진짜인지 확인할 수 있습니다. 그래서 좋은 성적일수록 신뢰가 갑니다.</div>' +
      '<ul class="small" style="padding-left:18px;line-height:1.8">' +
      '<li><b>최소 ' + CFG.minTradingDays + '거래일</b> 이상 진행한 기록만 올릴 수 있습니다. ' +
      '짧게 굴린 성적은 대부분 운이기 때문입니다.</li>' +
      '<li>같은 닉네임·같은 전략·같은 구간은 한 번만 올라갑니다. 조건을 바꿔서 다시 도전하세요.</li>' +
      '<li>올린 기록은 <b>수정·삭제할 수 없습니다.</b></li>' +
      '<li>비교의 기준은 수익률만이 아닙니다. <b>QQQ 대비 초과수익</b>과 <b>샤프지수</b>를 함께 보세요. ' +
      '시장이 오른 구간에서는 아무나 수익이 나기 때문입니다.</li>' +
      '</ul>';
    return p;
  }

  function draw(host) {
    host.innerHTML = '';
    if (!LB.available) {
      const p = App.panel('순위표');
      p.body.innerHTML = '<div class="note warn">순위표 설정이 아직 없습니다. ' +
        '<code>docs/js/config.js</code> 에 Supabase 주소와 publishable 키를 넣으세요.</div>';
      host.appendChild(p);
      return;
    }
    host.appendChild(tablePanel(host));
    host.appendChild(guidePanel());
    if (S.rows === null && !S.loading && !S.error) fetchRows(host);
  }

  App.register('rank', { render: draw });
})(window.QL = window.QL || {});
