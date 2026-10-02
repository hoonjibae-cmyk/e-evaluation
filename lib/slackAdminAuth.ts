import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdminRole } from "./adminAuth";

const jwks = createRemoteJWKSet(new URL("https://slack.com/openid/connect/keys"));

export const ADMIN_OAUTH_COOKIE = "ee_admin_oauth";
export const ADMIN_SESSION_COOKIE = "ee_admin_session";

type OAuthFlow = { state: string; nonce: string; issuedAt: number };

export function signOAuthFlow(flow: OAuthFlow) {
  const body = Buffer.from(JSON.stringify(flow)).toString("base64url");
  const signature = createHmac("sha256", process.env.ADMIN_SESSION_SECRET!).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function parseOAuthFlow(token: string | undefined): OAuthFlow | null {
  if (!token || token.length > 4096) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", process.env.ADMIN_SESSION_SECRET!).update(body).digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const flow = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthFlow;
    if (typeof flow.state !== "string" || !flow.state || typeof flow.nonce !== "string" || !flow.nonce ||
        typeof flow.issuedAt !== "number" || Date.now() - flow.issuedAt > 600000 ||
        flow.issuedAt > Date.now() + 30000) return null;
    return flow;
  } catch {
    return null;
  }
}

export function slackLoginEnforced() {
  return process.env.SLACK_LOGIN_ENFORCED === "1";
}

export function slackAuthConfigured() {
  const secretsReady = [
    "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_TEAM_ID",
    "HR_DIRECTORY_URL", "HR_DIRECTORY_API_KEY", "ADMIN_SESSION_SECRET"
  ].every((key) => Boolean(process.env[key]?.trim())) &&
    (process.env.ADMIN_SESSION_SECRET?.trim().length || 0) >= 32;
  return secretsReady && (process.env.NODE_ENV !== "production" ||
    Boolean((process.env.E_EVALUATION_ORIGIN || process.env.NEXT_PUBLIC_APP_URL)?.trim()));
}

export function appOrigin(requestUrl: string) {
  const configured = process.env.E_EVALUATION_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("E_EVALUATION_ORIGIN is required");
  }
  const url = new URL(configured || requestUrl);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("HTTPS app origin required");
  }
  return url.origin;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}

export type SlackIdentity = { email: string; slackUserId: string };

export async function exchangeSlackCode(code: string, nonce: string, redirectUri: string): Promise<SlackIdentity> {
  const response = await fetch("https://slack.com/api/openid.connect.token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Slack token exchange failed");
  const data = await response.json();
  if (data.ok !== true || typeof data.id_token !== "string") throw new Error("Slack token exchange rejected");
  const { payload } = await jwtVerify(data.id_token, jwks, {
    issuer: "https://slack.com",
    audience: process.env.SLACK_CLIENT_ID!,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "nonce"]
  });
  const slackUserId = payload["https://slack.com/user_id"];
  if (payload.nonce !== nonce || payload["https://slack.com/team_id"] !== process.env.SLACK_TEAM_ID ||
      payload.email_verified !== true || typeof payload.email !== "string" ||
      typeof slackUserId !== "string" || !slackUserId.trim()) {
    throw new Error("Slack identity rejected");
  }
  return { email: payload.email.trim().toLowerCase(), slackUserId: slackUserId.trim() };
}

export type HrEvaluationStaff = {
  empNo: string;
  name: string;
  email: string;
  department: "경영지원" | "교육운영팀";
  role: "admin" | "operations";
  slackLinked: true;
};

export type HrEvaluationCandidate = Omit<HrEvaluationStaff, "slackLinked"> & {
  slackLinked: boolean;
};

export function parseHrEvaluationDirectory(payload: unknown): HrEvaluationCandidate[] {
  if (!payload || typeof payload !== "object") throw new Error("HR directory response is invalid");
  const data = payload as Record<string, unknown>;
  if (data.app !== "e-evaluation" || !Array.isArray(data.items) ||
      !Number.isInteger(data.count) || data.count !== data.items.length) {
    throw new Error("HR directory response is invalid");
  }
  const seenEmpNos = new Set<string>();
  return data.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("HR directory staff is invalid");
    const row = item as Record<string, unknown>;
    const allowed = (row.department === "경영지원" && row.role === "admin") ||
      (row.department === "교육운영팀" && row.role === "operations");
    if (!allowed || typeof row.empNo !== "string" || !row.empNo.trim() ||
        typeof row.name !== "string" || !row.name.trim() ||
        typeof row.email !== "string" || typeof row.slackLinked !== "boolean" ||
        seenEmpNos.has(row.empNo.trim())) {
      throw new Error("HR directory staff is invalid");
    }
    seenEmpNos.add(row.empNo.trim());
    return {
      empNo: row.empNo.trim(),
      name: row.name.trim(),
      email: row.email.trim().toLowerCase(),
      department: row.department,
      role: row.role,
      slackLinked: row.slackLinked
    } as HrEvaluationCandidate;
  });
}

export async function listHrEvaluationStaff() {
  const url = new URL(process.env.HR_DIRECTORY_URL!);
  if (url.protocol !== "https:") throw new Error("HTTPS HR directory required");
  url.searchParams.set("app", "e-evaluation");
  url.searchParams.delete("slackUserId");
  const response = await fetch(url, {
    headers: { "x-api-key": process.env.HR_DIRECTORY_API_KEY! },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`HR directory unavailable (${response.status})`);
  return parseHrEvaluationDirectory(await response.json());
}

export function parseHrEvaluationStaff(payload: unknown, identity: SlackIdentity): HrEvaluationStaff | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (data.app !== "e-evaluation" || data.count !== 1 || !Array.isArray(data.items) || data.items.length !== 1) return null;
  const row = data.items[0] as Record<string, unknown>;
  if (!row || typeof row.empNo !== "string" || !row.empNo.trim() ||
      typeof row.name !== "string" || !row.name.trim() ||
      typeof row.email !== "string" || row.email.trim().toLowerCase() !== identity.email ||
      row.slackLinked !== true) return null;
  const allowed = (row.department === "경영지원" && row.role === "admin") ||
    (row.department === "교육운영팀" && row.role === "operations");
  if (!allowed) return null;
  return row as unknown as HrEvaluationStaff;
}

export function roleForStaff(staff: Pick<HrEvaluationStaff, "department">): AdminRole {
  return staff.department === "경영지원" ? "super_admin" : "general_admin";
}

export async function findHrEvaluationStaff(identity: SlackIdentity) {
  const url = new URL(process.env.HR_DIRECTORY_URL!);
  if (url.protocol !== "https:") throw new Error("HTTPS HR directory required");
  url.searchParams.set("app", "e-evaluation");
  url.searchParams.set("slackUserId", identity.slackUserId);
  const response = await fetch(url, {
    headers: { "x-api-key": process.env.HR_DIRECTORY_API_KEY! },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`HR directory unavailable (${response.status})`);
  return parseHrEvaluationStaff(await response.json(), identity);
}
