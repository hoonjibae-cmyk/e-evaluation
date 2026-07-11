-- e강의평가 v1.6 관리자 로그인/권한 정식화 SQL
-- 실행 위치: Supabase Dashboard > SQL Editor
-- 실행 순서: 기존 v0.6 SQL 실행 후 이 파일을 1회 실행
-- 목적: 관리자 코드 방식에서 관리자 계정 로그인 방식으로 전환

create extension if not exists "pgcrypto";

alter table public.admin_profiles
add column if not exists password_hash text;

alter table public.admin_profiles
add column if not exists password_salt text;

alter table public.admin_profiles
add column if not exists password_updated_at timestamptz;

alter table public.admin_profiles
add column if not exists last_login_at timestamptz;

alter table public.admin_profiles
add column if not exists last_login_ip_hash text;

alter table public.admin_profiles
add column if not exists login_failed_count integer not null default 0;

alter table public.admin_profiles
add column if not exists locked_until timestamptz;

alter table public.admin_profiles
add column if not exists memo text;

alter table public.admin_profiles
add column if not exists created_by uuid references public.admin_profiles(id) on delete set null;

-- 기존에 admin_profiles에 계정을 수동으로 넣어둔 경우를 대비해 이메일을 소문자로 정리합니다.
update public.admin_profiles
set email = lower(trim(email))
where email is not null and email <> lower(trim(email));

-- 앱의 upsert(onConflict: email)가 정상 작동하도록 email 고유 인덱스를 추가합니다.
-- 같은 이메일이 중복으로 들어간 기존 데이터가 있다면 이 줄에서 에러가 날 수 있습니다.
-- 그 경우 중복 계정 중 사용하지 않는 행을 비활성화하거나 이메일을 변경한 뒤 다시 실행하세요.
create unique index if not exists uq_admin_profiles_email
on public.admin_profiles (email);

create unique index if not exists uq_admin_profiles_email_lower
on public.admin_profiles (lower(email));

create table if not exists public.admin_login_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_profiles(id) on delete set null,
  email text,
  success boolean not null default false,
  failure_reason text,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_login_logs_admin_id
on public.admin_login_logs(admin_id);

create index if not exists idx_admin_login_logs_created_at
on public.admin_login_logs(created_at desc);

create index if not exists idx_action_logs_actor_admin_id
on public.action_logs(actor_admin_id);

create index if not exists idx_action_logs_created_at
on public.action_logs(created_at desc);

-- 참고:
-- 첫 총괄관리자 계정은 앱 로그인 화면의 [초기 총괄관리자 만들기]에서 생성합니다.
-- 그때 Vercel 환경변수 ADMIN_ACCESS_CODE 값을 입력해야 합니다.
