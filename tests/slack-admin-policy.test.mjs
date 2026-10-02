import test from "node:test";
import assert from "node:assert/strict";
import { parseHrEvaluationDirectory, parseHrEvaluationStaff, parseOAuthFlow, roleForStaff, signOAuthFlow } from "../lib/slackAdminAuth.ts";
import { parseReportRecipientDirectory, profileMatchesHrRecipient } from "../lib/reportRecipientDirectory.ts";

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
  assert.equal(parseHrEvaluationStaff({ ...operations, items: [{ ...operations.items[0], department: "교수부", role: "report_viewer" }] }, identity), null);
});

test("Slack 이메일·연동 및 앱별 명부가 일치하지 않으면 차단한다", () => {
  assert.equal(parseHrEvaluationStaff({ ...management, items: [{ ...management.items[0], email: "other@example.com" }] }, identity), null);
  assert.equal(parseHrEvaluationStaff({ ...management, items: [{ ...management.items[0], slackLinked: false }] }, identity), null);
  assert.equal(parseHrEvaluationStaff({ ...management, app: "student-card" }, identity), null);
  assert.equal(parseHrEvaluationStaff({ ...management, count: 2 }, identity), null);
});

test("로그인 전 직원도 HR 명부에서 조회하되 허용 부서와 권한만 받는다", () => {
  const directory = { app: "e-evaluation", count: 2, items: [
    management.items[0],
    { empNo: "E002", name: "운영 직원", email: "OPS@example.com", department: "교육운영팀", role: "operations", slackLinked: false }
  ] };
  const staff = parseHrEvaluationDirectory(directory);
  assert.equal(staff[1].email, "ops@example.com");
  assert.equal(roleForStaff(staff[1]), "general_admin");
  assert.equal(staff[1].slackLinked, false);
  assert.throws(() => parseHrEvaluationDirectory({ ...directory, items: [directory.items[0], { ...directory.items[1], department: "교수부" }] }));
  assert.throws(() => parseHrEvaluationDirectory({ ...directory, count: 3 }));
  assert.throws(() => parseHrEvaluationDirectory({ ...directory, items: [directory.items[0], { ...directory.items[1], empNo: "E001" }] }));
  const withProfessor = { ...directory, count: 3, items: [...directory.items,
    { empNo: "E003", name: "교수부 직원", email: "teacher@example.com", department: "교수부", role: "report_viewer", slackLinked: true }] };
  assert.equal(parseHrEvaluationDirectory(withProfessor).length, 2);
});

test("교수부는 원장 리포트 수신 후보로만 조회하고 현재 재직·Slack 연동을 확인한다", () => {
  const teacher = { empNo: "E003", name: "교수부 직원", email: "TEACHER@example.com",
    department: "교수부", role: "report_viewer", slackLinked: true };
  const [staff] = parseReportRecipientDirectory({ app: "e-evaluation", count: 1, items: [teacher] });
  const profile = { email: "teacher@example.com", role: "report_viewer" };
  assert.equal(profileMatchesHrRecipient(profile, staff), true);
  assert.equal(profileMatchesHrRecipient({ ...profile, role: "general_admin" }, staff), false);
  assert.equal(profileMatchesHrRecipient(profile, { ...staff, slackLinked: false }), false);
  assert.throws(() => parseReportRecipientDirectory({ app: "e-evaluation", count: 1,
    items: [{ ...teacher, role: "admin" }] }));
});

test("OAuth 상태 쿠키는 서명·만료를 검증한다", () => {
  process.env.ADMIN_SESSION_SECRET = "test-secret-at-least-thirty-two-characters";
  const token = signOAuthFlow({ state: "random-state", nonce: "random-nonce", issuedAt: Date.now() });
  assert.equal(parseOAuthFlow(token)?.state, "random-state");
  assert.equal(parseOAuthFlow(`${token.slice(0, -1)}x`), null);
  const expired = signOAuthFlow({ state: "old", nonce: "old", issuedAt: Date.now() - 600001 });
  assert.equal(parseOAuthFlow(expired), null);
});
