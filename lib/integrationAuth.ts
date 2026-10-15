import { timingSafeEqual } from "node:crypto";

/**
 * 사내 프로그램(학생 카드)이 **서버끼리** 부르는 창구의 열쇠.
 *
 * 환경변수 `STUDENT_CARD_API_KEY` — 학생 카드 쪽 `E_EVALUATION_API_KEY` 와 같은 값이어야 한다.
 * 비어 있으면 창구를 닫는다 (열어 두면 아무나 선생님별 퇴원율을 덮어쓸 수 있다).
 * 비교는 길이가 같을 때만 timingSafeEqual 로 한다 — 글자 수가 다르면 그 자체로 틀린 열쇠다.
 */
export function integrationApiKey(): string {
  return (process.env.STUDENT_CARD_API_KEY || "").trim();
}

export function integrationRequestAuthorized(provided: string | null | undefined): boolean {
  const expected = integrationApiKey();
  const given = (provided || "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
