import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

// 선택 평가월의 QR을 전체 삭제합니다.
// 응답이 참조하는 teacher_qr_link_id는 on delete set null 이라 응답 데이터는 보존됩니다.
export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_qr");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json().catch(() => ({}));
    const periodId = cleanText(body.evaluationPeriodId || body.evaluation_period_id);
    if (!periodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const lockedResponse = await rejectIfPeriodLocked(supabase, periodId, "QR 삭제");
    if (lockedResponse) return lockedResponse;

    const periodRes = await supabase
      .from("evaluation_periods")
      .select("id, title")
      .eq("id", periodId)
      .single();
    if (periodRes.error) throw periodRes.error;
    const period = periodRes.data;

    const deleteRes = await supabase
      .from("teacher_qr_links")
      .delete({ count: "exact" })
      .eq("evaluation_period_id", periodId)
      .select("id");
    if (deleteRes.error) throw deleteRes.error;

    const deleted = deleteRes.count || 0;

    await logAction(supabase, guard.admin, "qr_delete_all", "evaluation_periods", periodId, {
      title: period.title,
      deleted
    });

    return NextResponse.json({
      ok: true,
      deleted,
      message: `${period.title}의 QR ${deleted}건을 삭제했습니다. 다시 만들려면 'QR 전체 생성'을 눌러주세요. (새 QR은 새 주소로 발급되어 이전 인쇄본은 사용할 수 없습니다.)`
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
