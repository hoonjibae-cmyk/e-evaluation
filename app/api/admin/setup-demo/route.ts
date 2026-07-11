import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const dynamic = "force-dynamic";

const teachers = [
  { teacher_code: "T-LEE", name: "이서영", subject: "영어" },
  { teacher_code: "T-BAE", name: "배승희", subject: "영어" },
  { teacher_code: "T-KIM", name: "김도윤", subject: "영어" },
  { teacher_code: "T-PARK", name: "박지영", subject: "영어" },
  { teacher_code: "T-CHOI", name: "최민호", subject: "영어" }
];

const classes = [
  { name: "M4 화목 > M5 화목", grade: "M", day_pattern: "화목" },
  { name: "M4 월금 > M5 월금", grade: "M", day_pattern: "월금" },
  { name: "윤슬중2 화목", grade: "중2", day_pattern: "화목" },
  { name: "은가람중2 수금", grade: "중2", day_pattern: "수금" }
];

const goodComments = [
  "설명이 이해하기 쉬워요.",
  "질문을 잘 받아주셔서 좋아요.",
  "수업 분위기가 좋아요.",
  "꼼꼼하게 알려주셔서 좋아요."
];

const badComments = [
  "숙제 피드백이 조금 더 빨랐으면 좋겠어요.",
  "어려운 부분을 한 번 더 설명해주시면 좋겠어요.",
  "수업 속도가 조금 빠른 것 같아요."
];

function scoreToLabel(score: number) {
  if (score >= 100) return "매우 만족";
  if (score >= 75) return "만족";
  if (score >= 50) return "보통";
  if (score >= 25) return "불만족";
  return "매우 불만족";
}

function pick<T>(arr: T[], idx: number) {
  return arr[idx % arr.length];
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "run_setup");
  if (!guard.ok) return guard.response;

  try {
    const supabase = getSupabaseAdmin();

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const title = `${now.getMonth() + 1}월 강의평가`;

    const periodRes = await supabase
      .from("evaluation_periods")
      .upsert({ year_month: yearMonth, title, status: "open", is_active: true }, { onConflict: "year_month" })
      .select("*")
      .single();
    if (periodRes.error) throw periodRes.error;
    const period = periodRes.data;

    const teachersRes = await supabase
      .from("teachers")
      .upsert(teachers.map((teacher) => ({ ...teacher, is_active: true })), { onConflict: "teacher_code" })
      .select("*");
    if (teachersRes.error) throw teachersRes.error;
    const teacherRows = teachersRes.data || [];

    const classesRes = await supabase
      .from("classes")
      .upsert(classes.map((classItem) => ({ ...classItem, is_active: true })), { onConflict: "name" })
      .select("*");
    if (classesRes.error) throw classesRes.error;
    const classRows = classesRes.data || [];

    const lee = teacherRows.find((t: any) => t.teacher_code === "T-LEE") || teacherRows[0];

    const assignmentRows: any[] = [];
    for (const classRow of classRows) {
      assignmentRows.push({
        evaluation_period_id: period.id,
        teacher_id: lee.id,
        class_id: classRow.id,
        is_active: true
      });
    }

    for (let i = 1; i < teacherRows.length; i++) {
      const classRow = classRows[i % classRows.length];
      assignmentRows.push({
        evaluation_period_id: period.id,
        teacher_id: teacherRows[i].id,
        class_id: classRow.id,
        is_active: true
      });
    }

    const assignmentsUpsertRes = await supabase
      .from("teacher_class_assignments")
      .upsert(assignmentRows, { onConflict: "evaluation_period_id,teacher_id,class_id" })
      .select("*");
    if (assignmentsUpsertRes.error) throw assignmentsUpsertRes.error;

    const assignmentsRes = await supabase
      .from("teacher_class_assignments")
      .select("*")
      .eq("evaluation_period_id", period.id);
    if (assignmentsRes.error) throw assignmentsRes.error;

    const existingQrLinksRes = await supabase
      .from("teacher_qr_links")
      .select("*")
      .eq("evaluation_period_id", period.id);
    if (existingQrLinksRes.error) throw existingQrLinksRes.error;

    const existingQrSet = new Set(
      (existingQrLinksRes.data || []).map((link: any) => `${link.teacher_id}:${link.class_id || ""}`)
    );

    const qrRowsToInsert = (assignmentsRes.data || [])
      .filter((assignment: any) => !existingQrSet.has(`${assignment.teacher_id}:${assignment.class_id || ""}`))
      .map((assignment: any) => ({
        evaluation_period_id: period.id,
        teacher_id: assignment.teacher_id,
        class_id: assignment.class_id,
        link_scope: "teacher_class",
        title: `${title} QR`,
        is_active: true
      }));

    if (qrRowsToInsert.length > 0) {
      const qrInsertRes = await supabase.from("teacher_qr_links").insert(qrRowsToInsert);
      if (qrInsertRes.error) throw qrInsertRes.error;
    }

    const qrLinksRes = await supabase
      .from("teacher_qr_links")
      .select("*")
      .eq("evaluation_period_id", period.id);
    if (qrLinksRes.error) throw qrLinksRes.error;

    const questionsRes = await supabase
      .from("evaluation_questions")
      .select("*")
      .order("display_order");
    if (questionsRes.error) throw questionsRes.error;
    const questions = questionsRes.data || [];

    if (questions.length === 0) {
      throw new Error("평가 문항이 없습니다. 먼저 Supabase에서 v0.6 SQL이 정상 실행되었는지 확인해주세요.");
    }

    const responseCountRes = await supabase
      .from("evaluation_responses")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_period_id", period.id);
    if (responseCountRes.error) throw responseCountRes.error;

    if ((responseCountRes.count || 0) === 0) {
      const responseRows: any[] = [];
      let studentIndex = 1;

      for (const link of qrLinksRes.data || []) {
        const isLee = link.teacher_id === lee.id;
        const sampleCount = isLee ? 6 : 4;

        for (let i = 0; i < sampleCount; i++) {
          responseRows.push({
            evaluation_period_id: period.id,
            teacher_id: link.teacher_id,
            class_id: link.class_id,
            teacher_qr_link_id: link.id,
            student_name: `샘플학생${studentIndex}`,
            device_key: `demo-${studentIndex}`,
            is_flagged: i === 0 && !isLee,
            flag_reason: i === 0 && !isLee ? "상품 또는 압박 여부 확인 필요" : null,
            _demo_index: i,
            _demo_student_index: studentIndex,
            _demo_is_lee: isLee
          });
          studentIndex += 1;
        }
      }

      const responseInsertPayload = responseRows.map(({ _demo_index, _demo_student_index, _demo_is_lee, ...row }) => row);

      const responsesInsertRes = await supabase
        .from("evaluation_responses")
        .insert(responseInsertPayload)
        .select("*");
      if (responsesInsertRes.error) throw responsesInsertRes.error;

      const insertedResponses = responsesInsertRes.data || [];
      const answers: any[] = [];

      insertedResponses.forEach((response: any, responseIndex: number) => {
        const meta = responseRows[responseIndex];
        const i = meta?._demo_index || 0;
        const studentIndex = meta?._demo_student_index || responseIndex + 1;
        const isLee = meta?._demo_is_lee;

        questions.forEach((question: any, qIndex: number) => {
          if (question.question_type === "scale_5") {
            const baseScores = isLee ? [100, 100, 75, 100, 75] : [100, 75, 75, 50, 100];
            const score = pick(baseScores, i + qIndex);
            answers.push({
              response_id: response.id,
              question_id: question.id,
              choice_label: scoreToLabel(score),
              score_value: score
            });
            return;
          }

          if (question.question_type === "yes_no") {
            const yes = i === 0 && !isLee;
            answers.push({
              response_id: response.id,
              question_id: question.id,
              choice_label: yes ? "네" : "아니오",
              boolean_value: yes
            });
            return;
          }

          if (question.code === "teacher_good_comment") {
            answers.push({
              response_id: response.id,
              question_id: question.id,
              text_value: pick(goodComments, i + studentIndex)
            });
            return;
          }

          if (question.code === "teacher_bad_comment") {
            answers.push({
              response_id: response.id,
              question_id: question.id,
              text_value: i % 2 === 0 ? pick(badComments, i + studentIndex) : ""
            });
            return;
          }

          if (question.code === "academy_suggestion") {
            answers.push({
              response_id: response.id,
              question_id: question.id,
              text_value: i === 0 ? "학원 시설이 더 쾌적해지면 좋겠어요." : ""
            });
            return;
          }

          answers.push({
            response_id: response.id,
            question_id: question.id,
            text_value: ""
          });
        });
      });

      if (answers.length > 0) {
        const answersRes = await supabase.from("evaluation_answers").insert(answers);
        if (answersRes.error) throw answersRes.error;
      }
    }

    const withdrawalSamples = [4.4, 2.9, 1.9, 5.6, 8.3];
    const metricRows = teacherRows.map((teacher: any, i: number) => ({
      evaluation_period_id: period.id,
      teacher_id: teacher.id,
      withdrawal_rate_percent: withdrawalSamples[i] ?? 3.0,
      withdrawal_rate_input_at: new Date().toISOString()
    }));

    const metricRes = await supabase
      .from("teacher_monthly_metrics")
      .upsert(metricRows, { onConflict: "evaluation_period_id,teacher_id" });
    if (metricRes.error) throw metricRes.error;

    const countRes = await supabase
      .from("evaluation_responses")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_period_id", period.id);

    return NextResponse.json({
      ok: true,
      message: "샘플 데이터가 준비되었습니다.",
      responseCount: countRes.count || 0
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
