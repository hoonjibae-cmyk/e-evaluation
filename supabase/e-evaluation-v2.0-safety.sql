-- e강의평가 v2.0 추가 SQL
-- 목적: 운영 안전장치 추가
-- 1) 평가월 잠금
-- 2) 응답 숨김/복구
-- 3) 숨김 응답이 결과 분석/결과지 집계에서 제외되도록 View 보정

alter table public.evaluation_periods
add column if not exists is_locked boolean not null default false;

alter table public.evaluation_periods
add column if not exists locked_at timestamptz;

alter table public.evaluation_periods
add column if not exists locked_by uuid references public.admin_profiles(id) on delete set null;

alter table public.evaluation_periods
add column if not exists locked_reason text;

alter table public.evaluation_responses
add column if not exists is_hidden boolean not null default false;

alter table public.evaluation_responses
add column if not exists hidden_at timestamptz;

alter table public.evaluation_responses
add column if not exists hidden_by uuid references public.admin_profiles(id) on delete set null;

alter table public.evaluation_responses
add column if not exists hidden_reason text;

create index if not exists idx_evaluation_periods_is_locked
on public.evaluation_periods(is_locked);

create index if not exists idx_evaluation_responses_is_hidden
on public.evaluation_responses(is_hidden);

create index if not exists idx_evaluation_responses_hidden_by
on public.evaluation_responses(hidden_by);

-- 숨김 응답은 점수 집계에서 제외합니다.
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
  and coalesce(r.is_hidden, false) = false
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
  and coalesce(r.is_hidden, false) = false
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
  and coalesce(r.is_hidden, false) = false
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
