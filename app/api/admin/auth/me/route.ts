import { NextRequest, NextResponse } from "next/server";
import { adminSafeProfile, getAdminSessionFromRequest } from "@/lib/adminAuth";

export async function GET(request: NextRequest) {
  const admin = getAdminSessionFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    admin: adminSafeProfile(admin)
  });
}
