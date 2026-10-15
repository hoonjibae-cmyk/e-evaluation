import test from "node:test";
import assert from "node:assert/strict";
import { buildMemo, clampPercent, matchTeachers, normalizeName, parseIncomingRows } from "../lib/withdrawalRateImport.ts";
import { integrationRequestAuthorized } from "../lib/integrationAuth.ts";

test("받은 줄 다듬기 — 이름 없는 줄은 버리고, 퇴원율은 0~100 소수 둘째 자리", () => {
  const rows = parseIncomingRows([
    { teacher: " 이서영 ", withdrawalRatePercent: "4.166", adjustedRatePercent: 3.3333, special: 1, counts: { a: 20, b: 2, c: 1, d: 0, e: 1, g: 22 } },
    { teacher: "", withdrawalRatePercent: 10 },
    { teacher: "김지연", withdrawalRatePercent: null },
    { teacher: "배승희", withdrawalRatePercent: 120 },
  ]);
  assert.deepEqual(rows.map((r) => [r.teacher, r.withdrawalRatePercent, r.adjustedRatePercent]), [["이서영", 4.17, 3.33], ["김지연", null, null], ["배승희", 100, null]]);
  assert.deepEqual(rows[0].counts, { a: 20, b: 2, c: 1, d: 0, e: 1, g: 22 });
  assert.equal(clampPercent("abc"), null);
  assert.equal(normalizeName(" 이 서영 "), "이서영");
});

test("선생님 맞추기 — name 또는 display_name, 공백 무시, 못 찾으면 unmatched, 퇴원율 없으면 skipped, 퇴직자는 제외", () => {
  const teachers = [
    { id: "t1", name: "이서영", display_name: null, is_active: true },
    { id: "t2", name: "김 지연", display_name: "김지연T", is_active: true },
    { id: "t3", name: "퇴직한선생", display_name: null, is_active: false },
  ];
  const rows = parseIncomingRows([
    { teacher: "이서영", withdrawalRatePercent: 4.2 },
    { teacher: "김지연", withdrawalRatePercent: null },
    { teacher: "퇴직한선생", withdrawalRatePercent: 1 },
    { teacher: "미정", withdrawalRatePercent: 2 },
    { teacher: "이 서영", withdrawalRatePercent: 9 },
  ]);
  const r = matchTeachers(rows, teachers);
  assert.deepEqual(r.matched.map((m) => [m.teacherId, m.teacherName, m.row.withdrawalRatePercent]), [["t1", "이서영", 4.2]]);
  assert.deepEqual(r.skipped, ["김지연"]);
  assert.deepEqual(r.unmatched, ["퇴직한선생", "미정"]);
});

test("메모 — 어디서 온 숫자인지와 뺀 것을 적는다", () => {
  const [row] = parseIncomingRows([{ teacher: "이서영", withdrawalRatePercent: 4.17, adjustedRatePercent: 3.33, special: 1, counts: { a: 20, b: 2, c: 1, d: 0, e: 1 } }]);
  const memo = buildMemo(row, { yearMonth: "2026-09", confirmedBy: "배지훈", confirmedAt: "2026-10-15T01:00:00.000Z" });
  assert.equal(memo, "학생 카드 확정 2026-09 (배지훈 · 2026-10-15) — 퇴원율 4.17% — 특수 퇴원 1명 제외 조정 3.33% — 전월 20 · 신입 2 · 전입 1 · 전출 0 · 퇴원 1");
});

test("열쇠 — 비어 있으면 닫히고, 같을 때만 열린다", () => {
  const 원래 = process.env.STUDENT_CARD_API_KEY;
  try {
    process.env.STUDENT_CARD_API_KEY = "";
    assert.equal(integrationRequestAuthorized("x"), false);
    process.env.STUDENT_CARD_API_KEY = "secret-key-1234";
    assert.equal(integrationRequestAuthorized("secret-key-1234"), true);
    assert.equal(integrationRequestAuthorized("secret-key-1235"), false);
    assert.equal(integrationRequestAuthorized("short"), false);
    assert.equal(integrationRequestAuthorized(""), false);
  } finally {
    process.env.STUDENT_CARD_API_KEY = 원래;
  }
});
