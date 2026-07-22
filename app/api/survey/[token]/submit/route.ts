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

    // 독립적인 조회 3건을 병렬로 실행합니다. (동시 제출 시 순차 왕복으로 느려지던 문제 완화)
    const hasClassContext = Boolean(qr.evaluation_period_id && qr.teacher_id && qr.class_id);
    const [questionsRes, duplicateRes, asgRes] = await Promise.all([
      supabase.from("evaluation_questions").select("*").eq("is_active", true),
      supabase
        .from("evaluation_responses")
        .select("id, student_name")
        .eq("teacher_qr_link_id", qr.id)
        .neq("is_hidden", true),
      hasClassContext
        ? supabase
            .from("teacher_class_assignments")
            .select("class_display_name")
            .eq("evaluation_period_id", qr.evaluation_period_id)
            .eq("teacher_id", qr.teacher_id)
            .eq("class_id", qr.class_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any)
    ]);
    if (questionsRes.error) throw questionsRes.error;
    if (duplicateRes.error) throw duplicateRes.error;

    const questions = questionsRes.data || [];

    // 같은 이름 재제출만 중복 의심으로 표시합니다. (같은 기기 기준 중복은 사용 안 함)
    const duplicateSuspected = (duplicateRes.data || []).some((row: any) => {
      return row.student_name === studentName;
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

    // 반 이름: 배정의 표시 이름(class_display_name)이 있으면 사용 (위에서 병렬로 미리 조회함)
    let className = qr.classes?.name || "";
    if (asgRes && !asgRes.error && asgRes.data?.class_display_name) {
      className = asgRes.data.class_display_name;
    }

    // QR 응답 수 카운터 갱신은 부가 기능이므로, 실패하거나 느려도 제출 완료를 막지 않습니다.
    try {
      const countRes = await supabase
        .from("evaluation_responses")
        .select("id", { count: "exact", head: true })
        .eq("teacher_qr_link_id", qr.id);
      await supabase
        .from("teacher_qr_links")
        .update({ response_count: countRes.count || 0 })
        .eq("id", qr.id);
    } catch {
      // 카운터 갱신 실패는 무시 (응답 자체는 이미 정상 저장됨)
    }

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
