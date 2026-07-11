import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin, getSupabaseEnvStatus, getAppUrl } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME = "teacher-reports";

type DiagnosticStatus = "ok" | "warn" | "fail";
type DiagnosticSeverity = "critical" | "warning";

type DiagnosticCheck = {
  key: string;
  label: string;
  status: DiagnosticStatus;
  ok: boolean;
  severity: DiagnosticSeverity;
  message: string;
  detail?: string;
  action?: string;
};

function checkRow(
  key: string,
  label: string,
  status: DiagnosticStatus,
  message: string,
  detail = "",
  action = "",
  severity: DiagnosticSeverity = status === "fail" ? "critical" : "warning"
): DiagnosticCheck {
  return {
    key,
    label,
    status,
    ok: status === "ok",
    severity,
    message,
    detail,
    action
  };
}

async function countRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  filters: Record<string, any> = {}
) {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query = query.eq(key, value);
  });
  return await query;
}

async function checkStorage(supabase: ReturnType<typeof getSupabaseAdmin>) {
  try {
    const buckets = await supabase.storage.listBuckets();

    if (buckets.error) {
      return checkRow(
        "storage_bucket_list",
        "Storage Bucket 목록 확인",
        "fail",
        "Supabase Storage 목록을 불러오지 못했습니다.",
        toSafeErrorMessage(buckets.error),
        "SUPABASE_SERVICE_ROLE_KEY가 service_role 또는 Secret key인지 확인하세요."
      );
    }

    const existed = (buckets.data || []).some((bucket) => bucket.name === BUCKET_NAME);

    if (!existed) {
      const created = await supabase.storage.createBucket(BUCKET_NAME, {
        public: false,
        allowedMimeTypes: ["text/html", "application/pdf"],
        fileSizeLimit: 1024 * 1024 * 50
      });

      if (created.error && !String(created.error.message || "").toLowerCase().includes("already")) {
        return checkRow(
          "storage_bucket_create",
          "Storage Bucket 생성",
          "fail",
          `${BUCKET_NAME} 저장공간을 만들지 못했습니다.`,
          toSafeErrorMessage(created.error),
          "Supabase Storage 권한과 프로젝트 용량 제한을 확인하세요."
        );
      }
    } else {
      const updated = await supabase.storage.updateBucket(BUCKET_NAME, {
        public: false,
        allowedMimeTypes: ["text/html", "application/pdf"],
        fileSizeLimit: 1024 * 1024 * 50
      });

      if (updated.error) {
        return checkRow(
          "storage_bucket_update",
          "Storage Bucket PDF 허용 설정",
          "fail",
          "teacher-reports 저장공간의 HTML/PDF 허용 설정을 갱신하지 못했습니다.",
          toSafeErrorMessage(updated.error),
          "Supabase Storage Bucket 설정에서 application/pdf 허용 여부를 확인하세요."
        );
      }
    }

    const htmlTestPath = `diagnostics/${Date.now()}-storage-test.html`;
    const htmlUpload = await supabase.storage.from(BUCKET_NAME).upload(
      htmlTestPath,
      Buffer.from("<!doctype html><html><body>storage test</body></html>", "utf8"),
      { contentType: "text/html", upsert: false }
    );

    if (htmlUpload.error) {
      return checkRow(
        "storage_html_upload",
        "Storage HTML 테스트 업로드",
        "fail",
        "teacher-reports 저장공간은 확인했지만 HTML 테스트 파일 업로드에 실패했습니다.",
        toSafeErrorMessage(htmlUpload.error),
        "Storage 정책, Bucket 권한, Service Role Key를 확인하세요."
      );
    }

    const pdfTestPath = `diagnostics/${Date.now()}-storage-test.pdf`;
    const pdfUpload = await supabase.storage.from(BUCKET_NAME).upload(
      pdfTestPath,
      Buffer.from("%PDF-1.4\n% e-evaluation storage test\n", "utf8"),
      { contentType: "application/pdf", upsert: false }
    );

    await supabase.storage.from(BUCKET_NAME).remove([htmlTestPath]);

    if (pdfUpload.error) {
      return checkRow(
        "storage_pdf_upload",
        "Storage PDF 테스트 업로드",
        "fail",
        "HTML 업로드는 성공했지만 PDF 테스트 파일 업로드에 실패했습니다.",
        toSafeErrorMessage(pdfUpload.error),
        "Bucket allowedMimeTypes에 application/pdf가 포함되어 있는지 확인하세요."
      );
    }

    await supabase.storage.from(BUCKET_NAME).remove([pdfTestPath]);

    return checkRow(
      "storage_upload",
      "Storage 저장 권한",
      "ok",
      existed
        ? "teacher-reports 저장공간 확인, HTML/PDF 테스트 업로드 성공"
        : "teacher-reports 저장공간 생성, HTML/PDF 테스트 업로드 성공",
      `Bucket: ${BUCKET_NAME}`,
      ""
    );
  } catch (error: any) {
    return checkRow(
      "storage_unknown",
      "Storage 점검",
      "fail",
      "Storage 점검 중 오류가 발생했습니다.",
      toSafeErrorMessage(error),
      "Supabase Storage와 환경변수를 다시 확인하세요."
    );
  }
}

async function checkTable(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  label: string,
  requiredColumns: string
) {
  try {
    const checked = await supabase
      .from(table)
      .select(requiredColumns, { count: "exact", head: true });

    if (checked.error) {
      return checkRow(
        `table_${table}`,
        label,
        "fail",
        `${table} 테이블 또는 필요한 컬럼을 확인하지 못했습니다.`,
        toSafeErrorMessage(checked.error),
        "supabase 폴더의 최신 SQL을 Supabase SQL Editor에서 실행했는지 확인하세요."
      );
    }

    return checkRow(
      `table_${table}`,
      label,
      "ok",
      `${table} 테이블과 필수 컬럼 확인 성공`,
      `확인된 행 수: ${checked.count ?? 0}건`,
      ""
    );
  } catch (error: any) {
    return checkRow(
      `table_${table}`,
      label,
      "fail",
      `${table} 테이블 점검 중 오류가 발생했습니다.`,
      toSafeErrorMessage(error),
      "최신 SQL 적용 여부를 확인하세요."
    );
  }
}

function checkSlackTokenShape() {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();

  if (!token) {
    return {
      token,
      row: checkRow(
        "slack_token",
        "Slack Bot Token 환경변수",
        "warn",
        "SLACK_BOT_TOKEN이 비어 있습니다. 웹 리포트 생성은 가능하지만 Slack DM은 실패합니다.",
        "원장 내부 확인용 리포트는 총괄관리자 Slack DM 발송이 필요합니다.",
        "Vercel 환경변수에 SLACK_BOT_TOKEN을 등록한 뒤 재배포하세요.",
        "warning"
      )
    };
  }

  if (token.startsWith("xoxp-")) {
    return {
      token,
      row: checkRow(
        "slack_token",
        "Slack Bot Token 환경변수",
        "fail",
        "SLACK_BOT_TOKEN이 사용자 토큰(xoxp-)으로 보입니다.",
        "Slack API 발송에는 Bot User OAuth Token(xoxb-)이 필요합니다.",
        "Slack App > OAuth & Permissions에서 Bot User OAuth Token을 복사하세요."
      )
    };
  }

  if (!token.startsWith("xoxb-")) {
    return {
      token,
      row: checkRow(
        "slack_token",
        "Slack Bot Token 환경변수",
        "fail",
        "SLACK_BOT_TOKEN 형식이 올바르지 않습니다.",
        "Bot User OAuth Token은 보통 xoxb-로 시작합니다.",
        "Slack App의 Bot User OAuth Token 값을 확인하세요."
      )
    };
  }

  return {
    token,
    row: checkRow(
      "slack_token",
      "Slack Bot Token 환경변수",
      "ok",
      "SLACK_BOT_TOKEN 형식 확인 완료",
      "xoxb-로 시작하는 Bot User OAuth Token 형식입니다.",
      ""
    )
  };
}

async function checkSlackAuth(token: string) {
  if (!token || !token.startsWith("xoxb-")) {
    return checkRow(
      "slack_auth",
      "Slack API 연결",
      "warn",
      "Slack API 인증 테스트를 건너뛰었습니다.",
      "Bot Token 형식이 먼저 정상이어야 합니다.",
      "SLACK_BOT_TOKEN 설정 후 다시 점검하세요.",
      "warning"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: "{}",
      cache: "no-store",
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      return checkRow(
        "slack_auth",
        "Slack API 연결",
        "fail",
        "Slack Bot Token 인증에 실패했습니다.",
        `Slack 오류: ${data.error || res.statusText}`,
        "SLACK_BOT_TOKEN 값과 Slack App 설치 상태를 확인하세요."
      );
    }

    return checkRow(
      "slack_auth",
      "Slack API 연결",
      "ok",
      "Slack Bot Token 인증 성공",
      data.team ? `Workspace: ${data.team}` : "auth.test 통과",
      ""
    );
  } catch (error: any) {
    return checkRow(
      "slack_auth",
      "Slack API 연결",
      "warn",
      "Slack API 인증 테스트 중 네트워크 오류가 발생했습니다.",
      toSafeErrorMessage(error),
      "Vercel 네트워크 또는 Slack API 상태를 확인하세요. 실제 발송 시 다시 검증됩니다.",
      "warning"
    );
  } finally {
    clearTimeout(timer);
  }
}

async function checkSuperAdmins(supabase: ReturnType<typeof getSupabaseAdmin>) {
  try {
    const adminsRes = await supabase
      .from("admin_profiles")
      .select("id, email, name, role, is_active")
      .eq("role", "super_admin")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (adminsRes.error) {
      return checkRow(
        "super_admins",
        "총괄관리자 DM 대상",
        "fail",
        "활성 총괄관리자 계정을 확인하지 못했습니다.",
        toSafeErrorMessage(adminsRes.error),
        "관리자 계정 메뉴와 admin_profiles 테이블을 확인하세요."
      );
    }

    const admins = adminsRes.data || [];
    const adminsWithEmail = admins.filter((admin: any) => String(admin.email || "").includes("@"));

    if (!admins.length) {
      return checkRow(
        "super_admins",
        "총괄관리자 DM 대상",
        "fail",
        "활성 총괄관리자 계정이 없습니다.",
        "원장 내부 확인용 리포트의 Slack DM 수신 대상을 찾을 수 없습니다.",
        "관리자 계정에서 role=총괄관리자, 활성 상태인 계정을 1개 이상 준비하세요."
      );
    }

    if (!adminsWithEmail.length) {
      return checkRow(
        "super_admins",
        "총괄관리자 DM 대상",
        "fail",
        "활성 총괄관리자 계정은 있지만 이메일이 없습니다.",
        `${admins.length}개 계정 확인됨`,
        "Slack 계정 이메일과 같은 이메일을 총괄관리자 계정에 입력하세요."
      );
    }

    return checkRow(
      "super_admins",
      "총괄관리자 DM 대상",
      "ok",
      `활성 총괄관리자 ${adminsWithEmail.length}명 확인`,
      adminsWithEmail.map((admin: any) => admin.email).join(", "),
      ""
    );
  } catch (error: any) {
    return checkRow(
      "super_admins",
      "총괄관리자 DM 대상",
      "fail",
      "총괄관리자 계정 점검 중 오류가 발생했습니다.",
      toSafeErrorMessage(error),
      "관리자 계정과 Supabase 연결을 확인하세요."
    );
  }
}

async function checkSelectedPeriod(supabase: ReturnType<typeof getSupabaseAdmin>, evaluationPeriodId: string) {
  if (!evaluationPeriodId) {
    return [
      checkRow(
        "selected_period",
        "선택 평가월 데이터",
        "warn",
        "점검할 평가월이 선택되지 않았습니다.",
        "결과지 생성 화면에서 평가월을 선택한 뒤 다시 점검하면 응답/배정/링크 상태까지 확인합니다.",
        "결과지 생성 메뉴에서 평가월을 선택하세요.",
        "warning"
      )
    ];
  }

  const checks: DiagnosticCheck[] = [];

  try {
    const periodRes = await supabase
      .from("evaluation_periods")
      .select("id,title,year_month,status")
      .eq("id", evaluationPeriodId)
      .maybeSingle();

    if (periodRes.error || !periodRes.data) {
      checks.push(checkRow(
        "selected_period",
        "선택 평가월 데이터",
        "fail",
        "선택한 평가월을 찾지 못했습니다.",
        periodRes.error ? toSafeErrorMessage(periodRes.error) : evaluationPeriodId,
        "평가월 관리에서 평가월이 삭제되었는지 확인하세요."
      ));
      return checks;
    }

    checks.push(checkRow(
      "selected_period",
      "선택 평가월 데이터",
      "ok",
      `${periodRes.data.title || periodRes.data.year_month} 평가월 확인`,
      `상태: ${periodRes.data.status || "-"}`,
      ""
    ));

    const [assignmentsRes, responsesRes, exportsRes, linksRes] = await Promise.all([
      countRows(supabase, "teacher_class_assignments", { evaluation_period_id: evaluationPeriodId }),
      countRows(supabase, "evaluation_responses", { evaluation_period_id: evaluationPeriodId }),
      countRows(supabase, "teacher_report_exports", { evaluation_period_id: evaluationPeriodId }),
      countRows(supabase, "teacher_report_share_links", { evaluation_period_id: evaluationPeriodId })
    ]);

    const periodQueries = [assignmentsRes, responsesRes, exportsRes, linksRes];
    const periodError = periodQueries.find((res: any) => res.error)?.error;
    if (periodError) {
      checks.push(checkRow(
        "selected_period_counts",
        "평가월 운영 데이터 수량",
        "fail",
        "선택 평가월의 운영 데이터 수량을 확인하지 못했습니다.",
        toSafeErrorMessage(periodError),
        "최신 Supabase SQL 적용 여부를 확인하세요."
      ));
      return checks;
    }

    checks.push(checkRow(
      "period_assignments",
      "선택월 선생님-반 배정",
      (assignmentsRes.count || 0) > 0 ? "ok" : "warn",
      (assignmentsRes.count || 0) > 0 ? `배정 ${assignmentsRes.count}건 확인` : "선택 평가월의 선생님-반 배정이 없습니다.",
      "배정이 없으면 QR 생성과 리포트 대상 계산이 제한될 수 있습니다.",
      "선생님-반 배정 메뉴에서 해당 평가월 배정을 등록하세요.",
      "warning"
    ));

    checks.push(checkRow(
      "period_responses",
      "선택월 설문 응답",
      (responsesRes.count || 0) > 0 ? "ok" : "warn",
      (responsesRes.count || 0) > 0 ? `응답 ${responsesRes.count}건 확인` : "선택 평가월의 설문 응답이 없습니다.",
      "응답이 없으면 PDF/웹 리포트가 빈 결과로 생성될 수 있습니다.",
      "QR 제출 또는 응답 업로드 상태를 확인하세요.",
      "warning"
    ));

    checks.push(checkRow(
      "period_exports_links",
      "선택월 저장/링크 이력",
      "ok",
      `출력 이력 ${exportsRes.count || 0}건 · 웹 링크 ${linksRes.count || 0}건`,
      "기존 저장/발송 이력을 확인했습니다.",
      ""
    ));

    return checks;
  } catch (error: any) {
    return [checkRow(
      "selected_period_unknown",
      "선택 평가월 데이터",
      "fail",
      "선택 평가월 점검 중 오류가 발생했습니다.",
      toSafeErrorMessage(error),
      "Supabase 연결과 평가월 데이터를 확인하세요."
    )];
  }
}

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "run_setup");
  if (!guard.ok) return guard.response;

  const env = getSupabaseEnvStatus();
  const evaluationPeriodId = request.nextUrl.searchParams.get("evaluationPeriodId") || "";
  const checks: DiagnosticCheck[] = [];

  const envStatus = env.ok ? "ok" : "fail";
  checks.push(checkRow(
    "env_supabase",
    "Supabase 환경변수",
    envStatus,
    env.ok ? "Supabase URL/Service Role Key 기본 형식 확인 완료" : "Supabase 환경변수 확인이 필요합니다.",
    [
      `URL: ${env.urlPreview}`,
      `Service Key: ${env.hasServiceRoleKey ? env.serviceKeyType : "비어 있음"}`,
      ...(env.warnings || [])
    ].filter(Boolean).join(" · "),
    env.ok ? "" : env.problems.join(" ")
  ));

  checks.push(checkRow(
    "env_app_url",
    "앱 URL 환경변수",
    getAppUrl() ? "ok" : "warn",
    getAppUrl() ? "NEXT_PUBLIC_APP_URL 확인 완료" : "NEXT_PUBLIC_APP_URL이 없어서 요청 도메인을 자동 사용합니다.",
    getAppUrl() || "Vercel 배포 주소를 자동 사용합니다.",
    "웹 리포트 링크가 잘못된 도메인으로 생성되면 NEXT_PUBLIC_APP_URL을 실제 배포 주소로 지정하세요.",
    "warning"
  ));

  const slackToken = checkSlackTokenShape();
  checks.push(slackToken.row);

  if (!env.ok) {
    return NextResponse.json({
      ok: false,
      readyForInternalReport: false,
      message: "Supabase 환경변수 확인이 필요합니다.",
      env,
      bucketName: BUCKET_NAME,
      checks
    }, { status: 500 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const questionsRes = await supabase
      .from("evaluation_questions")
      .select("id", { count: "exact", head: true });

    if (questionsRes.error) {
      checks.push(checkRow(
        "questions",
        "평가 문항 테이블",
        "fail",
        "evaluation_questions 문항을 확인하지 못했습니다.",
        toSafeErrorMessage(questionsRes.error),
        "기본 스키마 SQL과 샘플/운영 문항 등록 여부를 확인하세요."
      ));
    } else {
      checks.push(checkRow(
        "questions",
        "평가 문항 테이블",
        (questionsRes.count || 0) > 0 ? "ok" : "warn",
        (questionsRes.count || 0) > 0 ? `기본 문항 ${questionsRes.count}개 확인` : "활성 문항이 없습니다.",
        "문항이 없으면 설문/리포트가 정상 작동하지 않습니다.",
        "초기 SQL 또는 문항 등록 상태를 확인하세요.",
        "warning"
      ));
    }

    const [storage, reportExports, reportLinks, slackLogs, superAdmins, slackAuth] = await Promise.all([
      checkStorage(supabase),
      checkTable(supabase, "teacher_report_exports", "출력 이력 테이블", "id,status,pages,file_url,created_at"),
      checkTable(supabase, "teacher_report_share_links", "웹 리포트 링크 테이블", "id,token,is_active,report_export_id,created_at"),
      checkTable(supabase, "slack_message_logs", "Slack 발송 이력 테이블", "id,status,error_message,created_at"),
      checkSuperAdmins(supabase),
      checkSlackAuth(slackToken.token)
    ]);
    const periodChecks = await checkSelectedPeriod(supabase, evaluationPeriodId);

    checks.push(storage, reportExports, reportLinks, slackLogs, superAdmins, slackAuth, ...periodChecks);

    const criticalFailures = checks.filter((item) => item.status === "fail" && item.severity === "critical");
    const warnings = checks.filter((item) => item.status === "warn");
    const slackOk = checks.find((item) => item.key === "slack_token")?.ok && checks.find((item) => item.key === "slack_auth")?.status !== "fail";
    const superAdminOk = checks.find((item) => item.key === "super_admins")?.ok;
    const readyForInternalReport = criticalFailures.length === 0 && Boolean(slackOk) && Boolean(superAdminOk);

    await logAction(supabase, guard.admin, "run_report_environment_diagnostics", "system", null, {
      evaluationPeriodId: evaluationPeriodId || null,
      criticalFailures: criticalFailures.length,
      warnings: warnings.length,
      readyForInternalReport
    });

    return NextResponse.json({
      ok: criticalFailures.length === 0,
      readyForInternalReport,
      message: criticalFailures.length === 0
        ? warnings.length
          ? `기본 저장/발송 환경은 확인됐고, 주의 ${warnings.length}건이 있습니다.`
          : "저장/발송 환경 점검을 통과했습니다."
        : `필수 점검 실패 ${criticalFailures.length}건이 있습니다.`,
      env,
      bucketName: BUCKET_NAME,
      questionCount: questionsRes.count || 0,
      checks,
      summary: {
        total: checks.length,
        ok: checks.filter((item) => item.status === "ok").length,
        warning: warnings.length,
        failed: checks.filter((item) => item.status === "fail").length,
        criticalFailed: criticalFailures.length
      }
    });
  } catch (error: any) {
    checks.push(checkRow(
      "supabase_connection",
      "Supabase 접속",
      "fail",
      "Supabase 접속 확인 중 오류가 발생했습니다.",
      toSafeErrorMessage(error),
      "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인하세요."
    ));

    return NextResponse.json({
      ok: false,
      readyForInternalReport: false,
      step: "Supabase 접속 확인",
      env,
      error: toSafeErrorMessage(error),
      checks
    }, { status: 500 });
  }
}
