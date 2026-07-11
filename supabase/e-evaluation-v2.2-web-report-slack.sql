-- e강의평가 v2.2
-- 웹 리포트 링크 + Slack DM 발송 이력
-- 기존 데이터는 삭제하지 않습니다.

create extension if not exists pgcrypto;

-- 선생님별 Slack DM 매칭 정보
alter table public.teachers
add column if not exists slack_email text;

alter table public.teachers
add column if not exists slack_user_id text;

alter table public.teachers
add column if not exists slack_dm_enabled boolean default true;

alter table public.teachers
add column if not exists slack_last_checked_at timestamptz;

create index if not exists idx_teachers_slack_email
on public.teachers(slack_email);

create index if not exists idx_teachers_slack_user_id
on public.teachers(slack_user_id);

-- 선생님에게 공유할 웹 리포트 링크
create table if not exists public.teacher_report_share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  report_export_id uuid references public.teacher_report_exports(id) on delete set null,
  title text,
  is_active boolean not null default true,
  expires_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teacher_report_share_links
add column if not exists token text;

alter table public.teacher_report_share_links
add column if not exists expires_at timestamptz;

alter table public.teacher_report_share_links
add column if not exists view_count integer default 0;

alter table public.teacher_report_share_links
add column if not exists last_viewed_at timestamptz;

alter table public.teacher_report_share_links
add column if not exists created_by uuid references public.admin_profiles(id) on delete set null;

create unique index if not exists idx_teacher_report_share_links_token
on public.teacher_report_share_links(token);

create index if not exists idx_teacher_report_share_links_period_teacher
on public.teacher_report_share_links(evaluation_period_id, teacher_id);

create index if not exists idx_teacher_report_share_links_active
on public.teacher_report_share_links(is_active);

-- Slack DM 발송 이력
create table if not exists public.slack_message_logs (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid references public.evaluation_periods(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  report_share_link_id uuid references public.teacher_report_share_links(id) on delete set null,
  slack_user_id text,
  slack_channel_id text,
  message_ts text,
  message_text text,
  status text not null default 'sent',
  error_message text,
  sent_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.slack_message_logs
add column if not exists message_text text;

alter table public.slack_message_logs
add column if not exists error_message text;

create index if not exists idx_slack_message_logs_period_teacher
on public.slack_message_logs(evaluation_period_id, teacher_id);

create index if not exists idx_slack_message_logs_share_link
on public.slack_message_logs(report_share_link_id);

create index if not exists idx_slack_message_logs_created_at
on public.slack_message_logs(created_at desc);
