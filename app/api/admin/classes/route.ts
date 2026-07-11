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
    const name = cleanText(body.name);

    if (!name) {
      return NextResponse.json({ error: "반 이름을 입력해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("classes")
      .insert({
        name,
        grade: cleanText(body.grade),
        day_pattern: cleanText(body.day_pattern),
        campus: cleanText(body.campus),
        memo: cleanText(body.memo),
        is_active: body.is_active === undefined ? true : Boolean(body.is_active)
      })
      .select("*")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, classItem: res.data });
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
      return NextResponse.json({ error: "수정할 반 ID가 없습니다." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "반 이름을 입력해주세요." }, { status: 400 });
    }

    const updatePayload: any = {
      name,
      grade: cleanText(body.grade),
      day_pattern: cleanText(body.day_pattern),
      campus: cleanText(body.campus),
      memo: cleanText(body.memo),
      updated_at: new Date().toISOString()
    };

    if (body.is_active !== undefined) {
      updatePayload.is_active = Boolean(body.is_active);
    }

    const supabase = getSupabaseAdmin();

    const res = await supabase
      .from("classes")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (res.error) throw res.error;

    return NextResponse.json({ ok: true, classItem: res.data });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
