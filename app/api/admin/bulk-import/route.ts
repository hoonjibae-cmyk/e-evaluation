import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function splitLine(line: string) {
  // 엑셀/구글시트에서 복사하면 보통 탭(\t)으로 들어옵니다.
  // 직접 쉼표로 작성한 경우도 받을 수 있게 처리합니다.
  const delimiter = line.includes("\t") ? "\t" : ",";
  return line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function parseTable(text: string) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  let rows = lines.map(splitLine);

  const first = rows[0].join(" ").toLowerCase();
  const looksLikeHeader =
    first.includes("선생") ||
    first.includes("teacher") ||
    first.includes("반") ||
    first.includes("class") ||
    first.includes("식별") ||
    first.includes("코드");

  if (looksLikeHeader) {
    rows = rows.slice(1);
  }

  return rows;
}

function normalizeKey(value: any) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function parseScoreInput(value: any) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const normalized = normalizeKey(text);
  const labelScoreMap: Record<string, number> = {
    "매우만족": 100,
    "만족": 75,
    "보통": 50,
    "불만족": 25,
    "매우불만족": 0,
    "5": 100,
    "4": 75,
    "3": 50,
    "2": 25,
    "1": 0,
    "100": 100,
    "75": 75,
    "50": 50,
    "25": 25,
    "0": 0
  };

  if (labelScoreMap[normalized] !== undefined) return labelScoreMap[normalized];

  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  if (num > 5) return Math.max(0, Math.min(100, num));
  return { 5: 100, 4: 75, 3: 50, 2: 25, 1: 0 }[Math.round(num)] ?? null;
}

function scoreLabel(score: number | null) {
  if (score === null || score === undefined) return null;
  if (score >= 100) return "매우 만족";
  if (score >= 75) return "만족";
  if (score >= 50) return "보통";
  if (score >= 25) return "불만족";
  return "매우 불만족";
}

function parseYesNo(value: any) {
  const text = normalizeKey(value);
  if (!text) return false;
  if (["예", "네", "yes", "y", "true", "1", "있음", "있다", "o", "○"].includes(text)) return true;
  return false;
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const type = cleanText(body.type);
    const text = String(body.text || "");
    const evaluationPeriodId = cleanText(body.evaluationPeriodId);

    if (!type || !["teachers", "classes", "assignments", "responses"].includes(type)) {
      return NextResponse.json({ error: "가져오기 종류가 올바르지 않습니다." }, { status: 400 });
    }

    const rows = parseTable(text);

    if (!rows.length) {
      return NextResponse.json({ error: "붙여넣은 데이터가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if ((type === "assignments" || type === "responses") && evaluationPeriodId) {
      const lockedResponse = await rejectIfPeriodLocked(supabase, evaluationPeriodId, type === "assignments" ? "선생님-반 배정 일괄 등록" : "응답 일괄 등록");
      if (lockedResponse) return lockedResponse;
    }

    if (type === "teachers") {
      let created = 0;
      let updated = 0;
      const skipped: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const [nameRaw, subjectRaw, codeRaw, memoRaw] = rows[i];
        const name = cleanText(nameRaw);
        const subject = cleanText(subjectRaw) || "영어";
        const teacher_code = cleanText(codeRaw);
        const memo = cleanText(memoRaw);

        if (!name) {
          skipped.push(`${i + 1}번째 줄: 선생님 이름이 비어 있습니다.`);
          continue;
        }

        if (teacher_code) {
          const res = await supabase
            .from("teachers")
            .upsert(
              { teacher_code, name, subject, memo, is_active: true, updated_at: new Date().toISOString() },
              { onConflict: "teacher_code" }
            )
            .select("id")
            .single();

          if (res.error) throw res.error;
          // upsert는 생성/수정 구분이 어렵기 때문에 아래 조회로 기존 여부를 엄격히 나누지 않습니다.
          updated += 1;
          continue;
        }

        const existing = await supabase
          .from("teachers")
          .select("id")
          .eq("name", name)
          .limit(2);

        if (existing.error) throw existing.error;

        if ((existing.data || []).length > 1) {
          skipped.push(`${i + 1}번째 줄: 같은 이름의 선생님이 여러 명입니다. 식별코드를 함께 입력해주세요. (${name})`);
          continue;
        }

        if (existing.data?.[0]?.id) {
          const res = await supabase
            .from("teachers")
            .update({ name, subject, memo, is_active: true, updated_at: new Date().toISOString() })
            .eq("id", existing.data[0].id);
          if (res.error) throw res.error;
          updated += 1;
        } else {
          const res = await supabase
            .from("teachers")
            .insert({ name, subject, memo, is_active: true });
          if (res.error) throw res.error;
          created += 1;
        }
      }

      return NextResponse.json({
        ok: true,
        type,
        created,
        updated,
        skipped,
        message: `선생님 일괄 등록 완료: 신규 ${created}명, 갱신 ${updated}명, 건너뜀 ${skipped.length}건`
      });
    }

    if (type === "classes") {
      let processed = 0;
      const skipped: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const [nameRaw, gradeRaw, dayPatternRaw, campusRaw, memoRaw] = rows[i];
        const name = cleanText(nameRaw);

        if (!name) {
          skipped.push(`${i + 1}번째 줄: 반 이름이 비어 있습니다.`);
          continue;
        }

        const res = await supabase
          .from("classes")
          .upsert(
            {
              name,
              grade: cleanText(gradeRaw),
              day_pattern: cleanText(dayPatternRaw),
              campus: cleanText(campusRaw),
              memo: cleanText(memoRaw),
              is_active: true,
              updated_at: new Date().toISOString()
            },
            { onConflict: "name" }
          );

        if (res.error) throw res.error;
        processed += 1;
      }

      return NextResponse.json({
        ok: true,
        type,
        created: processed,
        updated: 0,
        skipped,
        message: `반 일괄 등록 완료: 처리 ${processed}개, 건너뜀 ${skipped.length}건`
      });
    }

    if (type === "assignments") {
      if (!evaluationPeriodId) {
        return NextResponse.json({ error: "선생님-반 배정은 평가월을 먼저 선택해야 합니다." }, { status: 400 });
      }

      const teachersRes = await supabase
        .from("teachers")
        .select("id, name, teacher_code")
        .eq("is_active", true);

      if (teachersRes.error) throw teachersRes.error;

      const classesRes = await supabase
        .from("classes")
        .select("id, name")
        .eq("is_active", true);

      if (classesRes.error) throw classesRes.error;

      const teachers = teachersRes.data || [];
      const classes = classesRes.data || [];

      let processed = 0;
      const skipped: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const [teacherKeyRaw, classNameRaw] = rows[i];
        const teacherKey = cleanText(teacherKeyRaw);
        const className = cleanText(classNameRaw);

        if (!teacherKey || !className) {
          skipped.push(`${i + 1}번째 줄: 선생님 또는 반 이름이 비어 있습니다.`);
          continue;
        }

        const matchingTeachers = teachers.filter((teacher: any) => {
          return teacher.name === teacherKey || teacher.teacher_code === teacherKey;
        });

        if (!matchingTeachers.length) {
          skipped.push(`${i + 1}번째 줄: 선생님을 찾을 수 없습니다. (${teacherKey})`);
          continue;
        }

        if (matchingTeachers.length > 1) {
          skipped.push(`${i + 1}번째 줄: 같은 이름의 선생님이 여러 명입니다. 식별코드로 입력해주세요. (${teacherKey})`);
          continue;
        }

        const classItem = classes.find((item: any) => item.name === className);
        if (!classItem) {
          skipped.push(`${i + 1}번째 줄: 반을 찾을 수 없습니다. (${className})`);
          continue;
        }

        const res = await supabase
          .from("teacher_class_assignments")
          .upsert(
            {
              evaluation_period_id: evaluationPeriodId,
              teacher_id: matchingTeachers[0].id,
              class_id: classItem.id,
              is_active: true,
              updated_at: new Date().toISOString()
            },
            { onConflict: "evaluation_period_id,teacher_id,class_id" }
          );

        if (res.error) throw res.error;
        processed += 1;
      }

      return NextResponse.json({
        ok: true,
        type,
        created: processed,
        updated: 0,
        skipped,
        message: `선생님-반 배정 일괄 등록 완료: 처리 ${processed}건, 건너뜀 ${skipped.length}건`
      });
    }


    if (type === "responses") {
      if (!evaluationPeriodId) {
        return NextResponse.json({ error: "설문 응답 업로드는 평가월을 먼저 선택해야 합니다." }, { status: 400 });
      }

      const [teachersRes, classesRes, questionsRes] = await Promise.all([
        supabase.from("teachers").select("id, name, teacher_code").eq("is_active", true),
        supabase.from("classes").select("id, name").eq("is_active", true),
        supabase.from("evaluation_questions").select("id, code, question_type").eq("is_active", true)
      ]);

      if (teachersRes.error) throw teachersRes.error;
      if (classesRes.error) throw classesRes.error;
      if (questionsRes.error) throw questionsRes.error;

      const teachers = teachersRes.data || [];
      const classes = classesRes.data || [];
      const questionByCode = new Map((questionsRes.data || []).map((q: any) => [q.code, q]));

      const scoreCodes = [
        "facility_satisfaction",
        "class_time_satisfaction",
        "clinic_satisfaction",
        "teacher_explanation",
        "teacher_helpfulness",
        "teacher_homework_amount",
        "teacher_feedback",
        "teacher_attention"
      ];
      const textCodes = [
        "teacher_good_comment",
        "teacher_bad_comment",
        "academy_suggestion"
      ];

      let processed = 0;
      const skipped: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const [
          studentNameRaw,
          teacherKeyRaw,
          classNameRaw,
          facilityRaw,
          classTimeRaw,
          clinicRaw,
          pressureRaw,
          explanationRaw,
          helpfulnessRaw,
          homeworkRaw,
          feedbackRaw,
          attentionRaw,
          goodRaw,
          badRaw,
          suggestionRaw,
          submittedAtRaw
        ] = rows[i];

        const studentName = cleanText(studentNameRaw);
        const teacherKey = cleanText(teacherKeyRaw);
        const className = cleanText(classNameRaw);

        if (!studentName || !teacherKey || !className) {
          skipped.push(`${i + 1}번째 줄: 학생 이름, 선생님, 반 이름은 필수입니다.`);
          continue;
        }

        const matchingTeachers = teachers.filter((teacher: any) => teacher.name === teacherKey || teacher.teacher_code === teacherKey);
        if (!matchingTeachers.length) {
          skipped.push(`${i + 1}번째 줄: 선생님을 찾을 수 없습니다. (${teacherKey})`);
          continue;
        }
        if (matchingTeachers.length > 1) {
          skipped.push(`${i + 1}번째 줄: 같은 이름의 선생님이 여러 명입니다. 식별코드로 입력해주세요. (${teacherKey})`);
          continue;
        }

        const classItem = classes.find((item: any) => item.name === className);
        if (!classItem) {
          skipped.push(`${i + 1}번째 줄: 반을 찾을 수 없습니다. (${className})`);
          continue;
        }

        const teacher = matchingTeachers[0];
        const existingSameName = await supabase
          .from("evaluation_responses")
          .select("id", { count: "exact", head: true })
          .eq("evaluation_period_id", evaluationPeriodId)
          .eq("teacher_id", teacher.id)
          .eq("class_id", classItem.id)
          .eq("student_name", studentName);

        if (existingSameName.error) throw existingSameName.error;

        const pressure = parseYesNo(pressureRaw);
        const submittedAt = cleanText(submittedAtRaw) || new Date().toISOString();

        const responseInsert = await supabase
          .from("evaluation_responses")
          .insert({
            evaluation_period_id: evaluationPeriodId,
            teacher_id: teacher.id,
            class_id: classItem.id,
            student_name: studentName,
            submitted_at: submittedAt,
            device_key: `bulk-upload-${Date.now()}-${i}`,
            user_agent: "admin-bulk-upload",
            is_duplicate_suspected: (existingSameName.count || 0) > 0,
            duplicate_reason: (existingSameName.count || 0) > 0 ? "엑셀 업로드 중 같은 평가월/선생님/반/학생 이름의 기존 응답이 발견되었습니다." : null,
            is_flagged: pressure,
            flag_reason: pressure ? "강의평가 관련 상품 또는 압박 있음으로 업로드됨" : null,
            admin_note: "엑셀 벌크 업로드로 등록된 응답"
          })
          .select("id")
          .single();

        if (responseInsert.error) throw responseInsert.error;

        const responseId = responseInsert.data.id;
        const scoreInputs = [facilityRaw, classTimeRaw, clinicRaw, explanationRaw, helpfulnessRaw, homeworkRaw, feedbackRaw, attentionRaw];
        const answerRows: any[] = [];

        for (let idx = 0; idx < scoreCodes.length; idx++) {
          const code = scoreCodes[idx];
          const q: any = questionByCode.get(code);
          if (!q) continue;
          const score = parseScoreInput(scoreInputs[idx]);
          if (score === null) {
            skipped.push(`${i + 1}번째 줄: ${code} 점수값을 해석하지 못했습니다. 빈 답변으로 저장하지 않았습니다.`);
            continue;
          }
          answerRows.push({
            response_id: responseId,
            question_id: q.id,
            choice_label: scoreLabel(score),
            score_value: score
          });
        }

        const pressureQuestion: any = questionByCode.get("pressure_or_reward");
        if (pressureQuestion) {
          answerRows.push({
            response_id: responseId,
            question_id: pressureQuestion.id,
            boolean_value: pressure,
            choice_label: pressure ? "네" : "아니오"
          });
        }

        const textInputs = [goodRaw, badRaw, suggestionRaw];
        for (let idx = 0; idx < textCodes.length; idx++) {
          const code = textCodes[idx];
          const q: any = questionByCode.get(code);
          const textValue = cleanText(textInputs[idx]);
          if (!q || !textValue) continue;
          answerRows.push({
            response_id: responseId,
            question_id: q.id,
            text_value: textValue
          });
        }

        if (answerRows.length) {
          const answersInsert = await supabase.from("evaluation_answers").insert(answerRows);
          if (answersInsert.error) throw answersInsert.error;
        }

        processed += 1;
      }

      await logAction(supabase, guard.admin, "bulk_import_responses", "evaluation_responses", null, {
        evaluationPeriodId,
        processed,
        skipped: skipped.length
      });

      return NextResponse.json({
        ok: true,
        type,
        created: processed,
        updated: 0,
        skipped,
        message: `설문 응답 벌크 업로드 완료: 등록 ${processed}건, 건너뜀/주의 ${skipped.length}건`
      });
    }

    return NextResponse.json({ error: "처리할 수 없는 가져오기 종류입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
