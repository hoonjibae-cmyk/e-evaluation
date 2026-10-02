import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, cookieOptions } from "@/lib/slackAdminAuth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", cookieOptions(0));
  return response;
}
