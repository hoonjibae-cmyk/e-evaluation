import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

// 선택 평가월의 응답을 답변 포함해서 반환합니다.
// (부트스트랩에서 전체 기간 응답을 통째로 내려받던 부담을 없애고, 필요한 평가월만 로드)
export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "view_dashboard");
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const periodId = cleanText(searchParams.get("periodId"));
    if (!periodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("evaluation_responses")
      .select("*, teachers(*), classes(*), evaluation_answers(*, evaluation_questions(*))")
      .eq("evaluation_period_id", periodId)
      .order("submitted_at", { ascending: false });

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, periodId, responses: res.data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
