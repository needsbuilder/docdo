-- DocDo 저장소.
--
-- 보호자(guardian)는 이메일+비밀번호로 가입한다. 가입하면 가구(household) 하나가 생기고
-- 어르신 초대 토큰(elder_token)이 발급된다. 어르신은 그 링크를 한 번 열면 가입 없이 그 가구에 묶인다.
-- 문서는 가구 단위로 격리된다.
--
-- ⚠ 데모 전용 설정이다. RLS 를 끈 상태이므로 anon key 로 모든 행을 읽고 쓸 수 있다.
--   anon key 는 서버에서만 쓰인다. 실서비스에는 RLS 정책이 반드시 필요하다. README 에 명시한다.

create table if not exists guardians (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- scrypt. 형식: scrypt$<salt hex>$<hash hex>
  password_hash text not null,
  household_id uuid not null default gen_random_uuid(),
  -- 어르신 초대 링크 토큰. 추측 불가능해야 한다(32바이트 난수). 가구 id 와 다르다.
  elder_token text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists guardians_household_idx on guardians (household_id);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'demo',
  created_at timestamptz not null default now(),

  -- 파이프라인 상태: uploading / queued / in_progress / completed / failed
  pipeline_status text not null default 'queued',
  -- 보호자의 처리 상태: new / acknowledged / done (단방향)
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

alter table guardians disable row level security; -- 데모 전용
alter table documents disable row level security; -- 데모 전용

-- 에이전트 실행(2026-08-23). 보호자가 승인하면 워커가 집어가 처리하고 단계를 기록한다.
-- action_status: none / queued / running / done / blocked / failed
alter table documents add column if not exists action_status text not null default 'none';
alter table documents add column if not exists action_trace jsonb not null default '[]'::jsonb;
alter table documents add column if not exists action_result jsonb;
alter table documents add column if not exists approved_at timestamptz;
create index if not exists documents_action_queue_idx on documents (action_status, approved_at) where action_status = 'queued';

-- 실시간 송출: 워커가 올리는 최신 화면(JPEG data URL). 실행 중에만 값이 있고 끝나면 비운다.
alter table documents add column if not exists action_live text;

-- 사람 개입(2026-08-23). action_wait: 멈춘 이유·안내. action_inputs: 보호자 폰에서 온 터치·키 입력 큐(워커가 소비).
alter table documents add column if not exists action_wait jsonb;
alter table documents add column if not exists action_inputs jsonb not null default '[]'::jsonb;

-- 실행 리스(2026-08-23). 승인마다 새 run id. 워커는 자기 run 으로만 쓸 수 있다 — 재승인 뒤 옛 워커는 거부된다.
alter table documents add column if not exists action_run text;
