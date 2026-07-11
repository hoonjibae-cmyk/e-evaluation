import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin, getAppUrl } from "@/lib/supabaseServer";
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

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function buildWebReportStorageKey(evaluationPeriodId: string, teacherId: string) {
  const period = safeStorageSegment(evaluationPeriodId);
  const teacher = safeStorageSegment(teacherId);
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const random = Math.random().toString(36).slice(2, 10);
  return `web-report-${period}-${teacher}-${timestamp}-${random}.html`;
}

function getOrigin(request: NextRequest) {
  const configured = getAppUrl();
  if (configured) return configured;
  return request.headers.get("origin") || new URL(request.url).origin;
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
  return {
    ...safePages,
    coverPage: pages?.coverPage === true,
    scoreTable: pages?.scoreTable !== false,
    responseTable: pages?.responseTable !== false,
    evaluationRanking: pages?.evaluationRanking !== false,
    withdrawalRanking: pages?.withdrawalRanking !== false,
    monthCount: Number(monthCount || 3),
    savedFormat: "web-html",
    deliveryMode: "web-report-link",
    note: "선생님에게 웹 링크로 공유하기 위해 저장한 HTML 리포트입니다.",
    ...extra
  };
}

async function insertExportRow(supabase: ReturnType<typeof getSupabaseAdmin>, row: any) {
  return await supabase
    .from("teacher_report_exports")
    .insert(row)
    .select("*, teachers(*), evaluation_periods(*)")
    .single();
}


async function resolveTeacherIdForWebReport(
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

  throw new Error("원장 내부 확인용 웹 리포트의 기준 선생님을 찾지 못했습니다. 선생님 관리에서 선생님 1명 이상을 먼저 등록해주세요.");
}

function storageFailurePayload(error: any, stage: string) {
  const detail = toSafeErrorMessage(error);
  const lower = String(detail || "").toLowerCase();
  let suggestion = "초기 세팅의 [저장/발송 환경 점검]을 실행해 Supabase Storage와 링크 테이블 상태를 확인하세요.";

  if (lower.includes("bucket") || lower.includes("storage")) {
    suggestion = "Supabase Storage의 teacher-reports Bucket, HTML 허용 설정, Service Role Key 권한을 확인하세요.";
  } else if (lower.includes("column") || lower.includes("schema cache") || lower.includes("relation")) {
    suggestion = "supabase/e-evaluation-v2.2-web-report-slack.sql 포함 최신 SQL을 Supabase SQL Editor에서 실행하세요.";
  } else if (lower.includes("permission") || lower.includes("unauthorized") || lower.includes("jwt")) {
    suggestion = "SUPABASE_SERVICE_ROLE_KEY가 service_role 또는 Secret key인지 확인하세요.";
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
    const action = body?.action || "create_from_html";

    if (action !== "create_from_html") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }

    const {
      evaluationPeriodId,
      teacherId,
      teacherName,
      periodTitle,
      pages,
      monthCount,
      html,
      title
    } = body || {};

    const rawReportTemplate = body?.reportTemplate || pages?.reportTemplate;
    const reportTemplate = rawReportTemplate === "internal"
      ? "internal"
      : rawReportTemplate === "summary"
        ? "summary"
        : "teacher";
    const isInternalReport = reportTemplate === "internal";

    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "평가월 ID가 없습니다." }, { status: 400 });
    }
    if (!teacherId && !isInternalReport) {
      return NextResponse.json({ error: "선생님 ID가 없습니다." }, { status: 400 });
    }
    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "저장할 웹 리포트 내용이 없습니다." }, { status: 400 });
    }
    if (html.length > 18 * 1024 * 1024) {
      return NextResponse.json({ error: "웹 리포트 내용이 너무 큽니다. 한 번에 생성할 선생님 수를 줄여주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const resolvedTeacherId = await resolveTeacherIdForWebReport(supabase, teacherId, isInternalReport);
    const filePath = buildWebReportStorageKey(String(evaluationPeriodId), String(resolvedTeacherId));
    const token = randomToken();

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
      report_type: isInternalReport ? "director_internal_report_web" : "web_teacher_report",
      pages: normalizePages(pages, monthCount, {
        storageStatus: "stored",
        reportKind: isInternalReport ? "director_internal_report" : "teacher_report",
        internalAnchorTeacherId: isInternalReport ? resolvedTeacherId : undefined,
        reportTemplate,
        audience: isInternalReport ? "director_internal" : "teacher_delivery",
        internalOnly: isInternalReport,
        deliveryMode: isInternalReport ? "director-slack-dm" : "web-report-link",
        note: isInternalReport
          ? "원장 내부 확인용 HTML 리포트입니다. 선생님/직원에게 직접 발송하지 않습니다."
          : "선생님에게 웹 링크로 공유하기 위해 저장한 HTML 리포트입니다."
      }),
      file_url: filePath,
      status: "created"
    });

    if (exportInsert.error) throw exportInsert.error;

    const linkInsert = await supabase
      .from("teacher_report_share_links")
      .insert({
        token,
        evaluation_period_id: evaluationPeriodId,
        teacher_id: resolvedTeacherId,
        report_export_id: exportInsert.data.id,
        title: title || `${periodTitle || "강의평가"} ${teacherName || ""} 웹 리포트`,
        is_active: true,
        expires_at: null,
        created_by: guard.admin.adminId
      })
      .select("*, teachers(*), evaluation_periods(*), teacher_report_exports(*)")
      .single();

    if (linkInsert.error) throw linkInsert.error;

    await logAction(supabase, guard.admin, "create_web_report_link", "teacher_report_share_links", linkInsert.data.id, {
      evaluationPeriodId,
      teacherId: resolvedTeacherId,
      requestedTeacherId: teacherId || null,
      reportExportId: exportInsert.data.id,
      reportTemplate
    });

    const shareUrl = `${getOrigin(request)}/r/${token}`;

    return NextResponse.json({
      ok: true,
      reportExport: exportInsert.data,
      shareLink: linkInsert.data,
      shareUrl
    });
  } catch (error: any) {
    const payload = storageFailurePayload(error, "웹 리포트 Storage 업로드/링크 생성");
    return NextResponse.json({
      error: toSafeErrorMessage(error),
      failureStage: payload.failureStage,
      suggestion: payload.failureSuggestion
    }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const id = String(body?.id || "");
    const action = String(body?.action || "");

    if (!id) {
      return NextResponse.json({ error: "리포트 링크 ID가 없습니다." }, { status: 400 });
    }
    if (!["deactivate", "reactivate", "regenerate"].includes(action)) {
      return NextResponse.json({ error: "지원하지 않는 링크 작업입니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (action === "deactivate") updatePayload.is_active = false;
    if (action === "reactivate") updatePayload.is_active = true;
    if (action === "regenerate") {
      updatePayload.token = randomToken();
      updatePayload.is_active = true;
      updatePayload.view_count = 0;
      updatePayload.last_viewed_at = null;
    }

    const updated = await supabase
      .from("teacher_report_share_links")
      .update(updatePayload)
      .eq("id", id)
      .select("*, teachers(*), evaluation_periods(*), teacher_report_exports(*)")
      .single();

    if (updated.error) throw updated.error;

    await logAction(supabase, guard.admin, `report_link_${action}`, "teacher_report_share_links", id, {});

    return NextResponse.json({
      ok: true,
      shareLink: updated.data,
      shareUrl: `${getOrigin(request)}/r/${updated.data.token}`
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
