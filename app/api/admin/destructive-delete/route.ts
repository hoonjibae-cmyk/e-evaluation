import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";

const REPORT_BUCKET = "teacher-reports";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : "";
}

async function removeStorageFiles(supabase: ReturnType<typeof getSupabaseAdmin>, filePaths: string[]) {
  const paths = Array.from(new Set((filePaths || []).map((x) => String(x || "").trim()).filter(Boolean)));
  if (!paths.length) return { removed: 0, error: null as string | null };

  try {
    for (let index = 0; index < paths.length; index += 100) {
      const chunk = paths.slice(index, index + 100);
      const res = await supabase.storage.from(REPORT_BUCKET).remove(chunk);
      if (res.error) {
        return { removed: index, error: res.error.message || "Storage 파일 삭제 실패" };
      }
    }
    return { removed: paths.length, error: null as string | null };
  } catch (error: any) {
    return { removed: 0, error: toSafeErrorMessage(error) };
  }
}

async function countAndDelete(query: any) {
  const res = await query.select("id", { count: "exact" });
  if (res.error) throw res.error;
  return res.count || 0;
}

export async function POST(request: NextRequest) {
  const guard = requireSuperAdmin(request);
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const action = cleanText(body.action);

    if (action !== "delete_period_data") {
      return NextResponse.json({ error: "지원하지 않는 삭제 작업입니다." }, { status: 400 });
    }

    const evaluationPeriodId = cleanText(body.evaluationPeriodId);
    if (!evaluationPeriodId) {
      return NextResponse.json({ error: "삭제할 평가월 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const periodRes = await supabase
      .from("evaluation_periods")
      .select("id, title, year_month")
      .eq("id", evaluationPeriodId)
      .single();

    if (periodRes.error) throw periodRes.error;
    const period = periodRes.data;
    const expected = `${period.title} 영구 삭제`;

    if (cleanText(body.confirmation) !== expected) {
      return NextResponse.json({ error: `삭제 확인 문구가 맞지 않습니다. 정확히 "${expected}"라고 입력해야 합니다.` }, { status: 400 });
    }

    const exportRows = await supabase
      .from("teacher_report_exports")
      .select("id, file_url")
      .eq("evaluation_period_id", evaluationPeriodId);

    if (exportRows.error) throw exportRows.error;

    const storageResult = await removeStorageFiles(
      supabase,
      (exportRows.data || []).map((row: any) => row.file_url).filter(Boolean)
    );

    // 삭제 순서가 중요합니다. 참조하는 이력부터 삭제하고, 응답은 답변과 함께 삭제합니다.
    const counts: Record<string, number> = {};

    counts.slackLogs = await countAndDelete(
      supabase.from("slack_message_logs").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.reportShareLinks = await countAndDelete(
      supabase.from("teacher_report_share_links").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.reportExports = await countAndDelete(
      supabase.from("teacher_report_exports").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.importErrors = await countAndDelete(
      supabase.from("response_import_errors").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.importBatches = await countAndDelete(
      supabase.from("response_import_batches").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );

    const responseIdsRes = await supabase
      .from("evaluation_responses")
      .select("id")
      .eq("evaluation_period_id", evaluationPeriodId);
    if (responseIdsRes.error) throw responseIdsRes.error;
    const responseIds = (responseIdsRes.data || []).map((row: any) => row.id);
    counts.answers = 0;
    if (responseIds.length) {
      counts.answers = await countAndDelete(
        supabase.from("evaluation_answers").delete({ count: "exact" }).in("response_id", responseIds)
      );
    }
    counts.responses = await countAndDelete(
      supabase.from("evaluation_responses").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.qrLinks = await countAndDelete(
      supabase.from("teacher_qr_links").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.assignments = await countAndDelete(
      supabase.from("teacher_class_assignments").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );
    counts.metrics = await countAndDelete(
      supabase.from("teacher_monthly_metrics").delete({ count: "exact" }).eq("evaluation_period_id", evaluationPeriodId)
    );

    await logAction(supabase, guard.admin, "period_data_hard_delete", "evaluation_periods", evaluationPeriodId, {
      periodTitle: period.title,
      counts,
      storage: storageResult
    });

    const message =
      `${period.title} 데이터 삭제 완료 · 응답 ${counts.responses}건, 답변 ${counts.answers}건, QR ${counts.qrLinks}건, 배정 ${counts.assignments}건, 결과지 ${counts.reportExports}건, 웹링크 ${counts.reportShareLinks}건, Slack 이력 ${counts.slackLogs}건, 업로드 이력 ${counts.importBatches}건 삭제`;

    return NextResponse.json({
      ok: true,
      message: storageResult.error ? `${message} · 단, 일부 저장 파일 삭제 확인 필요: ${storageResult.error}` : message,
      counts,
      storage: storageResult
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
