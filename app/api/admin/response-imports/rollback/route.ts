import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";
import { rejectIfPeriodLocked } from "@/lib/periodSafety";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const batchId = cleanText(body.batchId);
    const reason = cleanText(body.reason) || "관리자 요청으로 업로드 롤백";

    if (!batchId) {
      return NextResponse.json({ error: "롤백할 업로드 이력을 선택해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const batchRes = await supabase
      .from("response_import_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    if (batchRes.error) throw batchRes.error;

    if (batchRes.data?.status === "rolled_back") {
      return NextResponse.json({ error: "이미 롤백 처리된 업로드입니다." }, { status: 400 });
    }

    const lockedResponse = await rejectIfPeriodLocked(supabase, batchRes.data.evaluation_period_id, "응답 업로드 롤백");
    if (lockedResponse) return lockedResponse;

    const responsesRes = await supabase
      .from("evaluation_responses")
      .select("id")
      .eq("import_batch_id", batchId);

    if (responsesRes.error) throw responsesRes.error;

    const responseIds = (responsesRes.data || []).map((row: any) => row.id);

    if (responseIds.length) {
      const answersDelete = await supabase
        .from("evaluation_answers")
        .delete()
        .in("response_id", responseIds);

      if (answersDelete.error) throw answersDelete.error;

      const responsesDelete = await supabase
        .from("evaluation_responses")
        .delete()
        .in("id", responseIds);

      if (responsesDelete.error) throw responsesDelete.error;
    }

    const batchUpdate = await supabase
      .from("response_import_batches")
      .update({
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
        rolled_back_by: guard.admin.adminId,
        rollback_reason: reason
      })
      .eq("id", batchId);

    if (batchUpdate.error) throw batchUpdate.error;

    await logAction(supabase, guard.admin, "response_import_rollback", "response_import_batches", batchId, {
      deletedResponses: responseIds.length,
      reason
    });

    return NextResponse.json({
      ok: true,
      deletedResponses: responseIds.length,
      message: `업로드 롤백 완료: 응답 ${responseIds.length}건을 삭제했습니다.`
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
