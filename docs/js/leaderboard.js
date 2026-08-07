/* ============================================================================
 *  leaderboard.js — 순위표 (Supabase)
 *
 *  서버를 따로 두지 않고 Supabase의 REST API를 브라우저에서 직접 부릅니다.
 *  키가 공개되어도 괜찮은 이유는 데이터베이스 쪽 RLS 정책이 막아 주기 때문입니다.
 *  (supabase/schema.sql 참고 — 읽기는 모두 허용, 넣기는 조건 검사, 수정·삭제 금지)
 *
 *  성과만 올리지 않고 '거래 기록'을 함께 올립니다.
 *  나중에 그대로 되돌려 재현할 수 있어야 순위표를 믿을 수 있기 때문입니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const CFG = root.CONFIG;

  const LB = { available: !!(CFG && CFG.supabaseUrl && CFG.supabaseKey) };

  function endpoint(qs) {
    return CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/' + CFG.leaderboardTable + (qs || '');
  }

  function headers(extra) {
    return Object.assign({
      'apikey': CFG.supabaseKey,
      'Authorization': 'Bearer ' + CFG.supabaseKey,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  // 순위표 읽기
  LB.list = function (opts) {
    opts = opts || {};
    const limit = opts.limit || 100;
    let qs = '?select=nickname,team,strategy,strategy_name,start_date,end_date,trading_days,' +
      'ret,bench_ret,excess,sharpe,mdd,trades,created_at' +
      '&order=' + (opts.order || 'ret.desc') + '&limit=' + limit;
    if (opts.strategy) qs += '&strategy=eq.' + encodeURIComponent(opts.strategy);
    return fetch(endpoint(qs), { headers: headers() }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(describe(r.status, t)); });
      return r.json();
    }).catch(netError);
  };

  // 기록 올리기
  LB.submit = function (row) {
    return fetch(endpoint(), {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(row)
    }).then(function (r) {
      if (r.ok) return { ok: true };
      return r.text().then(function (t) { throw new Error(describe(r.status, t)); });
    }).catch(netError);
  };

  // 서버에 아예 닿지 못한 경우(네트워크 차단, 주소 오타 등)
  function netError(e) {
    if (e instanceof TypeError || /Failed to fetch|NetworkError|ERR_/i.test(e.message || '')) {
      throw new Error('순위표 서버에 연결하지 못했습니다. 인터넷 연결과 ' +
        'docs/js/config.js 의 Supabase 주소를 확인하세요. (사내망·학교망에서 차단될 수도 있습니다)');
    }
    throw e;
  }

  // 오류 메시지를 사람이 읽을 수 있게
  function describe(status, text) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.message || j.hint || j.details || text;
    } catch (e) { /* 그대로 */ }

    if (status === 404) {
      return '순위표 테이블이 아직 없습니다. Supabase SQL Editor에서 supabase/schema.sql 을 한 번 실행하세요.';
    }
    if (status === 401 || status === 403) {
      return '권한이 없습니다. RLS 정책이 적용됐는지, 키가 publishable(anon) 키인지 확인하세요. (' + detail + ')';
    }
    if (status === 409) {
      return '같은 조건으로 이미 올린 기록이 있습니다. 닉네임이나 기간을 바꿔 보세요.';
    }
    if (/violates check constraint|row-level security/i.test(detail)) {
      return '올릴 수 없는 값입니다. 최소 거래일 수(60일)와 닉네임 길이(2~20자)를 확인하세요. (' + detail + ')';
    }
    return 'HTTP ' + status + ' — ' + detail;
  }

  root.LB = LB;
})(window.QL = window.QL || {});
