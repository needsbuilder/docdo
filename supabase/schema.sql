-- DocDo 문서 상태 저장소.
-- 어르신 화면이 올리고 자녀 화면이 읽는다. 두 화면이 같은 행을 본다.
--
-- ⚠ 데모 전용 설정이다. RLS 를 끈 상태이므로 anon key 로 모든 행을 읽고 쓸 수 있다.
--   실서비스에서는 household 별 인증과 RLS 정책이 반드시 필요하다. README 에 명시한다.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'demo',
  created_at timestamptz not null default now(),

  -- 파이프라인 상태: queued / in_progress / completed / failed
  pipeline_status text not null default 'queued',
  -- 자녀의 처리 상태: new / acknowledged / done
  resolution_status text not null default 'new',

  upstage_job_id text,
  upstage_file_id text,

  action_type text,
  verdict text,
  -- 허용목록 밖 필드는 여기 들어오지 않는다. lib/verify.ts 가 걸러낸다.
  result jsonb,
  phrases jsonb,

  reviewed_at timestamptz,
  done_at timestamptz
);

create index if not exists documents_household_created_idx
  on documents (household_id, created_at desc);

alter table documents disable row level security; -- 데모 전용. README에 명시한다.
