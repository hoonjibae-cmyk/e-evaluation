import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME = "teacher-reports";

function safeFileName(value: string) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "report";
}

function dateStamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function htmlEscape(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportExtension(row: any) {
  const format = row?.pages?.savedFormat;
  const path = String(row?.file_url || "").toLowerCase();
  if (format === "pdf" || path.endsWith(".pdf")) return "pdf";
  return "html";
}

function buildIndexHtml(rows: any[]) {
  const lines = rows.map((row, index) => {
    const extension = exportExtension(row);
    const fileName = `reports/report-${String(index + 1).padStart(3, "0")}.${extension}`;
    const typeLabel = extension === "pdf" ? "PDF" : "HTML";
    return `<tr>
<td>${index + 1}</td>
<td>${htmlEscape(row.evaluation_periods?.title || "-")}</td>
<td>${htmlEscape(row.teachers?.name ? `${row.teachers.name} 선생님` : "-")}</td>
<td>${typeLabel}</td>
<td>${htmlEscape(row.created_at || row.exported_at || "-")}</td>
<td><a href="${fileName}">${fileName}</a></td>
</tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>e강의평가 결과지 저장본 목록</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;margin:32px;line-height:1.6;color:#111827}
h1{font-size:28px;margin:0 0 8px}
p{color:#4b5563}
table{border-collapse:collapse;width:100%;margin-top:20px}
th,td{border:1px solid #e5e7eb;padding:10px;text-align:left;vertical-align:top}
th{background:#f9fafb}
a{color:#2563eb}
.notice{border:1px solid #e5e7eb;background:#f9fafb;border-radius:14px;padding:14px;margin-top:18px}
</style>
</head>
<body>
<h1>e강의평가 결과지 저장본 목록</h1>
<p>이 ZIP 파일은 Supabase 서버에 보관된 선생님별 PDF/HTML 결과지를 모은 파일입니다.</p>
<div class="notice">
<b>사용 방법</b><br/>
PDF 파일은 바로 열어 확인하거나 출력할 수 있습니다.<br/>
HTML 파일은 브라우저에서 열어 Ctrl + P → PDF로 저장 방식으로 사용할 수 있습니다.
</div>
<table>
<thead><tr><th>No.</th><th>평가월</th><th>선생님</th><th>형식</th><th>보관 시각</th><th>파일</th></tr></thead>
<tbody>
${lines}
</tbody>
</table>
</body>
</html>`;
}

function buildReadme(rows: any[]) {
  const list = rows.map((row, index) => {
    const extension = exportExtension(row);
    return `${String(index + 1).padStart(3, "0")}. ${row.evaluation_periods?.title || "-"} / ${row.teachers?.name || "-"} 선생님 / reports/report-${String(index + 1).padStart(3, "0")}.${extension}`;
  }).join("\n");

  return `e강의평가 결과지 저장본 ZIP

이 파일은 결과지 PDF/HTML 저장본 묶음입니다.

사용 방법
1. index.html을 엽니다.
2. PDF 파일은 바로 열어 확인하거나 출력합니다.
3. HTML 파일은 브라우저에서 열고 Ctrl + P를 눌러 PDF로 저장할 수 있습니다.

포함 파일
${list}
`;
}

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  try {
    const evaluationPeriodId = request.nextUrl.searchParams.get("evaluationPeriodId");
    const teacherId = request.nextUrl.searchParams.get("teacherId");
    const mode = request.nextUrl.searchParams.get("mode") || "period";

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("teacher_report_exports")
      .select("*, teachers(*), evaluation_periods(*)")
      .not("file_url", "is", null)
      .in("status", ["created", "printed"])
      .order("created_at", { ascending: false })
      .limit(300);

    if (evaluationPeriodId) query = query.eq("evaluation_period_id", evaluationPeriodId);
    if (teacherId) query = query.eq("teacher_id", teacherId);

    const exportsRes = await query;
    if (exportsRes.error) throw exportsRes.error;

    const rows = exportsRes.data || [];
    if (!rows.length) {
      return NextResponse.json({
        error: mode === "all"
          ? "ZIP으로 묶을 저장본이 없습니다. 먼저 결과지 생성에서 [PDF 자동 생성/저장] 또는 [HTML 저장본 보관]을 실행해주세요."
          : "선택한 조건에 저장본이 없습니다. 먼저 결과지 생성에서 [PDF 자동 생성/저장] 또는 [HTML 저장본 보관]을 실행해주세요."
      }, { status: 404 });
    }

    const zip = new JSZip();
    const includedRows: any[] = [];

    for (const row of rows) {
      const filePath = String(row.file_url || "");
      if (!filePath) continue;

      const downloaded = await supabase.storage.from(BUCKET_NAME).download(filePath);
      if (downloaded.error || !downloaded.data) {
        continue;
      }

      const buffer = Buffer.from(await downloaded.data.arrayBuffer());
      const extension = exportExtension(row);
      const fileName = `reports/report-${String(includedRows.length + 1).padStart(3, "0")}.${extension}`;
      zip.file(fileName, buffer);
      includedRows.push(row);
    }

    if (!includedRows.length) {
      return NextResponse.json({
        error: "출력 이력은 있지만 Storage 저장본 파일을 다운로드하지 못했습니다. 출력 이력에서 저장본 열기가 되는지 확인해주세요."
      }, { status: 500 });
    }

    zip.file("index.html", buildIndexHtml(includedRows));
    zip.file("README.txt", "\ufeff" + buildReadme(includedRows));

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    const periodLabel = evaluationPeriodId && includedRows[0]?.evaluation_periods?.year_month
      ? safeFileName(includedRows[0].evaluation_periods.year_month)
      : "all";
    const teacherLabel = teacherId && includedRows[0]?.teachers?.name
      ? safeFileName(includedRows[0].teachers.name)
      : "teachers";

    const downloadName = `e-evaluation-reports-${periodLabel}-${teacherLabel}-${dateStamp()}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
