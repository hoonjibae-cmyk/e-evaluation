import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_qr");
  if (!guard.ok) return guard.response;

  try {
    const { evaluationPeriodId } = await request.json();
    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const lockedResponse = await rejectIfPeriodLocked(supabase, evaluationPeriodId, "QR 생성");
    if (lockedResponse) return lockedResponse;

    const assignmentsRes = await supabase
      .from("teacher_class_assignments")
      .select("*")
      .eq("evaluation_period_id", evaluationPeriodId)
      .eq("is_active", true);

    if (assignmentsRes.error) throw assignmentsRes.error;

    let created = 0;

    for (const assignment of assignmentsRes.data || []) {
      const existing = await supabase
        .from("teacher_qr_links")
        .select("id")
        .eq("evaluation_period_id", evaluationPeriodId)
        .eq("teacher_id", assignment.teacher_id)
        .eq("class_id", assignment.class_id)
        .maybeSingle();

      if (existing.error) throw existing.error;

      if (!existing.data) {
        const insertRes = await supabase.from("teacher_qr_links").insert({
          evaluation_period_id: evaluationPeriodId,
          teacher_id: assignment.teacher_id,
          class_id: assignment.class_id,
          link_scope: "teacher_class",
          title: "강의평가 QR",
          is_active: true
        });
        if (insertRes.error) throw insertRes.error;
        created += 1;
      }
    }

    return NextResponse.json({ ok: true, created });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
