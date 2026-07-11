import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_withdrawal");
  if (!guard.ok) return guard.response;

  try {
    const { evaluationPeriodId, rows } = await request.json();
    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const lockedResponse = await rejectIfPeriodLocked(supabase, evaluationPeriodId, "퇴원율 입력");
    if (lockedResponse) return lockedResponse;

    for (const row of rows || []) {
      const res = await supabase.from("teacher_monthly_metrics").upsert(
        {
          evaluation_period_id: evaluationPeriodId,
          teacher_id: row.teacher_id,
          withdrawal_rate_percent: row.withdrawal_rate_percent,
          withdrawal_rate_input_at: new Date().toISOString()
        },
        { onConflict: "evaluation_period_id,teacher_id" }
      );
      if (res.error) throw res.error;
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
