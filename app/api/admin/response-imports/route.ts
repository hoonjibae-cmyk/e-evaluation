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
  const delimiter = line.includes("\t") ? "\t" : ",";
  return line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function parseTable(text: string) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { rows: [] as string[][], hasHeader: false };

  let rows = lines.map(splitLine);
  const first = rows[0].join(" ").toLowerCase();
  const hasHeader =
    first.includes("학생") ||
    first.includes("student") ||
    first.includes("선생") ||
    first.includes("teacher") ||
    first.includes("시설") ||
    first.includes("설명이해");

  if (hasHeader) rows = rows.slice(1);
  return { rows, hasHeader };
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
    "매우 만족": 100,
    "만족": 75,
    "보통": 50,
    "불만족": 25,
    "매우불만족": 0,
    "매우 불만족": 0,
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

function normalizeSubmittedAt(value: any) {
  const raw = cleanText(value);
  if (!raw) return { value: new Date().toISOString(), warning: null as string | null };
  const safe = raw.replace(/\./g, "-").replace(/\s+/g, "T");
  const date = new Date(safe);
  if (Number.isNaN(date.getTime())) {
    return {
      value: new Date().toISOString(),
      warning: `제출시간 "${raw}"을 해석하지 못해 현재 시간으로 저장합니다.`
    };
  }
  return { value: date.toISOString(), warning: null };
}

function makeRowKey(periodId: string, teacherId: string, classId: string, studentName: string) {
  return `${periodId}|${teacherId}|${classId}|${studentName}`.toLowerCase().replace(/\s+/g, "");
}

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

const scoreLabels = [
  "시설",
  "수업시간",
  "클리닉",
  "설명이해",
  "적극도움",
  "과제량",
  "피드백",
  "관심도"
];

const textCodes = [
  "teacher_good_comment",
  "teacher_bad_comment",
  "academy_suggestion"
];

async function validateRows(params: {
  supabase: any;
  evaluationPeriodId: string;
  text: string;
}) {
  const { supabase, evaluationPeriodId, text } = params;
  const parsed = parseTable(text);
  const rows = parsed.rows;

  const [teachersRes, classesRes, questionsRes, existingRes] = await Promise.all([
    supabase.from("teachers").select("id, name, teacher_code").eq("is_active", true),
    supabase.from("classes").select("id, name").eq("is_active", true),
    supabase.from("evaluation_questions").select("id, code, question_type").eq("is_active", true),
    supabase
      .from("evaluation_responses")
      .select("id, student_name, teacher_id, class_id, import_batch_id")
      .eq("evaluation_period_id", evaluationPeriodId)
      .neq("is_hidden", true)
  ]);

  if (teachersRes.error) throw teachersRes.error;
  if (classesRes.error) throw classesRes.error;
  if (questionsRes.error) throw questionsRes.error;
  if (existingRes.error) throw existingRes.error;

  const teachers = teachersRes.data || [];
  const classes = classesRes.data || [];
  const questionByCode = new Map((questionsRes.data || []).map((q: any) => [q.code, q]));

  const existingKeys = new Set<string>();
  for (const r of existingRes.data || []) {
    if (r.teacher_id && r.class_id && r.student_name) {
      existingKeys.add(makeRowKey(evaluationPeriodId, r.teacher_id, r.class_id, r.student_name));
    }
  }

  const uploadKeys = new Map<string, number>();
  const previewRows: any[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 1;
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
    ] = row;

    const errors: string[] = [];
    const warnings: string[] = [];
    const studentName = cleanText(studentNameRaw);
    const teacherKey = cleanText(teacherKeyRaw);
    const className = cleanText(classNameRaw);

    if (!studentName) errors.push("학생 이름이 비어 있습니다.");
    if (!teacherKey) errors.push("선생님이 비어 있습니다.");
    if (!className) errors.push("반 이름이 비어 있습니다.");

    const matchingTeachers = teacherKey
      ? teachers.filter((teacher: any) => teacher.name === teacherKey || teacher.teacher_code === teacherKey)
      : [];

    if (teacherKey && !matchingTeachers.length) errors.push(`선생님을 찾을 수 없습니다. (${teacherKey})`);
    if (matchingTeachers.length > 1) errors.push(`같은 이름의 선생님이 여러 명입니다. 식별코드로 입력해주세요. (${teacherKey})`);

    const classItem = className ? classes.find((item: any) => item.name === className) : null;
    if (className && !classItem) errors.push(`반을 찾을 수 없습니다. (${className})`);

    const teacher = matchingTeachers[0] || null;
    const scoreInputs = [facilityRaw, classTimeRaw, clinicRaw, explanationRaw, helpfulnessRaw, homeworkRaw, feedbackRaw, attentionRaw];
    const scores = scoreInputs.map(parseScoreInput);

    scores.forEach((score, scoreIdx) => {
      const raw = cleanText(scoreInputs[scoreIdx]);
      if (raw && score === null) errors.push(`${scoreLabels[scoreIdx]} 점수값을 해석하지 못했습니다. (${raw})`);
      if (!raw) warnings.push(`${scoreLabels[scoreIdx]} 점수가 비어 있어 해당 문항은 빈 답변으로 처리됩니다.`);
    });

    const teacherScoreCount = scores.slice(3).filter((score) => score !== null).length;
    if (teacherScoreCount === 0) errors.push("선생님 평가 5개 문항 점수가 모두 비어 있습니다.");

    const submittedAt = normalizeSubmittedAt(submittedAtRaw);
    if (submittedAt.warning) warnings.push(submittedAt.warning);

    const pressure = parseYesNo(pressureRaw);
    if (pressure) warnings.push("상품/압박 있음 응답입니다. 검토 필요 응답으로 저장됩니다.");

    let duplicate = false;
    let duplicateReason: string | null = null;
    if (teacher?.id && classItem?.id && studentName) {
      const key = makeRowKey(evaluationPeriodId, teacher.id, classItem.id, studentName);
      const firstUploadRow = uploadKeys.get(key);
      if (existingKeys.has(key)) {
        duplicate = true;
        duplicateReason = "같은 평가월/선생님/반/학생 이름의 기존 응답이 이미 있습니다.";
        warnings.push(duplicateReason);
      }
      if (firstUploadRow) {
        duplicate = true;
        duplicateReason = `업로드 파일 안에서 ${firstUploadRow}번째 줄과 중복됩니다.`;
        warnings.push(duplicateReason);
      } else {
        uploadKeys.set(key, rowNumber);
      }
    }

    const status = errors.length ? "error" : warnings.length ? "warning" : "valid";

    previewRows.push({
      rowNumber,
      status,
      errors,
      warnings,
      duplicate,
      duplicateReason,
      raw: row,
      studentName,
      teacherKey,
      className,
      teacherId: teacher?.id || null,
      teacherName: teacher?.name || teacherKey,
      classId: classItem?.id || null,
      classResolvedName: classItem?.name || className,
      scores,
      pressure,
      submittedAt: submittedAt.value,
      goodComment: cleanText(goodRaw),
      badComment: cleanText(badRaw),
      academySuggestion: cleanText(suggestionRaw),
      questionByCodeAvailable: Object.fromEntries(scoreCodes.concat(["pressure_or_reward", ...textCodes]).map((code) => [code, Boolean(questionByCode.get(code))]))
    });
  });

  const summary = {
    rawRowCount: rows.length,
    validRowCount: previewRows.filter((r) => r.status !== "error").length,
    errorRowCount: previewRows.filter((r) => r.status === "error").length,
    warningRowCount: previewRows.filter((r) => r.warnings.length).length,
    duplicateRowCount: previewRows.filter((r) => r.duplicate).length
  };

  return { rows: previewRows, summary, questionByCode };
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const mode = cleanText(body.mode) || "preview";
    const text = String(body.text || "");
    const evaluationPeriodId = cleanText(body.evaluationPeriodId);
    const sourceLabel = cleanText(body.sourceLabel) || "레거시/비상용 응답 업로드";
    const memo = cleanText(body.memo);

    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "설문 응답을 업로드할 평가월을 선택해주세요." }, { status: 400 });
    }
    if (!text.trim()) {
      return NextResponse.json({ error: "붙여넣은 응답 데이터가 없습니다." }, { status: 400 });
    }
    if (!["preview", "commit"].includes(String(mode))) {
      return NextResponse.json({ error: "처리 방식이 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (mode === "commit") {
      const lockedResponse = await rejectIfPeriodLocked(supabase, evaluationPeriodId, "응답 업로드");
      if (lockedResponse) return lockedResponse;
    }

    const validation = await validateRows({ supabase, evaluationPeriodId, text });

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode,
        ...validation,
        message: `미리보기 완료: 전체 ${validation.summary.rawRowCount}줄, 업로드 가능 ${validation.summary.validRowCount}줄, 오류 ${validation.summary.errorRowCount}줄, 확인 필요 ${validation.summary.warningRowCount}줄`
      });
    }

    const now = new Date().toISOString();

    const batchInsert = await supabase
      .from("response_import_batches")
      .insert({
        evaluation_period_id: evaluationPeriodId,
        source_label: sourceLabel,
        raw_row_count: validation.summary.rawRowCount,
        valid_row_count: validation.summary.validRowCount,
        error_row_count: validation.summary.errorRowCount,
        warning_row_count: validation.summary.warningRowCount,
        duplicate_row_count: validation.summary.duplicateRowCount,
        status: validation.summary.errorRowCount === validation.summary.rawRowCount ? "failed" : "imported",
        memo,
        created_by: guard.admin.adminId,
        completed_at: now
      })
      .select("id")
      .single();

    if (batchInsert.error) throw batchInsert.error;
    const batchId = batchInsert.data.id;

    const errorRows = validation.rows.flatMap((row: any) => {
      const items: any[] = [];
      for (const message of row.errors || []) {
        items.push({
          batch_id: batchId,
          evaluation_period_id: evaluationPeriodId,
          row_number: row.rowNumber,
          severity: "error",
          error_type: "validation",
          message,
          row_data: row.raw
        });
      }
      for (const message of row.warnings || []) {
        items.push({
          batch_id: batchId,
          evaluation_period_id: evaluationPeriodId,
          row_number: row.rowNumber,
          severity: "warning",
          error_type: row.duplicate ? "duplicate_or_warning" : "warning",
          message,
          row_data: row.raw
        });
      }
      return items;
    });

    if (errorRows.length) {
      const errorsInsert = await supabase.from("response_import_errors").insert(errorRows);
      if (errorsInsert.error) throw errorsInsert.error;
    }

    let imported = 0;
    const questionByCode = validation.questionByCode as Map<string, any>;

    for (const row of validation.rows as any[]) {
      if (row.status === "error") continue;

      const responseInsert = await supabase
        .from("evaluation_responses")
        .insert({
          evaluation_period_id: evaluationPeriodId,
          teacher_id: row.teacherId,
          class_id: row.classId,
          student_name: row.studentName,
          submitted_at: row.submittedAt,
          device_key: `import-${batchId}-${row.rowNumber}`,
          user_agent: "admin-response-import",
          is_duplicate_suspected: row.duplicate,
          duplicate_reason: row.duplicateReason,
          is_flagged: row.pressure,
          flag_reason: row.pressure ? "강의평가 관련 상품 또는 압박 있음으로 업로드됨" : null,
          admin_note: `응답 업로드로 등록됨 · ${sourceLabel}`,
          import_batch_id: batchId,
          import_source: "bulk_upload",
          import_row_number: row.rowNumber,
          imported_by: guard.admin.adminId
        })
        .select("id")
        .single();

      if (responseInsert.error) throw responseInsert.error;
      const responseId = responseInsert.data.id;
      const answerRows: any[] = [];

      for (let idx = 0; idx < scoreCodes.length; idx++) {
        const code = scoreCodes[idx];
        const q: any = questionByCode.get(code);
        if (!q) continue;
        const score = row.scores[idx];
        if (score === null || score === undefined) continue;
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
          boolean_value: row.pressure,
          choice_label: row.pressure ? "네" : "아니오"
        });
      }

      const textInputs = [row.goodComment, row.badComment, row.academySuggestion];
      for (let idx = 0; idx < textCodes.length; idx++) {
        const q: any = questionByCode.get(textCodes[idx]);
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
      imported += 1;
    }

    const batchUpdate = await supabase
      .from("response_import_batches")
      .update({
        imported_response_count: imported,
        status: imported > 0 ? "imported" : "failed"
      })
      .eq("id", batchId);

    if (batchUpdate.error) throw batchUpdate.error;

    await logAction(supabase, guard.admin, "response_import_commit", "response_import_batches", batchId, {
      evaluationPeriodId,
      imported,
      summary: validation.summary
    });

    return NextResponse.json({
      ok: true,
      mode,
      batchId,
      imported,
      summary: { ...validation.summary, importedResponseCount: imported },
      rows: validation.rows.slice(0, 200),
      message: `응답 업로드 완료: ${imported}건 저장, 오류 ${validation.summary.errorRowCount}줄, 확인 필요 ${validation.summary.warningRowCount}줄`
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
