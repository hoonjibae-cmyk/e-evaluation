-- v2.7: 선생님-반 배정에 '이번 평가월 표시 이름'(class_display_name) 추가
--
-- 목적:
--   같은 반(class_id)을 그대로 재사용하되, 평가월마다 반 표시 이름을 다르게 저장한다.
--   예) 6월 '미사고2화목' → 7월 '고2 골드라벨화목'.
--   내부적으로는 같은 반이므로 리포트의 반별 추이 그래프에서 한 줄로 이어지고,
--   각 달의 라벨만 그 달 배정의 표시 이름으로 보인다. 과거 달은 영향을 받지 않는다.
--
-- 규칙:
--   - NULL 이면 기존과 동일하게 classes.name(전역 반 이름)을 사용한다.
--   - 배정을 '최근 달에서 전체 복제'할 때 그 달의 표시 이름을 스냅샷으로 채운다.
--   - 인라인으로 이름을 바꾸면 해당 평가월 배정의 이 값만 바뀌고 다른 달/전역 반 이름은 그대로다.
--
-- 안전:
--   - 컬럼 추가만 하는 idempotent 마이그레이션. 기존 데이터/RLS/제약에 영향 없음.

alter table public.teacher_class_assignments
  add column if not exists class_display_name text;

comment on column public.teacher_class_assignments.class_display_name is
  '평가월별 반 표시 이름. NULL이면 classes.name 사용. 복제 시 스냅샷되고, 인라인 수정은 이 값만 변경(과거·전역 미영향).';
