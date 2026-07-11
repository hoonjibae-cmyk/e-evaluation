import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";

const BUCKET_NAME = "teacher-reports";

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  try {
    const exportId = request.nextUrl.searchParams.get("exportId");
    if (!exportId) {
      return NextResponse.json({ error: "출력 이력 ID가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const row = await supabase
      .from("teacher_report_exports")
      .select("*")
      .eq("id", exportId)
      .single();

    if (row.error) throw row.error;
    if (!row.data?.file_url) {
      return NextResponse.json({ error: "저장된 파일 경로가 없습니다." }, { status: 404 });
    }

    const filePath = String(row.data.file_url);

    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      return NextResponse.json({ url: filePath });
    }

    const signed = await supabase.storage.from(BUCKET_NAME).createSignedUrl(filePath, 60 * 60);
    if (signed.error) throw signed.error;

    return NextResponse.json({ url: signed.data.signedUrl });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
