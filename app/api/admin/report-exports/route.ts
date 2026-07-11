import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";

const BUCKET_NAME = "teacher-reports";

function safeStorageSegment(value: string) {
  // Supabase Storage object key는 URL 안전한 영문/숫자 중심으로 만드는 것이 가장 안전합니다.
  // 한글 선생님명, 평가월명, 특수문자를 파일 경로에 넣으면 "Invalid key"가 날 수 있어
  // 실제 파일명은 내부 ID와 숫자 timestamp만 사용합니다.
  const safe = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return safe || "unknown";
}

function buildReportStorageKey(evaluationPeriodId: string, teacherId: string) {
  const period = safeStorageSegment(evaluationPeriodId);
  const teacher = safeStorageSegment(teacherId);
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const random = Math.random().toString(36).slice(2, 10);
  return `report-${period}-${teacher}-${timestamp}-${random}.html`;
}

async function ensureReportBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const buckets = await supabase.storage.listBuckets();
  if (buckets.error) throw buckets.error;

  const exists = (buckets.data || []).some((bucket) => bucket.name === BUCKET_NAME);

  if (exists) {
    const updated = await supabase.storage.updateBucket(BUCKET_NAME, {
      public: false,
      allowedMimeTypes: ["text/html", "application/pdf"],
      fileSizeLimit: 1024 * 1024 * 50
    });
    if (updated.error && !String(updated.error.message || "").toLowerCase().includes("not found")) {
      throw updated.error;
    }
    return;
  }

  const created = await supabase.storage.createBucket(BUCKET_NAME, {
    public: false,
    allowedMimeTypes: ["text/html", "application/pdf"],
    fileSizeLimit: 1024 * 1024 * 50
  });

  if (created.error && !String(created.error.message || "").toLowerCase().includes("already")) {
    throw created.error;
  }
}

function normalizePages(pages: any, monthCount: any, extra: Record<string, any> = {}) {
  const safePages = pages && typeof pages === "object" ? pages : {};
  const reportTemplate = pages?.reportTemplate || "teacher";
  const isInternalReport = reportTemplate === "internal" || pages?.audience === "director_internal" || pages?.internalOnly === true;
  return {
    ...safePages,
    scoreTable: pages?.scoreTable !== false,
    responseTable: pages?.responseTable !== false,
    evaluationRanking: pages?.evaluationRanking !== false,
    withdrawalRanking: pages?.withdrawalRanking !== false,
    monthCount: Number(monthCount || 3),
    reportTemplate,
    audience: isInternalReport ? "director_internal" : (pages?.audience || "teacher_delivery"),
    internalOnly: isInternalReport,
    savedFormat: "printable-html",
    note: "브라우저에서 PDF로 저장하기 전 서버에 보관한 출력용 결과지 스냅샷입니다.",
    ...extra
  };
}

function isColumnCompatibilityError(error: any) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("pages") ||
    message.includes("status")
  );
}

async function insertExportRow(supabase: ReturnType<typeof getSupabaseAdmin>, row: any) {
  const inserted = await supabase
    .from("teacher_report_exports")
    .insert(row)
    .select("*, teachers(*), evaluation_periods(*)")
    .single();

  if (!inserted.error) return inserted;

  // 오래된 DB 구조가 남아 있는 경우를 대비한 최소 저장 fallback입니다.
  // v0.6 SQL에는 pages/status 컬럼이 있지만, 이전 테스트 DB에 컬럼이 누락된 경우에도
  // 출력 이력 자체는 남길 수 있게 합니다.
  if (!isColumnCompatibilityError(inserted.error)) return inserted;

  const fallbackRow = {
    evaluation_period_id: row.evaluation_period_id,
    teacher_id: row.teacher_id,
    report_type: row.report_type || "monthly_teacher_report",
    file_url: row.file_url || null
  };

  return await supabase
    .from("teacher_report_exports")
    .insert(fallbackRow)
    .select("*, teachers(*), evaluation_periods(*)")
    .single();
}

async function resolveTeacherIdForExport(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  teacherId: string,
  isInternalReport: boolean
) {
  const candidate = String(teacherId || "").trim();

  if (candidate) {
    const existing = await supabase
      .from("teachers")
      .select("id")
      .eq("id", candidate)
      .maybeSingle();

    if (!existing.error && existing.data?.id) return existing.data.id;
    if (!isInternalReport) return candidate;
  }

  if (!isInternalReport) return candidate;

  const activeTeacher = await supabase
    .from("teachers")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!activeTeacher.error && activeTeacher.data?.id) return activeTeacher.data.id;

  const anyTeacher = await supabase
    .from("teachers")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!anyTeacher.error && anyTeacher.data?.id) return anyTeacher.data.id;

  throw new Error("원장 내부 확인용 저장본의 기준 선생님을 찾지 못했습니다. 선생님 관리에서 선생님 1명 이상을 먼저 등록해주세요.");
}

function storageFailurePayload(error: any, stage: string) {
  const detail = toSafeErrorMessage(error);
  const lower = String(detail || "").toLowerCase();
  let suggestion = "초기 세팅의 [저장/발송 환경 점검]을 실행해 Supabase Storage와 테이블 상태를 확인하세요.";

  if (lower.includes("bucket") || lower.includes("storage")) {
    suggestion = "Supabase Storage의 teacher-reports Bucket, PDF/HTML 허용 설정, Service Role Key 권한을 확인하세요.";
  } else if (lower.includes("row-level") || lower.includes("permission") || lower.includes("unauthorized") || lower.includes("jwt")) {
    suggestion = "SUPABASE_SERVICE_ROLE_KEY가 anon/publishable key가 아닌 service_role 또는 Secret key인지 확인하세요.";
  } else if (lower.includes("column") || lower.includes("schema cache") || lower.includes("relation")) {
    suggestion = "supabase 폴더의 최신 SQL을 Supabase SQL Editor에서 실행한 뒤 다시 배포하세요.";
  } else if (lower.includes("invalid key")) {
    suggestion = "Storage 파일 경로에 허용되지 않는 문자가 들어갔을 수 있습니다. v2.6.3에서는 ID 기반 경로로 다시 생성합니다.";
  }

  return {
    storageStatus: "failed",
    failureStage: stage,
    storageError: detail,
    failureSuggestion: suggestion,
    diagnosticsHint: "초기 세팅 > 저장/발송 환경 점검 또는 결과지 생성 화면의 환경 점검 버튼을 실행하세요."
  };
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const {
      evaluationPeriodId,
      teacherId,
      teacherName,
      periodTitle,
      pages,
      monthCount,
      html
    } = body || {};

    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }
    const isInternalReport = pages?.reportTemplate === "internal" || pages?.audience === "director_internal" || pages?.internalOnly === true;

    if (!teacherId && !isInternalReport) {
      return NextResponse.json({ error: "선생님 ID가 없습니다." }, { status: 400 });
    }
    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "저장할 결과지 내용이 없습니다." }, { status: 400 });
    }
    if (html.length > 18 * 1024 * 1024) {
      return NextResponse.json({ error: "결과지 내용이 너무 큽니다. 한 번에 저장할 선생님 수를 줄여주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const resolvedTeacherId = await resolveTeacherIdForExport(supabase, teacherId, isInternalReport);

    const filePath = buildReportStorageKey(String(evaluationPeriodId), String(resolvedTeacherId));

    try {
      await ensureReportBucket(supabase);

      const upload = await supabase.storage.from(BUCKET_NAME).upload(
        filePath,
        Buffer.from(html, "utf8"),
        {
          contentType: "text/html",
          upsert: false
        }
      );

      if (upload.error) throw upload.error;

      const exportInsert = await insertExportRow(supabase, {
        evaluation_period_id: evaluationPeriodId,
        teacher_id: resolvedTeacherId,
        report_type: isInternalReport ? "director_internal_report_snapshot" : "monthly_teacher_report",
        pages: normalizePages(pages, monthCount, {
          storageStatus: "stored",
          reportKind: isInternalReport ? "director_internal_report" : "teacher_report",
          internalAnchorTeacherId: isInternalReport ? resolvedTeacherId : undefined
        }),
        file_url: filePath,
        status: "created"
      });

      if (exportInsert.error) throw exportInsert.error;

      return NextResponse.json({
        ok: true,
        export: exportInsert.data,
        filePath
      });
    } catch (storageOrInsertError: any) {
      // Storage 저장이 실패해도 "저장 시도 이력"은 남깁니다.
      // 그래야 운영자가 출력 이력 탭에서 실패 여부를 확인할 수 있습니다.
      const failedInsert = await insertExportRow(supabase, {
        evaluation_period_id: evaluationPeriodId,
        teacher_id: resolvedTeacherId,
        report_type: isInternalReport ? "director_internal_report_snapshot" : "monthly_teacher_report",
        pages: normalizePages(pages, monthCount, {
          ...storageFailurePayload(storageOrInsertError, "HTML 저장본 Storage 업로드/이력 저장"),
          reportKind: isInternalReport ? "director_internal_report" : "teacher_report",
          internalAnchorTeacherId: isInternalReport ? resolvedTeacherId : undefined
        }),
        file_url: null,
        status: "failed"
      });

      if (failedInsert.error) throw storageOrInsertError;

      return NextResponse.json({
        ok: false,
        warning: "결과지 파일 저장에는 실패했지만, 실패 이력은 출력 이력에 기록했습니다.",
        export: failedInsert.data,
        errorMessage: toSafeErrorMessage(storageOrInsertError),
        failureStage: "HTML 저장본 Storage 업로드/이력 저장",
        suggestion: storageFailurePayload(storageOrInsertError, "HTML 저장본 Storage 업로드/이력 저장").failureSuggestion
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  try {
    const { id, status } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "출력 이력 ID가 없습니다." }, { status: 400 });
    }
    if (!["created", "printed", "failed", "archived"].includes(status)) {
      return NextResponse.json({ error: "변경할 수 없는 상태입니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const updated = await supabase
      .from("teacher_report_exports")
      .update({ status })
      .eq("id", id)
      .select("*, teachers(*), evaluation_periods(*)")
      .single();

    if (updated.error) throw updated.error;

    return NextResponse.json({ ok: true, export: updated.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
