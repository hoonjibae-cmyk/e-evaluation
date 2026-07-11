-- e강의평가 v1.9 추가 SQL
-- 목적:
-- 1) 레거시/비상용 설문 응답 업로드 이력 저장
-- 2) 업로드 전 미리보기/검증 결과와 업로드 후 롤백 지원
-- 3) QR 제출 데이터와 업로드 데이터를 구분

create table if not exists public.response_import_batches (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete restrict,
  source_label text,
  raw_row_count integer not null default 0,
  valid_row_count integer not null default 0,
  error_row_count integer not null default 0,
  warning_row_count integer not null default 0,
  duplicate_row_count integer not null default 0,
  imported_response_count integer not null default 0,
  status text not null default 'imported',
  memo text,
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.admin_profiles(id) on delete set null,
  rollback_reason text,
  constraint chk_response_import_batches_status check (status in ('previewed','imported','rolled_back','failed'))
);

create table if not exists public.response_import_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.response_import_batches(id) on delete cascade,
  evaluation_period_id uuid references public.evaluation_periods(id) on delete cascade,
  row_number integer not null,
  severity text not null default 'error',
  error_type text,
  message text not null,
  row_data jsonb,
  created_at timestamptz not null default now(),
  constraint chk_response_import_errors_severity check (severity in ('error','warning'))
);

alter table public.evaluation_responses
add column if not exists import_batch_id uuid references public.response_import_batches(id) on delete set null;

alter table public.evaluation_responses
add column if not exists import_source text not null default 'qr';

alter table public.evaluation_responses
add column if not exists import_row_number integer;

alter table public.evaluation_responses
add column if not exists imported_by uuid references public.admin_profiles(id) on delete set null;

create index if not exists idx_response_import_batches_period
on public.response_import_batches(evaluation_period_id);

create index if not exists idx_response_import_batches_status
on public.response_import_batches(status);

create index if not exists idx_response_import_errors_batch
on public.response_import_errors(batch_id);

create index if not exists idx_evaluation_responses_import_batch
on public.evaluation_responses(import_batch_id);

create index if not exists idx_evaluation_responses_import_source
on public.evaluation_responses(import_source);

alter table public.response_import_batches enable row level security;
alter table public.response_import_errors enable row level security;
