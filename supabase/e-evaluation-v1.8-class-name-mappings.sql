-- e강의평가 v1.8 추가 SQL
-- 목적:
-- 1) 학기 변경 등으로 반 이름이 바뀌었을 때 이전반과 현재반을 수동 매칭
-- 2) 결과지 1페이지 최근 3개월 트렌드에서 같은 반의 연속 흐름으로 계산

create table if not exists public.class_name_mappings (
  id uuid primary key default gen_random_uuid(),
  from_class_id uuid not null references public.classes(id) on delete cascade,
  to_class_id uuid not null references public.classes(id) on delete cascade,
  memo text,
  is_active boolean not null default true,
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_class_name_mappings unique (from_class_id, to_class_id),
  constraint chk_class_name_mappings_not_self check (from_class_id <> to_class_id)
);

create index if not exists idx_class_name_mappings_from_class_id
on public.class_name_mappings(from_class_id);

create index if not exists idx_class_name_mappings_to_class_id
on public.class_name_mappings(to_class_id);

drop trigger if exists trg_class_name_mappings_updated_at on public.class_name_mappings;

create trigger trg_class_name_mappings_updated_at
before update on public.class_name_mappings
for each row execute function public.set_updated_at();

alter table public.class_name_mappings enable row level security;
