import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  createAdminSessionToken,
  getRequestIp,
  hashIp,
  verifyPassword
} from "@/lib/adminAuth";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeEmail(value: any) {
  return String(value || "").trim().toLowerCase();
}

async function writeLoginLog(supabase: any, row: any) {
  try {
    await supabase.from("admin_login_logs").insert(row);
  } catch {
    // 로그인 로그 저장 실패가 로그인을 막으면 안 됩니다.
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const ipHash = hashIp(getRequestIp(request));
    const userAgent = request.headers.get("user-agent") || null;

    const found = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (found.error) throw found.error;

    const admin = found.data;
    if (!admin || admin.is_active === false) {
      await writeLoginLog(supabase, {
        email: normalizedEmail,
        admin_id: admin?.id || null,
        success: false,
        failure_reason: "계정 없음 또는 비활성화",
        ip_hash: ipHash,
        user_agent: userAgent
      });
      return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    if (!admin.password_hash || !admin.password_salt) {
      await writeLoginLog(supabase, {
        email: normalizedEmail,
        admin_id: admin.id,
        success: false,
        failure_reason: "비밀번호 미설정",
        ip_hash: ipHash,
        user_agent: userAgent
      });
      return NextResponse.json({
        error: "이 관리자 계정에는 아직 비밀번호가 없습니다. 총괄관리자가 계정을 다시 생성하거나 비밀번호를 재설정해야 합니다."
      }, { status: 401 });
    }

    if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
      return NextResponse.json({ error: "로그인 실패가 반복되어 잠시 잠겨 있습니다. 잠시 후 다시 시도해주세요." }, { status: 423 });
    }

    const ok = verifyPassword(String(password), String(admin.password_salt), String(admin.password_hash));
    if (!ok) {
      const failedCount = Number(admin.login_failed_count || 0) + 1;
      const lockUntil = failedCount >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;

      await supabase
        .from("admin_profiles")
        .update({
          login_failed_count: failedCount,
          locked_until: lockUntil,
          updated_at: new Date().toISOString()
        })
        .eq("id", admin.id);

      await writeLoginLog(supabase, {
        email: normalizedEmail,
        admin_id: admin.id,
        success: false,
        failure_reason: "비밀번호 불일치",
        ip_hash: ipHash,
        user_agent: userAgent
      });

      return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    await supabase
      .from("admin_profiles")
      .update({
        last_login_at: new Date().toISOString(),
        last_login_ip_hash: ipHash,
        login_failed_count: 0,
        locked_until: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", admin.id);

    await writeLoginLog(supabase, {
      email: normalizedEmail,
      admin_id: admin.id,
      success: true,
      failure_reason: null,
      ip_hash: ipHash,
      user_agent: userAgent
    });

    const token = createAdminSessionToken({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    });

    return NextResponse.json({
      ok: true,
      sessionToken: token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        roleLabel: admin.role === "super_admin" ? "총괄관리자" : "일반관리자"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
