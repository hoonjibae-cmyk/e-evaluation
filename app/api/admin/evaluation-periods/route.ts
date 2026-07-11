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
