import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_OAUTH_COOKIE, appOrigin, cookieOptions, signOAuthFlow, slackAuthConfigured } from "@/lib/slackAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!slackAuthConfigured()) {
    return NextResponse.json({ error: "Slack 로그인이 아직 설정되지 않았습니다." }, { status: 503 });
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
    response.cookies.set(ADMIN_OAUTH_COOKIE, signOAuthFlow({ state, nonce, issuedAt: Date.now() }), cookieOptions(600));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Slack 로그인 주소를 준비하지 못했습니다." }, { status: 503 });
  }
}
