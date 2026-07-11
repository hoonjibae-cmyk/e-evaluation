import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  createAdminSessionToken,
  hashPassword,
  legacyAdminCodeOk,
  logAction
} from "@/lib/adminAuth";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: any) {
  return String(value || "").trim();
}

function normalizeEmail(value: any) {
  return clean(value).toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const setupCode = clean(body.setupCode);
    const email = normalizeEmail(body.email);
    const name = clean(body.name) || "총괄관리자";
    const password = String(body.password || "");

    const expected = process.env.ADMIN_ACCESS_CODE;
    const codeOk = expected ? setupCode === expected : process.env.NODE_ENV !== "production";

    if (!codeOk && !legacyAdminCodeOk(request)) {
      return NextResponse.json({
        error: "초기 총괄관리자 생성 코드가 올바르지 않습니다. Vercel의 ADMIN_ACCESS_CODE 값을 입력해주세요."
      }, { status: 401 });
    }

    if (!email.includes("@")) {
      return NextResponse.json({ error: "이메일 형식으로 입력해주세요." }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "비밀번호는 8자 이상으로 입력해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const existingSuper = await supabase
      .from("admin_profiles")
      .select("id, email, password_hash")
      .eq("role", "super_admin")
      .not("password_hash", "is", null)
      .limit(1);

    if (existingSuper.error) throw existingSuper.error;

    if ((existingSuper.data || []).length > 0) {
      return NextResponse.json({
        error: "이미 로그인 가능한 총괄관리자 계정이 있습니다. 기존 계정으로 로그인해주세요."
      }, { status: 409 });
    }

    const { salt, hash } = hashPassword(password);

    const upserted = await supabase
      .from("admin_profiles")
      .upsert(
        {
          email,
          name,
          role: "super_admin",
          is_active: true,
          password_salt: salt,
          password_hash: hash,
          password_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: "email" }
      )
      .select("*")
      .single();

    if (upserted.error) throw upserted.error;

    const token = createAdminSessionToken({
      id: upserted.data.id,
      email: upserted.data.email,
      name: upserted.data.name,
      role: upserted.data.role
    });

    await logAction(supabase, {
      adminId: upserted.data.id,
      email: upserted.data.email,
      name: upserted.data.name,
      role: upserted.data.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    }, "admin.bootstrap_super_admin", "admin_profiles", upserted.data.id, { email });

    return NextResponse.json({
      ok: true,
      sessionToken: token,
      admin: {
        id: upserted.data.id,
        email: upserted.data.email,
        name: upserted.data.name,
        role: upserted.data.role,
        roleLabel: "총괄관리자"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
