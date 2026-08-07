/* ============================================================================
 *  config.js — 사이트 설정
 *
 *  Supabase 키에 대해
 *    아래 키는 'publishable'(예전 이름 anon) 키입니다. 브라우저에 공개되는 것을
 *    전제로 만들어진 키라서 저장소에 그대로 두어도 됩니다.
 *    실제 보호는 키가 아니라 데이터베이스의 RLS(행 수준 보안) 정책이 합니다.
 *    → supabase/schema.sql 참고. 읽기는 누구나, 쓰기는 형식 검사를 통과한 기록만,
 *      수정·삭제는 아무도 못 하도록 막아 두었습니다.
 *    'secret'(service_role) 키는 절대 여기에 넣으면 안 됩니다.
 * ==========================================================================*/
(function (root) {
  'use strict';

  root.CONFIG = {
    supabaseUrl: 'https://rjbbhqdqyibvccfkjace.supabase.co',
    supabaseKey: 'sb_publishable_IO6GQNmNz6pxpT3OX_3HgA_0KlYQfcR',
    leaderboardTable: 'leaderboard',

    // 랭킹에 올릴 수 있는 최소 조건 (너무 짧게 굴린 기록은 운이 대부분이라 막습니다)
    minTradingDays: 60,
    maxNickname: 20
  };
})(window.QL = window.QL || {});
