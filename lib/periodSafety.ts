import { NextResponse } from "next/server";

export async function getPeriodSafety(supabase: any, periodId: string) {
  if (!periodId) return { period: null, error: "평가월 ID가 없습니다." };
  const res = await supabase
    .from("evaluation_periods")
    .select("id, title, year_month, status, is_locked, locked_reason")
    .eq("id", periodId)
    .single();

  if (res.error || !res.data) {
    return { period: null, error: "평가월을 찾을 수 없습니다." };
  }

  return { period: res.data, error: null as string | null };
}

export async function rejectIfPeriodLocked(supabase: any, periodId: string, actionLabel = "이 작업") {
  const safety = await getPeriodSafety(supabase, periodId);
  if (safety.error) {
    return NextResponse.json({ error: safety.error }, { status: 400 });
  }
  if (safety.period?.is_locked) {
    return NextResponse.json(
      {
        error: `${safety.period.title || "선택한 평가월"}은 잠금 상태입니다. ${actionLabel}을 진행하려면 운영 안전 탭에서 잠금을 먼저 해제해주세요.`
      },
      { status: 423 }
    );
  }
  return null;
}
