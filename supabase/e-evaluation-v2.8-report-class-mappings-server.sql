-- v2.8: 리포트 반 이름 매칭을 서버(DB)에 저장 (localStorage → DB 이전)
--
-- 배경:
--   기존에는 '선생님 전체 월 리포트용 반 이름 매칭'을 브라우저 localStorage에만 저장해
--   설정한 그 브라우저에서만 리포트에 반영됐다(다른 PC/계정/캐시 삭제 시 소실).
--   이를 서버에 저장해 어느 기기·계정에서든 동일하게 적용되도록 한다.
--
-- 변경:
--   class_name_mappings 테이블에 teacher_id(선생님별 적용)와 direction_mode(양방향/단방향) 추가.
--   기존 (from,to) 유니크 제약을 (teacher_id, from, to)로 교체.
--
-- 안전:
--   컬럼 추가 + 유니크 교체만 하는 idempotent 마이그레이션. 기존 데이터는 유지된다.

alter table public.class_name_mappings
  add column if not exists teacher_id uuid references public.teachers(id) on delete cascade,
  add column if not exists direction_mode text not null default 'bidirectional';

-- 기존 전역 유니크 제약 제거(선생님별로 같은 from→to가 있을 수 있으므로)
alter table public.class_name_mappings drop constraint if exists uq_class_name_mappings;

-- 선생님 범위까지 포함한 유니크 인덱스 (upsert onConflict 대상)
create unique index if not exists uq_class_name_mappings_scope
  on public.class_name_mappings (teacher_id, from_class_id, to_class_id);

comment on column public.class_name_mappings.teacher_id is
  '이 매칭을 적용할 선생님. NULL이면 과거 전역 매칭(미사용). 리포트용 매칭은 선생님별로 저장.';
comment on column public.class_name_mappings.direction_mode is
  'bidirectional(양방향, from↔to 합산) 또는 oneway(단방향, from을 to 기준으로만 합산).';
