-- 경영지원이 선택한 교수부 직원에게 원장 리포트 Slack DM만 보내기 위한 수신 전용 역할.
-- 기존 관리자 역할과 계정은 변경하지 않는다. e-evaluation-v3.0 실행 후 1회 적용.
begin;

alter table public.admin_profiles
  drop constraint if exists admin_profiles_role_check;

alter table public.admin_profiles
  add constraint admin_profiles_role_check
  check (role in ('super_admin', 'general_admin', 'report_viewer'));

commit;
