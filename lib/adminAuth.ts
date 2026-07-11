import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export type AdminRole = "super_admin" | "general_admin";

export type AdminSession = {
  adminId: string;
  email: string;
  name: string;
  role: AdminRole;
  exp: number;
  iat: number;
};

export type AdminPermission =
  | "view_dashboard"
  | "manage_master_data"
  | "manage_qr"
  | "view_responses"
  | "view_results"
  | "manage_withdrawal"
  | "export_reports"
  | "manage_report_exports"
  | "manage_admins"
  | "run_setup";

const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 12);

const rolePermissions: Record<AdminRole, AdminPermission[]> = {
  super_admin: [
    "view_dashboard",
    "manage_master_data",
    "manage_qr",
    "view_responses",
    "view_results",
    "manage_withdrawal",
    "export_reports",
    "manage_report_exports",
    "manage_admins",
    "run_setup"
  ],
  general_admin: [
    "view_dashboard",
    "manage_master_data",
    "manage_qr",
    "view_responses",
    "view_results",
    "export_reports",
    "manage_report_exports"
  ]
};

export const roleLabels: Record<AdminRole, string> = {
  super_admin: "총괄관리자",
  general_admin: "일반관리자"
};

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sessionSecret() {
  const secret =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.ADMIN_ACCESS_CODE ||
    "local-dev-admin-session-secret";
  return String(secret);
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const normalized = String(password || "");
  const hash = crypto.pbkdf2Sync(normalized, salt, 120000, 64, "sha512").toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  if (!password || !salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  return safeEqual(hash, expectedHash);
}

export function createAdminSessionToken(admin: {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSession = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    iat: now,
    exp: now + SESSION_HOURS * 60 * 60
  };

  const encoded = base64Url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function parseAdminSessionToken(token: string | null): AdminSession | null {
  try {
    const raw = String(token || "").trim();
    if (!raw || !raw.includes(".")) return null;

    const [encoded, signature] = raw.split(".");
    if (!encoded || !signature) return null;

    const expected = sign(encoded);
    if (!safeEqual(signature, expected)) return null;

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AdminSession;
    if (!payload?.adminId || !payload?.email || !payload?.role || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!["super_admin", "general_admin"].includes(payload.role)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function getAdminSessionFromRequest(request: NextRequest) {
  const bearer = request.headers.get("authorization") || "";
  const bearerToken = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7) : "";
  const token = request.headers.get("x-admin-session") || bearerToken;
  return parseAdminSessionToken(token);
}

export function hasPermission(admin: AdminSession | null, permission?: AdminPermission) {
  if (!admin) return false;
  if (!permission) return true;
  return rolePermissions[admin.role]?.includes(permission) || false;
}

export function getPermissionList(role: AdminRole) {
  return rolePermissions[role] || [];
}

export function legacyAdminCodeOk(request: NextRequest) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  if (!expected && process.env.NODE_ENV !== "production") return true;
  if (!expected) return false;
  return request.headers.get("x-admin-code") === expected;
}

export function checkAdminCode(request: NextRequest, permission?: AdminPermission) {
  const session = getAdminSessionFromRequest(request);
  if (session && hasPermission(session, permission)) return true;

  // v1.6 전환 기간용입니다. 기존 관리자 코드는 초기 설정/긴급 복구용으로만 남깁니다.
  // 실제 운영에서는 관리자 계정 로그인 사용을 권장합니다.
  if (!permission && legacyAdminCodeOk(request)) return true;
  return false;
}

export function requireAdmin(request: NextRequest, permission?: AdminPermission) {
  const session = getAdminSessionFromRequest(request);
  if (session && hasPermission(session, permission)) {
    return { ok: true as const, admin: session };
  }

  const message = session
    ? "이 작업을 수행할 권한이 없습니다."
    : "관리자 로그인이 필요합니다.";

  return {
    ok: false as const,
    response: NextResponse.json({ error: message }, { status: session ? 403 : 401 })
  };
}

export function requireSuperAdmin(request: NextRequest) {
  return requireAdmin(request, "manage_admins");
}

export function adminSafeProfile(admin: AdminSession | null) {
  if (!admin) return null;
  return {
    id: admin.adminId,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    roleLabel: roleLabels[admin.role],
    permissions: getPermissionList(admin.role)
  };
}

export function hashIp(value: string | null) {
  const text = String(value || "");
  if (!text) return null;
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export function getRequestIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

export async function logAction(
  supabase: any,
  admin: AdminSession | null,
  action: string,
  entityType?: string | null,
  entityId?: string | null,
  details: Record<string, any> = {}
) {
  try {
    await supabase.from("action_logs").insert({
      actor_admin_id: admin?.adminId || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details
    });
  } catch {
    // 로그 실패가 실제 업무 저장을 막으면 안 되므로 조용히 무시합니다.
  }
}
