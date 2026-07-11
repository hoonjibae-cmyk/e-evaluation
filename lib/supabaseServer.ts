import { createClient } from "@supabase/supabase-js";

function decodeJwtRole(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role || null;
  } catch {
    return null;
  }
}

export function getSupabaseEnvStatus() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const rawServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const url = rawUrl.trim().replace(/\/+$/, "");
  const serviceRoleKey = rawServiceRoleKey.trim();

  const problems: string[] = [];
  const warnings: string[] = [];

  if (!url) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL이 비어 있습니다.");
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        problems.push("NEXT_PUBLIC_SUPABASE_URL은 https:// 로 시작해야 합니다.");
      }
      if (parsed.hostname === "app.supabase.com" || parsed.pathname.includes("/project/")) {
        problems.push("NEXT_PUBLIC_SUPABASE_URL에 Supabase 대시보드 주소가 들어간 것 같습니다. Project URL을 넣어야 합니다.");
      }
      if (parsed.pathname.includes("/rest/v1")) {
        problems.push("NEXT_PUBLIC_SUPABASE_URL에는 /rest/v1을 붙이면 안 됩니다.");
      }
      if (parsed.pathname && parsed.pathname !== "/") {
        warnings.push("NEXT_PUBLIC_SUPABASE_URL 뒤에 경로가 붙어 있습니다. 보통 https://프로젝트ID.supabase.co 형태만 사용합니다.");
      }
    } catch {
      problems.push("NEXT_PUBLIC_SUPABASE_URL 주소 형식이 올바르지 않습니다.");
    }
  }

  if (!serviceRoleKey) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.");
  }

  let serviceKeyType = "unknown";
  if (serviceRoleKey.startsWith("sb_secret_")) {
    serviceKeyType = "secret-key";
  } else if (serviceRoleKey.startsWith("sb_publishable_")) {
    serviceKeyType = "publishable-key-wrong";
    problems.push("SUPABASE_SERVICE_ROLE_KEY에 publishable key가 들어간 것 같습니다. Secret key 또는 service_role key를 넣어야 합니다.");
  } else if (serviceRoleKey.startsWith("eyJ")) {
    const role = decodeJwtRole(serviceRoleKey);
    serviceKeyType = role ? `jwt-${role}` : "jwt";
    if (role === "anon") {
      problems.push("SUPABASE_SERVICE_ROLE_KEY에 anon public key가 들어간 것 같습니다. service_role key 또는 Secret key를 넣어야 합니다.");
    }
  } else if (serviceRoleKey.includes("YOUR-") || serviceRoleKey.includes("change-this")) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY가 예시값 그대로인 것 같습니다.");
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    urlPreview: url ? url.replace(/^https:\/\/(.{4}).*(\.supabase\.co)$/i, "https://$1...$2") : "비어 있음",
    hasUrl: Boolean(url),
    hasServiceRoleKey: Boolean(serviceRoleKey),
    serviceKeyType
  };
}

export function getSupabaseAdmin() {
  const status = getSupabaseEnvStatus();

  if (!status.ok) {
    throw new Error(status.problems.join(" "));
  }

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function getAppUrl() {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }
  return "";
}
