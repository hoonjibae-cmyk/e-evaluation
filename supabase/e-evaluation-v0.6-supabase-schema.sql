-- e강의평가 v0.6 Supabase DB Schema
-- 기준 버전: v0.5 선생님별 결과지 PDF 출력 구조
-- 실행 위치: Supabase Dashboard > SQL Editor
-- 실행 순서: 이 파일을 위에서 아래로 1회 실행

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'general_admin'
    check (role in ('super_admin', 'general_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  teacher_code text unique,
  name text not null,
  display_name text,
  subject text,
  memo text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  grade text,
  day_pattern text,
  campus text,
  memo text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluation_periods (
  id uuid primary key default gen_random_uuid(),
  year_month text not null unique, -- 예: 2026-06
  title text not null,
  start_date date,
  end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'archived')),
  is_active boolean not null default true,
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_class_assignments (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_teacher_class_assignments unique (evaluation_period_id, teacher_id, class_id)
);

create table if not exists public.evaluation_questions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category text not null check (category in ('academy', 'fairness', 'teacher', 'comment')),
  question_type text not null check (question_type in ('scale_5', 'yes_no', 'text')),
  title text not null,
  help_text text,
  display_order integer not null default 0,
  is_required boolean not null default true,
  applies_to text not null default 'all' check (applies_to in ('all', 'academy', 'teacher')),
  is_score_target boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_qr_links (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  link_scope text not null default 'teacher_class' check (link_scope in ('teacher', 'teacher_class')),
  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  title text,
  is_active boolean not null default true,
  expires_at timestamptz,
  view_count integer not null default 0,
  response_count integer not null default 0,
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_teacher_qr_links_period_teacher_class
  on public.teacher_qr_links (
    evaluation_period_id,
    teacher_id,
    coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.evaluation_responses (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete restrict,
  teacher_id uuid not null references public.teachers(id) on delete restrict,
  class_id uuid references public.classes(id) on delete set null,
  teacher_qr_link_id uuid references public.teacher_qr_links(id) on delete set null,
  student_name text not null,
  student_group text,
  student_number text,
  submitted_at timestamptz not null default now(),
  device_key text,
  ip_hash text,
  user_agent text,
  is_duplicate_suspected boolean not null default false,
  duplicate_reason text,
  is_flagged boolean not null default false,
  flag_reason text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluation_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.evaluation_responses(id) on delete cascade,
  question_id uuid not null references public.evaluation_questions(id) on delete restrict,
  choice_label text,
  score_value numeric(6,2), -- 매우 만족=100, 만족=75, 보통=50, 불만족=25, 매우 불만족=0
  boolean_value boolean,
  text_value text,
  created_at timestamptz not null default now(),
  constraint uq_evaluation_answers_response_question unique (response_id, question_id)
);

create table if not exists public.teacher_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  withdrawal_rate_percent numeric(5,2),
  withdrawal_rate_memo text,
  withdrawal_rate_input_by uuid references public.admin_profiles(id) on delete set null,
  withdrawal_rate_input_at timestamptz,
  evaluation_score_override numeric(6,2),
  evaluation_score_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_teacher_monthly_metrics unique (evaluation_period_id, teacher_id),
  constraint chk_withdrawal_rate_percent check (
    withdrawal_rate_percent is null or (withdrawal_rate_percent >= 0 and withdrawal_rate_percent <= 100)
  )
);

create table if not exists public.teacher_report_exports (
  id uuid primary key default gen_random_uuid(),
  evaluation_period_id uuid not null references public.evaluation_periods(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  report_type text not null default 'monthly_teacher_report',
  pages jsonb not null default '[1,2,3,4]'::jsonb,
  file_url text,
  status text not null default 'created' check (status in ('created', 'printed', 'failed', 'archived')),
  exported_by uuid references public.admin_profiles(id) on delete set null,
  exported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.action_logs (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id uuid references public.admin_profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);


-- 기본 인덱스
create index if not exists idx_admin_profiles_auth_user_id on public.admin_profiles(auth_user_id);
create index if not exists idx_teachers_is_active on public.teachers(is_active);
create index if not exists idx_classes_is_active on public.classes(is_active);
create index if not exists idx_evaluation_periods_year_month on public.evaluation_periods(year_month);
create index if not exists idx_teacher_class_assignments_period_teacher on public.teacher_class_assignments(evaluation_period_id, teacher_id);
create index if not exists idx_evaluation_questions_category on public.evaluation_questions(category);
create index if not exists idx_evaluation_questions_display_order on public.evaluation_questions(display_order);
create index if not exists idx_teacher_qr_links_token on public.teacher_qr_links(token);
create index if not exists idx_teacher_qr_links_period_teacher on public.teacher_qr_links(evaluation_period_id, teacher_id);
create index if not exists idx_evaluation_responses_period_teacher on public.evaluation_responses(evaluation_period_id, teacher_id);
create index if not exists idx_evaluation_responses_period_class on public.evaluation_responses(evaluation_period_id, class_id);
create index if not exists idx_evaluation_responses_qr_link on public.evaluation_responses(teacher_qr_link_id);
create index if not exists idx_evaluation_responses_student_name on public.evaluation_responses(student_name);
create index if not exists idx_evaluation_answers_response_id on public.evaluation_answers(response_id);
create index if not exists idx_evaluation_answers_question_id on public.evaluation_answers(question_id);
create index if not exists idx_teacher_monthly_metrics_period on public.teacher_monthly_metrics(evaluation_period_id);
create index if not exists idx_teacher_report_exports_period_teacher on public.teacher_report_exports(evaluation_period_id, teacher_id);
create index if not exists idx_action_logs_created_at on public.action_logs(created_at);

-- updated_at 트리거 생성
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'admin_profiles','teachers','classes','evaluation_periods','teacher_class_assignments',
    'evaluation_questions','teacher_qr_links','evaluation_responses','teacher_monthly_metrics'
  ]
  loop
    if not exists (select 1 from pg_trigger where tgname = 'trg_' || tbl || '_updated_at') then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        'trg_' || tbl || '_updated_at',
        tbl
      );
    end if;
  end loop;
end $$;

-- QR 링크별 응답 수 자동 증가
create or replace function public.increment_qr_response_count()
returns trigger
language plpgsql
as $$
begin
  if new.teacher_qr_link_id is not null then
    update public.teacher_qr_links
    set response_count = response_count + 1,
        updated_at = now()
    where id = new.teacher_qr_link_id;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_increment_qr_response_count') then
    create trigger trg_increment_qr_response_count
    after insert on public.evaluation_responses
    for each row execute function public.increment_qr_response_count();
  end if;
end $$;


-- 실제 강의평가 양식 기반 기본 문항
insert into public.evaluation_questions
  (code, category, question_type, title, help_text, display_order, is_required, applies_to, is_score_target, metadata)
values
  ('facility_satisfaction','academy','scale_5','학원 시설과 환경에 대해서 만족하십니까?',null,10,true,'academy',false,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0]}'::jsonb),
  ('facility_reason','academy','text','불만족하는 경우에 구체적으로 이유를 쓰세요.',null,11,false,'academy',false,'{"show_if_question_code":"facility_satisfaction","show_if_score_lte":25}'::jsonb),
  ('class_time_satisfaction','academy','scale_5','학원 수업 시간에 대해서 만족하십니까?',null,20,true,'academy',false,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0]}'::jsonb),
  ('class_time_reason','academy','text','불만족하는 경우에 구체적으로 이유를 쓰세요.',null,21,false,'academy',false,'{"show_if_question_code":"class_time_satisfaction","show_if_score_lte":25}'::jsonb),
  ('clinic_satisfaction','academy','scale_5','클리닉 관리에 대해서 만족하십니까?',null,30,true,'academy',false,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0]}'::jsonb),
  ('clinic_reason','academy','text','불만족하는 경우에 구체적으로 이유를 쓰세요.',null,31,false,'academy',false,'{"show_if_question_code":"clinic_satisfaction","show_if_score_lte":25}'::jsonb),
  ('pressure_or_reward','fairness','yes_no','강의 평가와 관련하여 담임선생님으로부터 상품을 받거나, 강제적인 압박이 있었나요?','네를 선택한 응답은 관리자 검토 필요로 표시합니다.',40,true,'all',false,'{"yes_label":"네","no_label":"아니오","flag_if_true":true}'::jsonb),
  ('teacher_explanation','teacher','scale_5','{teacher_name} 선생님의 수업 시간의 설명은 잘 이해됩니까?',null,50,true,'teacher',true,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0],"replace_teacher_name":true}'::jsonb),
  ('teacher_helpfulness','teacher','scale_5','{teacher_name} 선생님은 학생이 필요한 것을 도와주기 위해 적극적입니까?',null,60,true,'teacher',true,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0],"replace_teacher_name":true}'::jsonb),
  ('teacher_homework_amount','teacher','scale_5','{teacher_name} 선생님이 주는 과제의 양은 적절합니까?',null,70,true,'teacher',true,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0],"replace_teacher_name":true}'::jsonb),
  ('teacher_feedback','teacher','scale_5','{teacher_name} 선생님이 주는 과제에 대한 피드백을 만족하십니까?',null,80,true,'teacher',true,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0],"replace_teacher_name":true}'::jsonb),
  ('teacher_attention','teacher','scale_5','{teacher_name} 선생님은 학생에게 충분한 관심을 주고 있다고 느끼나요?',null,90,true,'teacher',true,'{"scale_labels":["매우 만족","만족","보통","불만족","매우 불만족"],"scale_scores":[100,75,50,25,0],"replace_teacher_name":true}'::jsonb),
  ('teacher_good_comment','comment','text','{teacher_name} 선생님의 수업에서 좋은 점을 써주세요.','예: “~가 너무 좋아요!”, “~ 계속 해주세요!”',100,false,'teacher',false,'{"replace_teacher_name":true}'::jsonb),
  ('teacher_bad_comment','comment','text','{teacher_name} 선생님의 수업에서 아쉬운 점을 써주세요.','예: “~는 별로인 것 같아요”, “~는 안 했으면 합니다”',110,false,'teacher',false,'{"replace_teacher_name":true}'::jsonb),
  ('academy_suggestion','comment','text','학원에 대해 건의할 사항이 있으면 쓰세요.',null,120,false,'academy',false,'{}'::jsonb)
on conflict (code) do update set
  category = excluded.category,
  question_type = excluded.question_type,
  title = excluded.title,
  help_text = excluded.help_text,
  display_order = excluded.display_order,
  is_required = excluded.is_required,
  applies_to = excluded.applies_to,
  is_score_target = excluded.is_score_target,
  metadata = excluded.metadata,
  updated_at = now();


-- 대시보드/결과지용 View
create or replace view public.v_teacher_class_monthly_scores as
select
  r.evaluation_period_id,
  p.year_month,
  r.teacher_id,
  t.name as teacher_name,
  r.class_id,
  c.name as class_name,
  count(distinct r.id) as response_count,
  round(avg(a.score_value)::numeric, 2) as avg_score_100
from public.evaluation_responses r
join public.evaluation_answers a on a.response_id = r.id
join public.evaluation_questions q on q.id = a.question_id
join public.evaluation_periods p on p.id = r.evaluation_period_id
join public.teachers t on t.id = r.teacher_id
left join public.classes c on c.id = r.class_id
where q.is_score_target = true
  and q.question_type = 'scale_5'
  and a.score_value is not null
group by r.evaluation_period_id, p.year_month, r.teacher_id, t.name, r.class_id, c.name;

create or replace view public.v_teacher_monthly_scores as
select
  r.evaluation_period_id,
  p.year_month,
  r.teacher_id,
  t.name as teacher_name,
  count(distinct r.id) as response_count,
  round(avg(a.score_value)::numeric, 2) as avg_score_100
from public.evaluation_responses r
join public.evaluation_answers a on a.response_id = r.id
join public.evaluation_questions q on q.id = a.question_id
join public.evaluation_periods p on p.id = r.evaluation_period_id
join public.teachers t on t.id = r.teacher_id
where q.is_score_target = true
  and q.question_type = 'scale_5'
  and a.score_value is not null
group by r.evaluation_period_id, p.year_month, r.teacher_id, t.name;

create or replace view public.v_teacher_question_monthly_scores as
select
  r.evaluation_period_id,
  p.year_month,
  r.teacher_id,
  t.name as teacher_name,
  r.class_id,
  c.name as class_name,
  q.code as question_code,
  q.title as question_title,
  q.display_order,
  count(a.id) as answer_count,
  round(avg(a.score_value)::numeric, 2) as avg_score_100
from public.evaluation_responses r
join public.evaluation_answers a on a.response_id = r.id
join public.evaluation_questions q on q.id = a.question_id
join public.evaluation_periods p on p.id = r.evaluation_period_id
join public.teachers t on t.id = r.teacher_id
left join public.classes c on c.id = r.class_id
where q.is_score_target = true
  and q.question_type = 'scale_5'
  and a.score_value is not null
group by r.evaluation_period_id, p.year_month, r.teacher_id, t.name, r.class_id, c.name, q.code, q.title, q.display_order;

create or replace view public.v_teacher_evaluation_ranking as
select
  s.evaluation_period_id,
  s.year_month,
  s.teacher_id,
  s.teacher_name,
  s.response_count,
  s.avg_score_100,
  dense_rank() over (partition by s.evaluation_period_id order by s.avg_score_100 desc nulls last) as rank_no
from public.v_teacher_monthly_scores s;

create or replace view public.v_teacher_withdrawal_rate_ranking as
select
  m.evaluation_period_id,
  p.year_month,
  m.teacher_id,
  t.name as teacher_name,
  m.withdrawal_rate_percent,
  dense_rank() over (partition by m.evaluation_period_id order by m.withdrawal_rate_percent asc nulls last) as rank_no
from public.teacher_monthly_metrics m
join public.evaluation_periods p on p.id = m.evaluation_period_id
join public.teachers t on t.id = m.teacher_id;

-- 보안 기본값
-- v1은 학생 설문/관리자 기능 모두 Next.js 서버 API를 통해 DB에 접근합니다.
-- Service Role Key는 서버에서만 사용하고 브라우저에는 노출하지 않습니다.
alter table public.admin_profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.classes enable row level security;
alter table public.evaluation_periods enable row level security;
alter table public.teacher_class_assignments enable row level security;
alter table public.evaluation_questions enable row level security;
alter table public.teacher_qr_links enable row level security;
alter table public.evaluation_responses enable row level security;
alter table public.evaluation_answers enable row level security;
alter table public.teacher_monthly_metrics enable row level security;
alter table public.teacher_report_exports enable row level security;
alter table public.action_logs enable row level security;
