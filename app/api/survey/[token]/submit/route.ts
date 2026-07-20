import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

function ipHash(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const body = await request.json();
    const studentName = String(body.studentName || "").trim();
    const answers = body.answers || {};
    const deviceKey = String(body.deviceKey || "");

    if (!studentName) {
      return NextResponse.json({ error: "학생 이름을 입력해주세요." }, { status: 400 });
    }

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

    const questionsRes = await supabase.from("evaluation_questions").select("*").eq("is_active", true);
    if (questionsRes.error) throw questionsRes.error;

    const questions = questionsRes.data || [];

    const duplicateRes = await supabase
      .from("evaluation_responses")
      .select("id, student_name, device_key")
      .eq("teacher_qr_link_id", qr.id)
      .neq("is_hidden", true);

    if (duplicateRes.error) throw duplicateRes.error;

    const duplicateSuspected = (duplicateRes.data || []).some((row: any) => {
      return row.student_name === studentName || (deviceKey && row.device_key === deviceKey);
    });

    const pressureAnswer = answers["pressure_or_reward"];
    const pressureFlag = pressureAnswer?.booleanValue === true;

    const responseRes = await supabase
      .from("evaluation_responses")
      .insert({
        evaluation_period_id: qr.evaluation_period_id,
        teacher_id: qr.teacher_id,
        class_id: qr.class_id,
        teacher_qr_link_id: qr.id,
        student_name: studentName,
        device_key: deviceKey,
        ip_hash: ipHash(request),
        user_agent: request.headers.get("user-agent"),
        is_duplicate_suspected: duplicateSuspected,
        duplicate_reason: duplicateSuspected ? "같은 이름 또는 같은 기기 제출 이력이 있습니다." : null,
        is_flagged: pressureFlag,
        flag_reason: pressureFlag ? "상품 또는 강제 압박 있음으로 응답" : null
      })
      .select("*")
      .single();

    if (responseRes.error) throw responseRes.error;

    const answerRows = questions.map((question: any) => {
      const answer = answers[question.code] || {};
      return {
        response_id: responseRes.data.id,
        question_id: question.id,
        choice_label: answer.label || null,
        score_value: answer.score ?? null,
        boolean_value: answer.booleanValue ?? null,
        text_value: answer.text ?? null
      };
    });

    const answersInsertRes = await supabase.from("evaluation_answers").insert(answerRows);
    if (answersInsertRes.error) throw answersInsertRes.error;

    // 이 평가월 배정에 설정된 표시 이름(class_display_name)이 있으면 그 이름을 반 이름으로 사용합니다.
    // (반 이름을 변경한 뒤 제출했는데 이전 이름으로 보이던 문제 수정 — 설문 화면과 동일한 규칙)
    let className = qr.classes?.name || "";
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

    const countRes = await supabase
      .from("evaluation_responses")
      .select("id", { count: "exact", head: true })
      .eq("teacher_qr_link_id", qr.id);

    await supabase
      .from("teacher_qr_links")
      .update({ response_count: countRes.count || 0 })
      .eq("id", qr.id);

    return NextResponse.json({
      ok: true,
      complete: {
        studentName,
        teacherName: qr.teachers?.name || "",
        className,
        submittedAt: responseRes.data.submitted_at
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
