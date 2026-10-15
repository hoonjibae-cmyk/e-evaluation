import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { logAction } from "@/lib/adminGuard";
import { integrationApiKey, integrationRequestAuthorized } from "@/lib/integrationAuth";
import { buildMemo, matchTeachers, parseIncomingRows } from "@/lib/withdrawalRateImport";

export const dynamic = "force-dynamic";

/**
 * 학생 카드가 **월별 퇴원율을 확정**하면 선생님별 퇴원율을 여기로 보낸다 (학생 카드 v1.91.0).
 *
 * 왜 필요한가
 * ----------
 * 선생님별 퇴원율은 학생 카드가 담임 배정 이력으로 계산한다. 그 숫자를 사람이 다시 여기 입력하면
 * 반드시 늦거나 틀린다. 학생 카드에서 그 달을 확정하는 순간 같은 숫자가 여기 선생님별 퇴원율 칸에
 * 들어가게 한다 — 관리자 화면에서 직접 입력한 것과 같은 자리(`teacher_monthly_metrics`)다.
 *
 * 무엇을 받나
 * ----------
 *   { yearMonth: "2026-09", source: "student-card", confirmedBy, confirmedAt,
 *     rows: [{ teacher: "이서영", withdrawalRatePercent: 4.2, adjustedRatePercent, special, counts: {a,b,c,d,e,g}, department }] }
 * 평가월은 `year_month` 로 찾는다 — 아직 없는 달이면 만들지 않고 404 로 알린다 (평가월은 사람이 만든다).
 * 잠긴 평가월은 423. 선생님은 이름으로 맞추고, 못 맞춘 이름은 `unmatched` 로 돌려준다.
 *
 * 인증 — x-api-key: STUDENT_CARD_API_KEY (또는 Authorization: Bearer). 서버끼리 부르는 창구다.
 */
export async function POST(request: NextRequest) {
  if (!integrationApiKey()) {
    return NextResponse.json({ error: "연동 창구가 켜져 있지 않습니다. STUDENT_CARD_API_KEY 를 설정하세요." }, { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  const provided = request.headers.get("x-api-key") || auth.replace(/^Bearer\s+/i, "");
  if (!integrationRequestAuthorized(provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}) as any);
    const yearMonth = String(body?.yearMonth ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: "yearMonth 는 YYYY-MM 이어야 합니다." }, { status: 400 });
    }
    const rows = parseIncomingRows(body?.rows);

    const supabase = getSupabaseAdmin();
    const periodRes = await supabase
      .from("evaluation_periods")
      .select("id, title, year_month, is_locked")
      .eq("year_month", yearMonth)
      .maybeSingle();
    if (periodRes.error) throw periodRes.error;
    if (!periodRes.data) {
      return NextResponse.json(
        { error: `e강의평가에 ${yearMonth} 평가월이 아직 없습니다. 관리자 화면에서 평가월을 먼저 만든 뒤 학생 카드에서 '다시 보내기' 를 눌러 주세요.` },
        { status: 404 }
      );
    }
    if (periodRes.data.is_locked) {
      return NextResponse.json(
        { error: `${periodRes.data.title || yearMonth} 평가월은 잠금 상태입니다. 운영 안전 탭에서 잠금을 해제한 뒤 다시 보내 주세요.` },
        { status: 423 }
      );
    }

    const teachersRes = await supabase.from("teachers").select("id, name, display_name, is_active").eq("is_active", true);
    if (teachersRes.error) throw teachersRes.error;
    const { matched, unmatched, skipped } = matchTeachers(rows, teachersRes.data || []);

    const inputAt = new Date().toISOString();
    for (const m of matched) {
      const res = await supabase.from("teacher_monthly_metrics").upsert(
        {
          evaluation_period_id: periodRes.data.id,
          teacher_id: m.teacherId,
          withdrawal_rate_percent: m.row.withdrawalRatePercent,
          withdrawal_rate_memo: buildMemo(m.row, { yearMonth, confirmedBy: body?.confirmedBy, confirmedAt: body?.confirmedAt }),
          withdrawal_rate_input_at: inputAt
        },
        { onConflict: "evaluation_period_id,teacher_id" }
      );
      if (res.error) throw res.error;
    }

    await logAction(supabase, null, "integration_withdrawal_rates", "evaluation_period", periodRes.data.id, {
      source: String(body?.source || "student-card"),
      yearMonth,
      updated: matched.length,
      unmatched,
      skipped
    });

    return NextResponse.json({
      ok: true,
      yearMonth,
      periodId: periodRes.data.id,
      periodTitle: periodRes.data.title,
      updated: matched.length,
      matched: matched.map((m) => ({ teacher: m.row.teacher, teacherName: m.teacherName, withdrawalRatePercent: m.row.withdrawalRatePercent })),
      unmatched,
      skipped
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
