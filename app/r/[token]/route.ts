import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME = "teacher-reports";

function htmlMessage(title: string, message: string, status = 200) {
  return new NextResponse(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif}
main{max-width:720px;margin:12vh auto;background:white;border:1px solid #e5e7eb;border-radius:24px;padding:32px;box-shadow:0 24px 60px rgba(15,23,42,.08)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.logo{width:104px;height:auto;display:block;object-fit:contain}
.name{font-weight:950;letter-spacing:-.05em}
.sub{font-size:13px;color:#64748b;font-weight:800}
h1{font-size:28px;margin:0 0 12px;letter-spacing:-.04em}
p{line-height:1.7;color:#475569}
</style>
</head>
<body><main><div class="brand"><img class="logo" src="/academy-logo.png" alt="목동유쌤영어학원" /><div><div class="sub">e강의평가 리포트 시스템</div></div></div><h1>${title}</h1><p>${message}</p></main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params.token || "").trim();

  if (!token) {
    return htmlMessage("리포트 링크 오류", "리포트 토큰이 없습니다.", 400);
  }

  try {
    const supabase = getSupabaseAdmin();

    const linkRes = await supabase
      .from("teacher_report_share_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (linkRes.error) throw linkRes.error;
    const link = linkRes.data;

    if (!link) {
      return htmlMessage("리포트 링크를 찾을 수 없습니다", "주소가 잘못되었거나 링크가 재생성되었을 수 있습니다.", 404);
    }

    if (link.is_active === false) {
      return htmlMessage("리포트 링크가 비활성화되었습니다", "이 리포트 링크는 더 이상 사용할 수 없습니다. 관리자에게 문의해주세요.", 403);
    }

    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return htmlMessage("리포트 링크가 만료되었습니다", "이 리포트 링크는 만료되었습니다. 관리자에게 문의해주세요.", 410);
    }

    const exportRes = await supabase
      .from("teacher_report_exports")
      .select("*")
      .eq("id", link.report_export_id)
      .single();

    if (exportRes.error) throw exportRes.error;

    const filePath = String(exportRes.data?.file_url || "");
    if (!filePath) {
      return htmlMessage("리포트 저장본이 없습니다", "리포트 파일이 아직 저장되지 않았거나 삭제되었습니다.", 404);
    }

    const downloaded = await supabase.storage.from(BUCKET_NAME).download(filePath);
    if (downloaded.error || !downloaded.data) {
      throw downloaded.error || new Error("Storage 저장본을 다운로드하지 못했습니다.");
    }

    await supabase
      .from("teacher_report_share_links")
      .update({
        view_count: Number(link.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", link.id);

    const buffer = Buffer.from(await downloaded.data.arrayBuffer());
    const isPdf = filePath.toLowerCase().endsWith(".pdf");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": isPdf ? "application/pdf" : "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow"
      }
    });
  } catch (error: any) {
    return htmlMessage("리포트 열람 오류", toSafeErrorMessage(error), 500);
  }
}
