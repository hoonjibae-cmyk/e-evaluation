import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME = "teacher-reports";

function safeStorageSegment(value: string) {
  const safe = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return safe || "unknown";
}

function buildPdfStorageKey(evaluationPeriodId: string, teacherId: string) {
  const period = safeStorageSegment(evaluationPeriodId);
  const teacher = safeStorageSegment(teacherId);
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const random = Math.random().toString(36).slice(2, 10);
  return `pdf-report-${period}-${teacher}-${timestamp}-${random}.pdf`;
}

async function ensureReportBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const buckets = await supabase.storage.listBuckets();
  if (buckets.error) throw buckets.error;

  const exists = (buckets.data || []).some((bucket) => bucket.name === BUCKET_NAME);

  if (!exists) {
    const created = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      allowedMimeTypes: ["text/html", "application/pdf"],
      fileSizeLimit: 1024 * 1024 * 50
    });

    if (created.error && !String(created.error.message || "").toLowerCase().includes("already")) {
      throw created.error;
    }
    return;
  }

  // v1.4에서 만든 저장공간은 text/html만 허용했을 수 있습니다.
  // v1.7에서는 PDF도 저장해야 하므로 저장공간 설정을 안전하게 갱신합니다.
  const updated = await supabase.storage.updateBucket(BUCKET_NAME, {
    public: false,
    allowedMimeTypes: ["text/html", "application/pdf"],
    fileSizeLimit: 1024 * 1024 * 50
  });

  if (updated.error && !String(updated.error.message || "").toLowerCase().includes("not found")) {
    throw updated.error;
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
    savedFormat: "pdf",
    note: "브라우저에서 자동 생성해 서버에 저장한 PDF 결과지입니다.",
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

  if (!isColumnCompatibilityError(inserted.error)) return inserted;

  const fallbackRow = {
    evaluation_period_id: row.evaluation_period_id,
    teacher_id: row.teacher_id,
    report_type: row.report_type || "monthly_teacher_report_pdf",
    file_url: row.file_url || null
  };

  return await supabase
    .from("teacher_report_exports")
    .insert(fallbackRow)
    .select("*, teachers(*), evaluation_periods(*)")
    .single();
}

async function resolveTeacherIdForPdfExport(
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

  throw new Error("원장 내부 확인용 PDF 저장용 기준 선생님을 찾지 못했습니다. 선생님 관리에서 선생님 1명 이상을 먼저 등록해주세요.");
}

function storageFailurePayload(error: any, stage: string) {
  const detail = toSafeErrorMessage(error);
  const lower = String(detail || "").toLowerCase();
  let suggestion = "초기 세팅의 [저장/발송 환경 점검]을 실행해 Supabase Storage와 테이블 상태를 확인하세요.";

  if (lower.includes("bucket") || lower.includes("storage")) {
    suggestion = "Supabase Storage의 teacher-reports Bucket, PDF 허용 설정, Service Role Key 권한을 확인하세요.";
  } else if (lower.includes("row-level") || lower.includes("permission") || lower.includes("unauthorized") || lower.includes("jwt")) {
    suggestion = "SUPABASE_SERVICE_ROLE_KEY가 anon/publishable key가 아닌 service_role 또는 Secret key인지 확인하세요.";
  } else if (lower.includes("column") || lower.includes("schema cache") || lower.includes("relation")) {
    suggestion = "supabase 폴더의 최신 SQL을 Supabase SQL Editor에서 실행한 뒤 다시 배포하세요.";
  } else if (lower.includes("payload") || lower.includes("body") || lower.includes("too large")) {
    suggestion = "PDF 용량을 줄이기 위해 포함 페이지를 줄이거나 웹 리포트 생성 기능을 사용하세요.";
  }

  return {
    storageStatus: "failed",
    failureStage: stage,
    storageError: detail,
    failureSuggestion: suggestion,
    diagnosticsHint: "초기 세팅 > 저장/발송 환경 점검 또는 결과지 생성 화면의 환경 점검 버튼을 실행하세요."
  };
}

function parsePages(value: FormDataEntryValue | null) {
  if (!value || typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  try {
    const form = await request.formData();

    const evaluationPeriodId = String(form.get("evaluationPeriodId") || "");
    const teacherId = String(form.get("teacherId") || "");
    const pages = parsePages(form.get("pages"));
    const monthCount = form.get("monthCount") || 3;
    const pdfFile = form.get("pdf");

    const isInternalReport = pages?.reportTemplate === "internal" || pages?.audience === "director_internal" || pages?.internalOnly === true;

    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }
    if (!teacherId && !isInternalReport) {
      return NextResponse.json({ error: "선생님 ID가 없습니다." }, { status: 400 });
    }
    if (!(pdfFile instanceof File)) {
      return NextResponse.json({ error: "저장할 PDF 파일이 없습니다." }, { status: 400 });
    }

    const arrayBuffer = await pdfFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!buffer.length) {
      return NextResponse.json({ error: "PDF 파일 내용이 비어 있습니다." }, { status: 400 });
    }
    if (buffer.length > 45 * 1024 * 1024) {
      return NextResponse.json({
        error: "PDF 파일이 너무 큽니다. 선택한 선생님 1명 또는 포함 페이지를 줄여서 다시 생성해주세요."
      }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const resolvedTeacherId = await resolveTeacherIdForPdfExport(supabase, teacherId, isInternalReport);
    const filePath = buildPdfStorageKey(evaluationPeriodId, resolvedTeacherId);

    try {
      await ensureReportBucket(supabase);

      const upload = await supabase.storage.from(BUCKET_NAME).upload(
        filePath,
        buffer,
        {
          contentType: "application/pdf",
          upsert: false
        }
      );

      if (upload.error) throw upload.error;

      const exportInsert = await insertExportRow(supabase, {
        evaluation_period_id: evaluationPeriodId,
        teacher_id: resolvedTeacherId,
        report_type: isInternalReport ? "director_internal_report_pdf" : "monthly_teacher_report_pdf",
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
      const failedInsert = await insertExportRow(supabase, {
        evaluation_period_id: evaluationPeriodId,
        teacher_id: resolvedTeacherId,
        report_type: isInternalReport ? "director_internal_report_pdf" : "monthly_teacher_report_pdf",
        pages: normalizePages(pages, monthCount, {
          ...storageFailurePayload(storageOrInsertError, "PDF Storage 업로드/이력 저장"),
          reportKind: isInternalReport ? "director_internal_report" : "teacher_report",
          internalAnchorTeacherId: isInternalReport ? resolvedTeacherId : undefined
        }),
        file_url: null,
        status: "failed"
      });

      if (failedInsert.error) throw storageOrInsertError;

      return NextResponse.json({
        ok: false,
        warning: "PDF 저장에는 실패했지만, 실패 이력은 출력 이력에 기록했습니다.",
        export: failedInsert.data,
        errorMessage: toSafeErrorMessage(storageOrInsertError),
        failureStage: "PDF Storage 업로드/이력 저장",
        suggestion: storageFailurePayload(storageOrInsertError, "PDF Storage 업로드/이력 저장").failureSuggestion
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
