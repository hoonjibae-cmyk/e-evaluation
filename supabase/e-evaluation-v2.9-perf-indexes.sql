-- v2.9: 조회 성능용 인덱스 추가
--
-- 배경:
--   관리자 부트스트랩에서 evaluation_responses를 submitted_at 내림차순으로 정렬하는데
--   해당 컬럼에 인덱스가 없어 매번 전체 정렬이 발생했습니다.
--
-- 안전:
--   인덱스 추가만 하는 idempotent 마이그레이션입니다. 데이터 변경 없음.

create index if not exists idx_evaluation_responses_submitted_at
  on public.evaluation_responses (submitted_at desc);
