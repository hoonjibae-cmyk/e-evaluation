import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const name = cleanText(body.name);

    if (!name) {
      return NextResponse.json({ error: "선생님 이름을 입력해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("teachers")
      .insert({
        teacher_code: cleanText(body.teacher_code),
        name,
        display_name: cleanText(body.display_name),
        subject: cleanText(body.subject),
        slack_email: cleanText(body.slack_email),
        slack_user_id: cleanText(body.slack_user_id),
        memo: cleanText(body.memo),
        is_active: body.is_active === undefined ? true : Boolean(body.is_active)
      })
      .select("*")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, teacher: res.data });
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
    const name = cleanText(body.name);

    if (!id) {
      return NextResponse.json({ error: "수정할 선생님 ID가 없습니다." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "선생님 이름을 입력해주세요." }, { status: 400 });
    }

    const updatePayload: any = {
      teacher_code: cleanText(body.teacher_code),
      name,
      display_name: cleanText(body.display_name),
      subject: cleanText(body.subject),
      slack_email: cleanText(body.slack_email),
      slack_user_id: cleanText(body.slack_user_id),
      memo: cleanText(body.memo),
      updated_at: new Date().toISOString()
    };

    if (body.is_active !== undefined) {
      updatePayload.is_active = Boolean(body.is_active);
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("teachers")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, teacher: res.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

async function removeTeacherStorageFiles(supabase: ReturnType<typeof getSupabaseAdmin>, filePaths: string[]) {
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

async function countAndDelete(query: any) {
  const res = await query.select("id", { count: "exact" });
  if (res.error) throw res.error;
  return res.count || 0;
}

export async function DELETE(request: NextRequest) {
  const guard = requireSuperAdmin(request);
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const teacherId = cleanText(body.teacherId || body.id);

    if (!teacherId) {
      return NextResponse.json({ error: "삭제할 선생님 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const teacherRes = await supabase
      .from("teachers")
      .select("id, name")
      .eq("id", teacherId)
      .single();

    if (teacherRes.error) throw teacherRes.error;

    const teacher = teacherRes.data;
    const expected = `${teacher.name} 선생님 영구 삭제`;

    if (cleanText(body.confirmation) !== expected) {
      return NextResponse.json({ error: `삭제 확인 문구가 맞지 않습니다. 정확히 "${expected}"라고 입력해야 합니다.` }, { status: 400 });
    }

    const exportRows = await supabase
      .from("teacher_report_exports")
      .select("id, file_url")
      .eq("teacher_id", teacherId);

    if (exportRows.error) throw exportRows.error;

    const storageResult = await removeTeacherStorageFiles(
      supabase,
      (exportRows.data || []).map((row: any) => row.file_url).filter(Boolean)
    );

    const counts: Record<string, number> = {};

    counts.slackLogs = await countAndDelete(
      supabase.from("slack_message_logs").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );
    counts.reportShareLinks = await countAndDelete(
      supabase.from("teacher_report_share_links").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );
    counts.reportExports = await countAndDelete(
      supabase.from("teacher_report_exports").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );

    const responseIdsRes = await supabase
      .from("evaluation_responses")
      .select("id")
      .eq("teacher_id", teacherId);
    if (responseIdsRes.error) throw responseIdsRes.error;
    const responseIds = (responseIdsRes.data || []).map((row: any) => row.id);

    counts.answers = 0;
    if (responseIds.length) {
      counts.answers = await countAndDelete(
        supabase.from("evaluation_answers").delete({ count: "exact" }).in("response_id", responseIds)
      );
    }
    counts.responses = await countAndDelete(
      supabase.from("evaluation_responses").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );
    counts.qrLinks = await countAndDelete(
      supabase.from("teacher_qr_links").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );
    counts.assignments = await countAndDelete(
      supabase.from("teacher_class_assignments").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );
    counts.metrics = await countAndDelete(
      supabase.from("teacher_monthly_metrics").delete({ count: "exact" }).eq("teacher_id", teacherId)
    );

    const teacherDelete = await supabase
      .from("teachers")
      .delete()
      .eq("id", teacherId);

    if (teacherDelete.error) throw teacherDelete.error;

    await logAction(supabase, guard.admin, "teacher_hard_delete", "teachers", teacherId, {
      teacherName: teacher.name,
      counts,
      storage: storageResult
    });

    const message = `${teacher.name} 선생님 삭제 완료 · 응답 ${counts.responses}건, 결과지 ${counts.reportExports}건, 웹링크 ${counts.reportShareLinks}건, QR ${counts.qrLinks}건, 배정 ${counts.assignments}건 삭제`;

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

