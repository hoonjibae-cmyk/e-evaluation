import { NextRequest, NextResponse } from "next/server";
import { logAction, requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { listHrEvaluationStaff, roleForStaff, slackLoginEnforced } from "@/lib/slackAdminAuth";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;
  if (!slackLoginEnforced()) return NextResponse.json({ error: "Slack 로그인 설정이 필요합니다." }, { status: 409 });
  try {
    const items = await listHrEvaluationStaff();
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;
  if (!slackLoginEnforced()) return NextResponse.json({ error: "Slack 로그인 설정이 필요합니다." }, { status: 409 });
  try {
    const body = await request.json();
    const empNo = typeof body?.empNo === "string" ? body.empNo.trim() : "";
    if (!empNo) return NextResponse.json({ error: "HR Manager 직원을 선택해주세요." }, { status: 400 });

    // 선택한 직원의 재직·소속·권한을 등록 시점에 HR Manager에서 다시 확인한다.
    const matches = (await listHrEvaluationStaff()).filter((item) => item.empNo === empNo);
    if (matches.length !== 1) return NextResponse.json({ error: "현재 접근 가능한 재직자가 아닙니다." }, { status: 404 });
    const staff = matches[0];
    if (!staff.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staff.email)) {
      return NextResponse.json({ error: "HR Manager에 업무용 이메일을 먼저 등록해주세요." }, { status: 409 });
    }

    const supabase = getSupabaseAdmin();
    const existing = await supabase.from("admin_profiles").select("id").eq("email", staff.email).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ error: "이미 계정 목록에 등록된 직원입니다." }, { status: 409 });

    const inserted = await supabase.from("admin_profiles").insert({
      email: staff.email,
      name: staff.name,
      role: roleForStaff(staff),
      is_active: true,
      created_by: guard.admin.adminId,
      updated_at: new Date().toISOString()
    }).select("id,email,name,role,is_active").single();
    if (inserted.error) throw inserted.error;
    await logAction(supabase, guard.admin, "admin.preprovision_from_hr", "admin_profiles", inserted.data.id, {
      empNo: staff.empNo,
      department: staff.department
    });
    return NextResponse.json({ ok: true, admin: inserted.data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
