import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const evaluation_period_id = cleanText(body.evaluation_period_id);
    const teacher_id = cleanText(body.teacher_id);

    const rawClassIds = Array.isArray(body.class_ids)
      ? body.class_ids
      : body.class_id
        ? [body.class_id]
        : [];
    const class_ids = Array.from(
      new Set(rawClassIds.map((value: any) => cleanText(value)).filter(Boolean))
    ) as string[];
    const replace = body.replace === true;

    if (!evaluation_period_id) {
      return NextResponse.json({ error: "평가월을 선택해주세요." }, { status: 400 });
    }

    if (!teacher_id) {
      return NextResponse.json({ error: "선생님을 선택해주세요." }, { status: 400 });
    }

    if (!class_ids.length) {
      return NextResponse.json({ error: "배정할 반을 1개 이상 선택해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const lockedResponse = await rejectIfPeriodLocked(supabase, evaluation_period_id, "선생님-반 배정 저장");
    if (lockedResponse) return lockedResponse;

    if (replace) {
      const existingRes = await supabase
        .from("teacher_class_assignments")
        .select("id, class_id")
        .eq("evaluation_period_id", evaluation_period_id)
        .eq("teacher_id", teacher_id);

      if (existingRes.error) throw existingRes.error;

      const toDeactivate = (existingRes.data || [])
        .filter((row: any) => row.class_id && !class_ids.includes(row.class_id))
        .map((row: any) => row.id);

      if (toDeactivate.length) {
        const deactivateRes = await supabase
          .from("teacher_class_assignments")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("id", toDeactivate);

        if (deactivateRes.error) throw deactivateRes.error;
      }
    }

    const now = new Date().toISOString();
    const rows = class_ids.map((class_id) => ({
      evaluation_period_id,
      teacher_id,
      class_id,
      is_active: true,
      updated_at: now
    }));

    const res = await supabase
      .from("teacher_class_assignments")
      .upsert(rows, { onConflict: "evaluation_period_id,teacher_id,class_id" })
      .select("*, teachers(*), classes(*), evaluation_periods(*)");

    if (res.error) throw res.error;

    await logAction(supabase, guard.admin, "save_teacher_class_assignments", "teacher_class_assignments", teacher_id, {
      evaluation_period_id,
      teacher_id,
      class_ids,
      replace
    });

    return NextResponse.json({
      ok: true,
      assignments: res.data || [],
      message: `선생님-반 배정 ${class_ids.length}건을 저장했습니다.`
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const id = cleanText(body.id);

    if (!id) {
      return NextResponse.json({ error: "수정할 배정 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const currentAssignmentRes = await supabase
      .from("teacher_class_assignments")
      .select("id, evaluation_period_id")
      .eq("id", id)
      .single();
    if (currentAssignmentRes.error) throw currentAssignmentRes.error;

    const lockedResponse = await rejectIfPeriodLocked(supabase, currentAssignmentRes.data.evaluation_period_id, "선생님-반 배정 수정");
    if (lockedResponse) return lockedResponse;

    const updatePayload: any = {
      updated_at: new Date().toISOString()
    };

    if (body.is_active !== undefined) {
      updatePayload.is_active = Boolean(body.is_active);
    }

    // 평가월별 반 표시 이름 (null/빈값이면 전역 반 이름으로 되돌림)
    if (body.class_display_name !== undefined) {
      updatePayload.class_display_name = cleanText(body.class_display_name);
    }

    const res = await supabase
      .from("teacher_class_assignments")
      .update(updatePayload)
      .eq("id", id)
      .select("*, teachers(*), classes(*), evaluation_periods(*)")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, assignment: res.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
