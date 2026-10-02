import { NextRequest, NextResponse } from "next/server";
import { createAdminSessionToken, getRequestIp, hashIp } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  ADMIN_OAUTH_COOKIE, ADMIN_SESSION_COOKIE, appOrigin, cookieOptions,
  exchangeSlackCode, findHrEvaluationStaff, parseOAuthFlow, roleForStaff, slackAuthConfigured
} from "@/lib/slackAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = appOrigin(request.url);
  function finish(error?: string, session?: string) {
    const response = NextResponse.redirect(`${origin}/admin${error ? `?auth_error=${encodeURIComponent(error)}` : ""}`);
    response.cookies.set(ADMIN_OAUTH_COOKIE, "", cookieOptions(0));
    if (session) response.cookies.set(ADMIN_SESSION_COOKIE, session, cookieOptions(60 * 60));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (!slackAuthConfigured()) return finish("not_ready");
  try {
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const rawCookie = request.cookies.get(ADMIN_OAUTH_COOKIE)?.value;
    if (!state || !code || !rawCookie) return finish("invalid_state");
    const flow = parseOAuthFlow(rawCookie);
    if (!flow || flow.state !== state) return finish("invalid_state");

    const identity = await exchangeSlackCode(code, flow.nonce, `${origin}/api/admin/auth/slack/callback`);
    const staff = await findHrEvaluationStaff(identity);
    if (!staff) return finish("access_denied");
    const role = roleForStaff(staff);
    const supabase = getSupabaseAdmin();
    const existing = await supabase.from("admin_profiles").select("id,is_active").eq("email", identity.email).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.is_active === false) return finish("access_denied");
    const now = new Date().toISOString();
    const saved = await supabase.from("admin_profiles").upsert({
      email: identity.email,
      name: staff.name,
      role,
      last_login_at: now,
      last_login_ip_hash: hashIp(getRequestIp(request)),
      updated_at: now
    }, { onConflict: "email" }).select("id,email,name,role,is_active").single();
    if (saved.error) throw saved.error;
    if (saved.data.is_active !== true) return finish("access_denied");
    await supabase.from("admin_login_logs").insert({
      admin_id: saved.data.id,
      email: identity.email,
      success: true,
      failure_reason: null,
      ip_hash: hashIp(getRequestIp(request)),
      user_agent: request.headers.get("user-agent") || null
    });
    const session = createAdminSessionToken({
      id: saved.data.id,
      email: identity.email,
      name: staff.name,
      role,
      authSource: "slack",
      slackUserId: identity.slackUserId
    }, 1);
    return finish(undefined, session);
  } catch (error) {
    console.error("[E_EVALUATION_SLACK_LOGIN_FAILED]", error instanceof Error ? error.message : "unknown");
    return finish("login_failed");
  }
}
