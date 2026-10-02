import { NextRequest, NextResponse } from "next/server";
import { logAction, requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { listReportRecipientDirectory } from "@/lib/reportRecipientDirectory";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;
  try {
    const items = (await listReportRecipientDirectory()).filter((staff) => staff.role === "report_viewer");
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    const empNo = typeof body?.empNo === "string" ? body.empNo.trim() : "";
    if (!empNo) return NextResponse.json({ error: "교수부 직원을 선택해주세요." }, { status: 400 });

    // 저장 직전에 재직·소속·Slack 연동을 HR Manager에서 다시 확인한다.
    const matches = (await listReportRecipientDirectory()).filter((staff) =>
      staff.empNo === empNo && staff.department === "교수부" && staff.role === "report_viewer");
    if (matches.length !== 1) return NextResponse.json({ error: "원장 리포트 수신 후보가 아닙니다." }, { status: 404 });
    const staff = matches[0];
    if (!staff.slackLinked) return NextResponse.json({ error: "HR Manager에서 Slack 계정을 먼저 연결해주세요." }, { status: 409 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staff.email)) {
      return NextResponse.json({ error: "HR Manager에 업무용 이메일을 먼저 등록해주세요." }, { status: 409 });
    }

    const supabase = getSupabaseAdmin();
    const existing = await supabase.from("admin_profiles").select("id").eq("email", staff.email).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ error: "이미 계정 목록에 등록된 직원입니다. 수신 설정을 확인해주세요." }, { status: 409 });

    const inserted = await supabase.from("admin_profiles").insert({
      email: staff.email,
      name: staff.name,
      role: "report_viewer",
      is_active: true,
      receives_internal_report: true,
      created_by: guard.admin.adminId,
      updated_at: new Date().toISOString()
    }).select("id,email,name,role,is_active,receives_internal_report").single();
    if (inserted.error) throw inserted.error;
    await logAction(supabase, guard.admin, "admin.add_report_recipient_from_hr", "admin_profiles", inserted.data.id, {
      empNo: staff.empNo,
      department: "교수부"
    });
    return NextResponse.json({ ok: true, recipient: inserted.data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
