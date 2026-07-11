import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  hashPassword,
  logAction,
  requireAdmin
} from "@/lib/adminAuth";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function normalizeEmail(value: any) {
  return String(value || "").trim().toLowerCase();
}

function publicAdmin(row: any) {
  const { password_hash, password_salt, ...safe } = row || {};
  return {
    ...safe,
    has_password: Boolean(password_hash)
  };
}

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;

  try {
    const supabase = getSupabaseAdmin();
    const admins = await supabase
      .from("admin_profiles")
      .select("*")
      .order("role", { ascending: false })
      .order("created_at", { ascending: true });

    if (admins.error) throw admins.error;

    const logs = await supabase
      .from("admin_login_logs")
      .select("*, admin_profiles(id, name, email, role)")
      .order("created_at", { ascending: false })
      .limit(30);

    return NextResponse.json({
      admins: (admins.data || []).map(publicAdmin),
      loginLogs: logs.error ? [] : logs.data || []
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const name = clean(body.name);
    const role = body.role === "super_admin" ? "super_admin" : "general_admin";
    const password = String(body.password || "");

    if (!email.includes("@")) {
      return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "관리자 이름을 입력해주세요." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "초기 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    }

    const { salt, hash } = hashPassword(password);
    const supabase = getSupabaseAdmin();

    const inserted = await supabase
      .from("admin_profiles")
      .upsert(
        {
          email,
          name,
          role,
          is_active: body.is_active !== false,
          memo: clean(body.memo),
          password_salt: salt,
          password_hash: hash,
          password_updated_at: new Date().toISOString(),
          created_by: guard.admin.adminId,
          updated_at: new Date().toISOString()
        },
        { onConflict: "email" }
      )
      .select("*")
      .single();

    if (inserted.error) throw inserted.error;

    await logAction(supabase, guard.admin, "admin.create_or_update", "admin_profiles", inserted.data.id, {
      email,
      role
    });

    return NextResponse.json({ ok: true, admin: publicAdmin(inserted.data) });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = requireAdmin(request, "manage_admins");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const id = clean(body.id);

    if (!id) {
      return NextResponse.json({ error: "관리자 ID가 없습니다." }, { status: 400 });
    }

    const patch: any = {
      updated_at: new Date().toISOString()
    };

    if (clean(body.name)) patch.name = clean(body.name);
    if (body.role === "super_admin" || body.role === "general_admin") patch.role = body.role;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (body.memo !== undefined) patch.memo = clean(body.memo);

    if (String(body.password || "").trim()) {
      const password = String(body.password);
      if (password.length < 8) {
        return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
      }
      const { salt, hash } = hashPassword(password);
      patch.password_salt = salt;
      patch.password_hash = hash;
      patch.password_updated_at = new Date().toISOString();
      patch.login_failed_count = 0;
      patch.locked_until = null;
    }

    if (id === guard.admin.adminId && body.is_active === false) {
      return NextResponse.json({ error: "현재 로그인한 본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const updated = await supabase
      .from("admin_profiles")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (updated.error) throw updated.error;

    await logAction(supabase, guard.admin, "admin.update", "admin_profiles", id, {
      changed: Object.keys(patch)
    });

    return NextResponse.json({ ok: true, admin: publicAdmin(updated.data) });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
