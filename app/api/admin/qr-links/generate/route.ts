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
      .select("teacher_id, class_id")
      .eq("evaluation_period_id", evaluationPeriodId)
      .eq("is_active", true);

    if (assignmentsRes.error) throw assignmentsRes.error;
    const assignments = assignmentsRes.data || [];

    // 이미 존재하는 QR을 한 번에 조회 (배정 건마다 개별 조회하던 N+1 제거)
    const existingRes = await supabase
      .from("teacher_qr_links")
      .select("teacher_id, class_id")
      .eq("evaluation_period_id", evaluationPeriodId);
    if (existingRes.error) throw existingRes.error;

    const keyOf = (teacherId: any, classId: any) => `${teacherId || ""}|${classId || ""}`;
    const existingKeys = new Set((existingRes.data || []).map((row: any) => keyOf(row.teacher_id, row.class_id)));

    // 아직 없는 배정만 골라 한 번의 insert로 일괄 생성
    const seen = new Set<string>();
    const toInsert: any[] = [];
    for (const assignment of assignments) {
      const key = keyOf(assignment.teacher_id, assignment.class_id);
      if (existingKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      toInsert.push({
        evaluation_period_id: evaluationPeriodId,
        teacher_id: assignment.teacher_id,
        class_id: assignment.class_id,
        link_scope: "teacher_class",
        title: "강의평가 QR",
        is_active: true
      });
    }

    let created = 0;
    if (toInsert.length) {
      const insertRes = await supabase.from("teacher_qr_links").insert(toInsert).select("id");
      if (insertRes.error) throw insertRes.error;
      created = insertRes.data?.length || toInsert.length;
    }

    return NextResponse.json({ ok: true, created });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
