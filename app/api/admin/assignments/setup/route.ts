import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

// 평가월 배정 세팅용 엔드포인트 (기존 assignments POST/PATCH와 분리해 안전하게 추가)
//  - action "clone": 가장 최근 이전 평가월의 활성 배정을 이 평가월로 전체 복제(표시 이름 스냅샷)
//  - action "add":   반 이름을 입력해 이 평가월에 선생님-반 짝 추가(반은 이름으로 재사용/생성)
export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const action = cleanText(body.action);
    const targetPeriodId = cleanText(body.target_period_id);

    if (!targetPeriodId) {
      return NextResponse.json({ error: "평가월을 선택해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const locked = await rejectIfPeriodLocked(supabase, targetPeriodId, "평가월 배정 세팅");
    if (locked) return locked;

    const now = new Date().toISOString();

    if (action === "clone") {
      // 대상 평가월의 year_month
      const targetRes = await supabase
        .from("evaluation_periods")
        .select("id, year_month")
        .eq("id", targetPeriodId)
        .single();
      if (targetRes.error) throw targetRes.error;
      const targetYm = String(targetRes.data.year_month || "");

      // 이전 평가월들(desc)에서 활성 배정이 있는 가장 최근 것을 소스로
      const periodsRes = await supabase
        .from("evaluation_periods")
        .select("id, year_month, title")
        .order("year_month", { ascending: false });
      if (periodsRes.error) throw periodsRes.error;

      const candidates = (periodsRes.data || []).filter(
        (p: any) => String(p.year_month || "") < targetYm
      );

      let source: any = null;
      for (const candidate of candidates) {
        const cnt = await supabase
          .from("teacher_class_assignments")
          .select("id", { count: "exact", head: true })
          .eq("evaluation_period_id", candidate.id)
          .eq("is_active", true);
        if (cnt.error) throw cnt.error;
        if ((cnt.count || 0) > 0) {
          source = candidate;
          break;
        }
      }

      if (!source) {
        return NextResponse.json({
          ok: true,
          cloned: 0,
          message: "복제할 이전 평가월 배정이 없습니다. 아래에서 직접 추가해주세요."
        });
      }

      const srcRes = await supabase
        .from("teacher_class_assignments")
        .select("teacher_id, class_id, class_display_name, classes(name)")
        .eq("evaluation_period_id", source.id)
        .eq("is_active", true);
      if (srcRes.error) throw srcRes.error;

      // 이미 이 평가월에 있는 (선생님,반) 짝은 사용자가 편집했을 수 있으므로 건드리지 않고 새 짝만 추가
      const existingRes = await supabase
        .from("teacher_class_assignments")
        .select("teacher_id, class_id")
        .eq("evaluation_period_id", targetPeriodId);
      if (existingRes.error) throw existingRes.error;
      const existingSet = new Set(
        (existingRes.data || []).map((r: any) => `${r.teacher_id}|${r.class_id}`)
      );

      const rows = (srcRes.data || [])
        .filter((a: any) => !existingSet.has(`${a.teacher_id}|${a.class_id}`))
        .map((a: any) => ({
          evaluation_period_id: targetPeriodId,
          teacher_id: a.teacher_id,
          class_id: a.class_id,
          is_active: true,
          class_display_name: a.class_display_name ?? a.classes?.name ?? null,
          updated_at: now
        }));

      if (rows.length) {
        const insertRes = await supabase
          .from("teacher_class_assignments")
          .upsert(rows, { onConflict: "evaluation_period_id,teacher_id,class_id" });
        if (insertRes.error) throw insertRes.error;
      }

      await logAction(supabase, guard.admin, "clone_assignments", "teacher_class_assignments", targetPeriodId, {
        sourcePeriodId: source.id,
        cloned: rows.length
      });

      return NextResponse.json({
        ok: true,
        cloned: rows.length,
        sourceTitle: source.title,
        message: rows.length
          ? `${source.title} 배정 ${rows.length}건을 이 평가월로 불러왔습니다. 필요하면 반 이름을 바꾸거나 추가하세요.`
          : `${source.title} 배정이 이미 모두 반영되어 있습니다.`
      });
    }

    if (action === "add") {
      const teacherId = cleanText(body.teacher_id);
      const className = cleanText(body.class_name);
      if (!teacherId) return NextResponse.json({ error: "선생님을 선택해주세요." }, { status: 400 });
      if (!className) return NextResponse.json({ error: "반 이름을 입력해주세요." }, { status: 400 });

      // 반은 이름 기준으로 재사용/생성 (전역 classes)
      const classRes = await supabase
        .from("classes")
        .upsert({ name: className, is_active: true, updated_at: now }, { onConflict: "name" })
        .select("id")
        .single();
      if (classRes.error) throw classRes.error;
      const classId = classRes.data.id;

      const assignRes = await supabase
        .from("teacher_class_assignments")
        .upsert(
          {
            evaluation_period_id: targetPeriodId,
            teacher_id: teacherId,
            class_id: classId,
            is_active: true,
            class_display_name: className,
            updated_at: now
          },
          { onConflict: "evaluation_period_id,teacher_id,class_id" }
        )
        .select("*, teachers(*), classes(*), evaluation_periods(*)")
        .single();
      if (assignRes.error) throw assignRes.error;

      await logAction(supabase, guard.admin, "add_assignment_pair", "teacher_class_assignments", assignRes.data.id, {
        targetPeriodId,
        teacherId,
        className
      });

      return NextResponse.json({ ok: true, assignment: assignRes.data, message: "선생님-반을 추가했습니다." });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
