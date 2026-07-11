import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin();

    const qrRes = await supabase
      .from("teacher_qr_links")
      .select("*, teachers(*), classes(*), evaluation_periods(*)")
      .eq("token", params.token)
      .eq("is_active", true)
      .single();

    if (qrRes.error || !qrRes.data) {
      return NextResponse.json({ error: "유효하지 않은 QR 링크입니다." }, { status: 404 });
    }

    const qr = qrRes.data;

    if (qr.evaluation_periods?.status !== "open") {
      return NextResponse.json({ error: "현재 응답 가능한 평가가 아닙니다." }, { status: 403 });
    }

    if (qr.evaluation_periods?.is_locked) {
      return NextResponse.json({ error: "이 평가월은 마감 잠금 상태라 더 이상 응답할 수 없습니다." }, { status: 403 });
    }

    if (qr.expires_at && new Date(qr.expires_at) < new Date()) {
      return NextResponse.json({ error: "만료된 QR 링크입니다." }, { status: 403 });
    }

    await supabase
      .from("teacher_qr_links")
      .update({ view_count: (qr.view_count || 0) + 1 })
      .eq("id", qr.id);

    const questionsRes = await supabase
      .from("evaluation_questions")
      .select("*")
      .eq("is_active", true)
      .order("display_order");

    if (questionsRes.error) throw questionsRes.error;

    // 이 평가월 배정에 설정된 표시 이름이 있으면 그것을 반 이름으로 사용
    let className = qr.classes?.name || null;
    if (qr.evaluation_period_id && qr.teacher_id && qr.class_id) {
      const asgRes = await supabase
        .from("teacher_class_assignments")
        .select("class_display_name")
        .eq("evaluation_period_id", qr.evaluation_period_id)
        .eq("teacher_id", qr.teacher_id)
        .eq("class_id", qr.class_id)
        .maybeSingle();
      if (!asgRes.error && asgRes.data?.class_display_name) {
        className = asgRes.data.class_display_name;
      }
    }

    return NextResponse.json({
      qr: { id: qr.id, token: qr.token },
      teacher: qr.teachers,
      classItem: qr.classes ? { ...qr.classes, name: className } : qr.classes,
      period: qr.evaluation_periods,
      questions: questionsRes.data || []
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
