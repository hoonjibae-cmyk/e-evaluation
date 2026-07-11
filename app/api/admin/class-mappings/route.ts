import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
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
    const fromClassId = cleanText(body.from_class_id);
    const toClassId = cleanText(body.to_class_id);

    if (!fromClassId || !toClassId) {
      return NextResponse.json({ error: "이전반과 바뀐반을 모두 선택해주세요." }, { status: 400 });
    }

    if (fromClassId === toClassId) {
      return NextResponse.json({ error: "이전반과 바뀐반은 서로 달라야 합니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("class_name_mappings")
      .upsert(
        {
          from_class_id: fromClassId,
          to_class_id: toClassId,
          memo: cleanText(body.memo),
          is_active: body.is_active === undefined ? true : Boolean(body.is_active),
          created_by: guard.admin.adminId,
          updated_at: new Date().toISOString()
        },
        { onConflict: "from_class_id,to_class_id" }
      )
      .select("*, from_class:classes!class_name_mappings_from_class_id_fkey(*), to_class:classes!class_name_mappings_to_class_id_fkey(*)")
      .single();

    if (res.error) throw res.error;

    await logAction(supabase, guard.admin, "class_mapping_upsert", "class_name_mappings", res.data?.id, {
      from_class_id: fromClassId,
      to_class_id: toClassId
    });

    return NextResponse.json({ ok: true, mapping: res.data });
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

    if (!id) {
      return NextResponse.json({ error: "수정할 매칭 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const payload: any = {
      updated_at: new Date().toISOString()
    };

    if (body.memo !== undefined) payload.memo = cleanText(body.memo);
    if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active);

    const res = await supabase
      .from("class_name_mappings")
      .update(payload)
      .eq("id", id)
      .select("*, from_class:classes!class_name_mappings_from_class_id_fkey(*), to_class:classes!class_name_mappings_to_class_id_fkey(*)")
      .single();

    if (res.error) throw res.error;

    await logAction(supabase, guard.admin, "class_mapping_update", "class_name_mappings", id, payload);

    return NextResponse.json({ ok: true, mapping: res.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
