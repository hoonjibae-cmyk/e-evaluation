import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_OAUTH_COOKIE, ADMIN_SESSION_COOKIE, appOrigin, cookieOptions, signOAuthFlow, slackAuthConfigured } from "@/lib/slackAdminAuth";
import { getAdminSessionFromRequest } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const hasConstraint = request.nextUrl.searchParams.has('portal_slack_user');
  const expectedSlackUserId = request.nextUrl.searchParams.get('portal_slack_user') || undefined;
  const unavailable = (message: string) => {
    const response = NextResponse.json({ error: message }, { status: 503 });
    if (hasConstraint) response.cookies.set(ADMIN_SESSION_COOKIE, '', cookieOptions(0));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
  if (hasConstraint && (!expectedSlackUserId || !/^[UW][A-Z0-9]{5,30}$/.test(expectedSlackUserId))) {
    const response = NextResponse.json({ error: '포털 계정을 확인하지 못했습니다. 포털에서 다시 열어 주세요.' }, { status: 400 });
    response.cookies.set(ADMIN_SESSION_COOKIE, '', cookieOptions(0));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  if (expectedSlackUserId && getAdminSessionFromRequest(request)?.slackUserId === expectedSlackUserId) {
    const response = NextResponse.redirect(`${appOrigin(request.url)}/admin`);
    response.cookies.set(ADMIN_OAUTH_COOKIE, '', cookieOptions(0));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  if (!slackAuthConfigured()) {
    return unavailable('Slack 로그인이 아직 설정되지 않았습니다.');
  }
  try {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const redirectUri = `${appOrigin(request.url)}/api/admin/auth/slack/callback`;
    const url = new URL("https://slack.com/openid/connect/authorize");
    url.search = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      team: process.env.SLACK_TEAM_ID!
    }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set(ADMIN_OAUTH_COOKIE, signOAuthFlow({ state, nonce, issuedAt: Date.now(), ...(expectedSlackUserId ? { expectedSlackUserId } : {}) }), cookieOptions(600));
    if (expectedSlackUserId) response.cookies.set(ADMIN_SESSION_COOKIE, '', cookieOptions(0));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return unavailable('Slack 로그인 주소를 준비하지 못했습니다.');
  }
}
