import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

const allowedStatuses = new Set(["draft", "open", "closed", "archived"]);

// v2.6.3: 평가월 상태는 서로 독립적으로 관리합니다.
// 이전 버전에서는 한 평가월을 진행중(open)으로 저장하면 다른 진행중 평가월을 자동 마감(closed)하는 로직이 있었는데,
// 레거시 데이터 이관/월별 재검토 상황에서는 각 월을 개별적으로 열고 닫아야 하므로 자동 마감 로직을 제거했습니다.

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const year_month = cleanText(body.year_month);
    const title = cleanText(body.title);
    const status = cleanText(body.status) || "draft";

    if (!year_month) {
      return NextResponse.json({ error: "평가월을 입력해주세요. 예: 2026-07" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}$/.test(year_month)) {
      return NextResponse.json({ error: "평가월은 2026-07 형식으로 입력해주세요." }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "평가 이름을 입력해주세요." }, { status: 400 });
    }

    if (!allowedStatuses.has(status)) {
      return NextResponse.json({ error: "상태값이 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("evaluation_periods")
      .insert({
        year_month,
        title,
        start_date: null,
        end_date: null,
        status,
        is_active: body.is_active === undefined ? true : Boolean(body.is_active)
      })
      .select("*")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, period: res.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

async function countAndDelete(query: any) {
  const res = await query.select("id", { count: "exact" });
  if (res.error) throw res.error;
  return res.count || 0;
}

async function removeReportStorageFiles(supabase: ReturnType<typeof getSupabaseAdmin>, filePaths: string[]) {
  const paths = Array.from(new Set((filePaths || []).map((x) => String(x || "").trim()).filter(Boolean)));
  if (!paths.length) return { removed: 0, error: null as string | null };
  try {
    for (let index = 0; index < paths.length; index += 100) {
      const chunk = paths.slice(index, index + 100);
      const res = await supabase.storage.from("teacher-reports").remove(chunk);
      if (res.error) return { removed: index, error: res.error.message || "Storage 파일 삭제 실패" };
    }
    return { removed: paths.length, error: null as string | null };
  } catch (error: any) {
    return { removed: 0, error: toSafeErrorMessage(error) };
  }
}

export async function PATCH(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const id = cleanText(body.id);
    const year_month = cleanText(body.year_month);
    const title = cleanText(body.title);
    const status = cleanText(body.status) || "draft";

    if (!id) {
      return NextResponse.json({ error: "수정할 평가월 ID가 없습니다." }, { status: 400 });
    }

    if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
      return NextResponse.json({ error: "평가월은 2026-07 형식으로 입력해주세요." }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "평가 이름을 입력해주세요." }, { status: 400 });
    }

    if (!allowedStatuses.has(status)) {
      return NextResponse.json({ error: "상태값이 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const lockedResponse = await rejectIfPeriodLocked(supabase, id, "평가월 수정");
    if (lockedResponse) return lockedResponse;

    const updatePayload: any = {
      year_month,
      title,
      start_date: null,
      end_date: null,
      status,
      updated_at: new Date().toISOString()
    };

    if (body.is_active !== undefined) {
      updatePayload.is_active = Boolean(body.is_active);
    }

    const res = await supabase
      .from("evaluation_periods")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, period: res.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

// 평가월 삭제: 해당 평가월과 연결된 응답/업로드/QR/배정/결과지 등을 함께 삭제합니다.
// 데이터가 입력된 월은 클라이언트에서 경고·확인을 거친 뒤 confirm 플래그와 함께 호출됩니다.
export async function DELETE(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json().catch(() => ({}));
    const id = cleanText(body.id);

    if (!id) {
      return NextResponse.json({ error: "삭제할 평가월 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const periodRes = await supabase
      .from("evaluation_periods")
      .select("id, title, year_month, is_locked")
      .eq("id", id)
      .single();
    if (periodRes.error) throw periodRes.error;
    const period = periodRes.data;

    const lockedResponse = await rejectIfPeriodLocked(supabase, id, "평가월 삭제");
    if (lockedResponse) return lockedResponse;

    const counts: Record<string, number> = {};

    // 결과지 저장 파일(스토리지) 먼저 정리 — 행은 평가월 삭제 시 cascade로 지워지지만 파일은 별도 삭제 필요
    const exportRows = await supabase
      .from("teacher_report_exports")
      .select("file_url")
      .eq("evaluation_period_id", id);
    if (exportRows.error) throw exportRows.error;
    const storageResult = await removeReportStorageFiles(
      supabase,
      (exportRows.data || []).map((row: any) => row.file_url).filter(Boolean)
    );

    // 응답(및 답변)은 on delete restrict 이므로 평가월 삭제 전에 직접 삭제해야 합니다. (답변은 응답 삭제 시 cascade)
    counts.responses = await countAndDelete(
      supabase.from("evaluation_responses").delete({ count: "exact" }).eq("evaluation_period_id", id)
    );
    // 업로드 배치도 on delete restrict — 직접 삭제 (에러 로그는 배치 삭제 시 cascade)
    counts.importBatches = await countAndDelete(
      supabase.from("response_import_batches").delete({ count: "exact" }).eq("evaluation_period_id", id)
    );

    // 나머지(QR/배정/결과지/월간지표/공유링크)는 평가월 삭제 시 cascade로 함께 삭제됩니다.
    const periodDelete = await supabase.from("evaluation_periods").delete().eq("id", id);
    if (periodDelete.error) throw periodDelete.error;

    await logAction(supabase, guard.admin, "period_delete", "evaluation_periods", id, {
      title: period.title,
      year_month: period.year_month,
      counts,
      storage: storageResult
    });

    const base = `${period.title}을(를) 삭제했습니다. (응답 ${counts.responses}건, 업로드 ${counts.importBatches}건 포함)`;
    return NextResponse.json({
      ok: true,
      message: storageResult.error ? `${base} · 단, 일부 저장 파일 삭제 확인 필요: ${storageResult.error}` : base,
      counts,
      storage: storageResult
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
