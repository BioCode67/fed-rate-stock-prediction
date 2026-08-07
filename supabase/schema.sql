-- ===========================================================================
--  QUANT LAB 리더보드 스키마
--
--  실행 방법
--    Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query → 아래 전체를 붙여넣고 RUN
--
--  설계 원칙
--    1. 브라우저에서 직접 쓰는 구조이므로 '키로 막는' 것이 불가능합니다.
--       대신 RLS(행 수준 보안)로 "무엇을 넣을 수 있는가"를 데이터베이스가 검사합니다.
--    2. 수정·삭제는 아무도 못 합니다. 기록은 남기만 합니다.
--    3. 결과만 받지 않고 '거래 기록 전체'를 함께 저장합니다.
--       그래야 나중에 그대로 재현해서 진짜인지 확인할 수 있습니다(감사 가능).
--    4. 말이 안 되는 값(수익률 100배 등)은 아예 들어오지 못하게 막습니다.
-- ===========================================================================

-- 기존 것이 있으면 지우고 다시 만들려면 아래 줄의 주석을 푸세요.
-- drop table if exists public.leaderboard;

create table if not exists public.leaderboard (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- 참가자
  nickname      text not null,
  team          text,

  -- 무엇으로 굴렸는가
  strategy      text not null,          -- 'manual'(직접매매) | 'momentum' | 'meanrev' | 'ai_*' ...
  strategy_name text,                   -- 화면에 보여 줄 이름

  -- 언제부터 언제까지
  start_date    date not null,
  end_date      date not null,
  trading_days  int  not null,

  -- 성과
  initial       numeric not null,
  final_value   numeric not null,
  ret           numeric not null,       -- 총수익률 (0.15 = +15%)
  bench_ret     numeric,                -- 같은 기간 QQQ 매수후보유
  excess        numeric,                -- ret - bench_ret
  sharpe        numeric,
  mdd           numeric,
  trades        int,
  fee           numeric,

  -- 재현·검증용 (거래 기록 전체)
  audit         jsonb,

  -- 데이터 버전 (실데이터 갱신일). 다른 날짜 데이터끼리 비교하지 않도록.
  data_updated  text,

  constraint nickname_len   check (char_length(nickname) between 2 and 20),
  constraint team_len       check (team is null or char_length(team) <= 30),
  constraint days_range     check (trading_days between 60 and 5000),
  constraint ret_sane       check (ret between -1 and 20),        -- -100% ~ +2000%
  constraint sharpe_sane    check (sharpe is null or sharpe between -20 and 20),
  constraint mdd_sane       check (mdd is null or mdd between -1 and 0),
  constraint trades_sane    check (trades is null or trades between 0 and 100000),
  constraint dates_order    check (end_date > start_date),
  constraint audit_size     check (audit is null or pg_column_size(audit) < 200000)
);

create index if not exists leaderboard_ret_idx      on public.leaderboard (ret desc);
create index if not exists leaderboard_created_idx  on public.leaderboard (created_at desc);
create index if not exists leaderboard_strategy_idx on public.leaderboard (strategy);

-- 같은 사람이 같은 조건으로 계속 밀어 넣지 못하게
create unique index if not exists leaderboard_unique_run
  on public.leaderboard (nickname, strategy, start_date, end_date);

-- ---------------------------------------------------------------------------
--  RLS: 읽기는 누구나, 넣기는 조건을 통과할 때만, 고치기·지우기는 금지
-- ---------------------------------------------------------------------------
alter table public.leaderboard enable row level security;

drop policy if exists "누구나 순위표를 볼 수 있다"   on public.leaderboard;
drop policy if exists "누구나 자기 기록을 올릴 수 있다" on public.leaderboard;

create policy "누구나 순위표를 볼 수 있다"
  on public.leaderboard for select
  to anon, authenticated
  using (true);

create policy "누구나 자기 기록을 올릴 수 있다"
  on public.leaderboard for insert
  to anon, authenticated
  with check (
    char_length(nickname) between 2 and 20
    and trading_days >= 60
    and ret between -1 and 20
    and audit is not null            -- 거래 기록 없이 성과만 올리는 것은 막습니다
  );

-- update/delete 정책을 만들지 않았으므로 아무도 고치거나 지울 수 없습니다.
-- (관리자는 대시보드에서 service_role로 정리할 수 있습니다)

-- ---------------------------------------------------------------------------
--  확인용
-- ---------------------------------------------------------------------------
-- select count(*) from public.leaderboard;
-- select nickname, strategy, round(ret*100,2) as "수익률%", trading_days
--   from public.leaderboard order by ret desc limit 20;
