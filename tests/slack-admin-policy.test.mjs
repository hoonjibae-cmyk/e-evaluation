import test from "node:test";
import assert from "node:assert/strict";
import { parseHrEvaluationStaff, parseOAuthFlow, roleForStaff, signOAuthFlow } from "../lib/slackAdminAuth.ts";

const identity = { email: "employee@example.com", slackUserId: "U_EMPLOYEE" };
const management = {
  app: "e-evaluation", count: 1,
  items: [{ empNo: "E001", name: "경영지원 직원", email: identity.email,
    department: "경영지원", role: "admin", slackLinked: true }]
};

test("HR Manager의 경영지원 재직자는 총괄관리자로 연결한다", () => {
  const staff = parseHrEvaluationStaff(management, identity);
  assert.ok(staff);
  assert.equal(roleForStaff(staff), "super_admin");
});

test("교육운영팀은 일반관리자로 연결하고 다른 부서는 차단한다", () => {
  const operations = { ...management, items: [{ ...management.items[0], department: "교육운영팀", role: "operations" }] };
  const staff = parseHrEvaluationStaff(operations, identity);
  assert.ok(staff);
  assert.equal(roleForStaff(staff), "general_admin");
  assert.equal(parseHrEvaluationStaff({ ...operations, items: [{ ...operations.items[0], department: "교수부", role: "user" }] }, identity), null);
});

test("Slack 이메일·연동 및 앱별 명부가 일치하지 않으면 차단한다", () => {
  assert.equal(parseHrEvaluationStaff({ ...management, items: [{ ...management.items[0], email: "other@example.com" }] }, identity), null);
  assert.equal(parseHrEvaluationStaff({ ...management, items: [{ ...management.items[0], slackLinked: false }] }, identity), null);
  assert.equal(parseHrEvaluationStaff({ ...management, app: "student-card" }, identity), null);
  assert.equal(parseHrEvaluationStaff({ ...management, count: 2 }, identity), null);
});

test("OAuth 상태 쿠키는 서명·만료를 검증한다", () => {
  process.env.ADMIN_SESSION_SECRET = "test-secret-at-least-thirty-two-characters";
  const token = signOAuthFlow({ state: "random-state", nonce: "random-nonce", issuedAt: Date.now() });
  assert.equal(parseOAuthFlow(token)?.state, "random-state");
  assert.equal(parseOAuthFlow(`${token.slice(0, -1)}x`), null);
  const expired = signOAuthFlow({ state: "old", nonce: "old", issuedAt: Date.now() - 600001 });
  assert.equal(parseOAuthFlow(expired), null);
});
