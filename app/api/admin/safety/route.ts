import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const action = cleanText(body.action);
    const reason = cleanText(body.reason) || "사유 미입력";
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (action === "lock_period") {
      const periodId = cleanText(body.periodId);
      if (!periodId) return NextResponse.json({ error: "잠금 처리할 평가월을 선택해주세요." }, { status: 400 });

      const res = await supabase
        .from("evaluation_periods")
        .update({
          is_locked: true,
          locked_at: now,
          locked_by: guard.admin.adminId,
          locked_reason: reason,
          updated_at: now
        })
        .eq("id", periodId)
        .select("id, title, year_month, is_locked")
        .single();

      if (res.error) throw res.error;
      await logAction(supabase, guard.admin, "period_lock", "evaluation_periods", periodId, { reason });
      return NextResponse.json({ ok: true, period: res.data });
    }

    if (action === "unlock_period") {
      const periodId = cleanText(body.periodId);
      if (!periodId) return NextResponse.json({ error: "잠금 해제할 평가월을 선택해주세요." }, { status: 400 });

      const res = await supabase
        .from("evaluation_periods")
        .update({
          is_locked: false,
          locked_at: null,
          locked_by: null,
          locked_reason: null,
          updated_at: now
        })
        .eq("id", periodId)
        .select("id, title, year_month, is_locked")
        .single();

      if (res.error) throw res.error;
      await logAction(supabase, guard.admin, "period_unlock", "evaluation_periods", periodId, { reason });
      return NextResponse.json({ ok: true, period: res.data });
    }

    if (action === "hide_response") {
      const responseId = cleanText(body.responseId);
      if (!responseId) return NextResponse.json({ error: "숨김 처리할 응답을 선택해주세요." }, { status: 400 });

      const res = await supabase
        .from("evaluation_responses")
        .update({
          is_hidden: true,
          hidden_at: now,
          hidden_by: guard.admin.adminId,
          hidden_reason: reason,
          updated_at: now
        })
        .eq("id", responseId)
        .select("id, evaluation_period_id, student_name, is_hidden")
        .single();

      if (res.error) throw res.error;
      await logAction(supabase, guard.admin, "response_hide", "evaluation_responses", responseId, {
        reason,
        studentName: res.data?.student_name
      });
      return NextResponse.json({ ok: true, response: res.data });
    }

    if (action === "restore_response") {
      const responseId = cleanText(body.responseId);
      if (!responseId) return NextResponse.json({ error: "복구할 응답을 선택해주세요." }, { status: 400 });

      const res = await supabase
        .from("evaluation_responses")
        .update({
          is_hidden: false,
          hidden_at: null,
          hidden_by: null,
          hidden_reason: null,
          updated_at: now
        })
        .eq("id", responseId)
        .select("id, evaluation_period_id, student_name, is_hidden")
        .single();

      if (res.error) throw res.error;
      await logAction(supabase, guard.admin, "response_restore", "evaluation_responses", responseId, {
        reason,
        studentName: res.data?.student_name
      });
      return NextResponse.json({ ok: true, response: res.data });
    }

    return NextResponse.json({ error: "지원하지 않는 운영 안전 작업입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
