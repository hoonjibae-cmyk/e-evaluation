-- e강의평가 v2.6.19 (SQL v3.0) 원장 내부 확인용 리포트 수신자 지정 SQL
-- 실행 위치: Supabase Dashboard > SQL Editor
-- 실행 순서: 기존 SQL 실행 후 이 파일을 1회 실행
-- 목적:
--   지금까지는 '원장 내부 확인용' 리포트 Slack DM이 활성 총괄관리자 전원에게만 나갔습니다.
--   이 컬럼을 쓰면 총괄관리자 권한을 주지 않고도(일반관리자여도) 리포트 수신 대상으로 지정할 수 있습니다.

alter table public.admin_profiles
add column if not exists receives_internal_report boolean not null default false;

-- 기존 동작을 그대로 유지하기 위해, 현재 활성 총괄관리자는 모두 수신 대상으로 켜 둡니다.
update public.admin_profiles
set receives_internal_report = true
where role = 'super_admin'
  and is_active = true
  and receives_internal_report = false;

create index if not exists idx_admin_profiles_internal_report
on public.admin_profiles(receives_internal_report)
where receives_internal_report = true;

comment on column public.admin_profiles.receives_internal_report is
  '원장 내부 확인용 리포트 생성 시 Slack DM 수신 대상 여부. 권한(role)과는 별개로 동작합니다.';
