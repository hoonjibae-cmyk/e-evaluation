import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";

const MAX_CLASS_UPLOAD_BYTES = 3 * 1024 * 1024;

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function normalizeKey(value: any) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function looksLikeHeader(row: any[]) {
  const joined = row.map((cell) => String(cell ?? "").trim()).join(" ").toLowerCase();
  return (
    joined.includes("반") ||
    joined.includes("class") ||
    joined.includes("학년") ||
    joined.includes("요일") ||
    joined.includes("캠퍼스") ||
    joined.includes("상태")
  );
}

function parseIsActive(value: any) {
  const text = normalizeKey(value);
  if (!text) return true;
  if (["비활성", "사용안함", "미사용", "inactive", "false", "0", "no", "n", "off"].includes(text)) return false;
  return true;
}

function worksheetRowsFromWorkbook(workbook: XLSX.WorkBook) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [] as any[][];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: ""
  });
}

function compactRows(rows: any[][]) {
  return rows
    .map((row) => row.map((cell) => (typeof cell === "string" ? cell.trim() : cell)))
    .filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0));
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const formData = await request.formData();
    const fileValue = formData.get("file");

    if (!fileValue || !(fileValue instanceof File)) {
      return NextResponse.json({ error: "업로드할 엑셀 파일을 선택해주세요." }, { status: 400 });
    }

    if (fileValue.size > MAX_CLASS_UPLOAD_BYTES) {
      return NextResponse.json({ error: "파일 크기가 너무 큽니다. 반 명단 파일은 3MB 이하로 업로드해주세요." }, { status: 400 });
    }

    const fileName = String(fileValue.name || "class-upload.xlsx");
    const lowerName = fileName.toLowerCase();

    if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls") && !lowerName.endsWith(".csv")) {
      return NextResponse.json({ error: "xlsx, xls, csv 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const arrayBuffer = await fileValue.arrayBuffer();
    const workbook = lowerName.endsWith(".csv")
      ? XLSX.read(new TextDecoder("utf-8").decode(new Uint8Array(arrayBuffer)), { type: "string" })
      : XLSX.read(arrayBuffer, { type: "array" });

    let rows = compactRows(worksheetRowsFromWorkbook(workbook));

    if (!rows.length) {
      return NextResponse.json({ error: "엑셀 첫 번째 시트에서 읽을 수 있는 행이 없습니다." }, { status: 400 });
    }

    if (looksLikeHeader(rows[0])) {
      rows = rows.slice(1);
    }

    if (!rows.length) {
      return NextResponse.json({ error: "헤더를 제외하면 등록할 반 데이터가 없습니다." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const existingRes = await supabase.from("classes").select("name");
    if (existingRes.error) throw existingRes.error;

    const existingNames = new Set((existingRes.data || []).map((row: any) => String(row.name || "")));
    const seenInFile = new Set<string>();
    const skipped: string[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const [nameRaw, gradeRaw, dayPatternRaw, campusRaw, memoRaw, activeRaw] = rows[i];
      const name = cleanText(nameRaw);

      if (!name) {
        skipped.push(`${i + 1}번째 데이터 줄: 반 이름이 비어 있습니다.`);
        continue;
      }

      if (seenInFile.has(name)) {
        skipped.push(`${i + 1}번째 데이터 줄: 같은 파일 안에 중복된 반 이름이 있어 건너뜁니다. (${name})`);
        continue;
      }
      seenInFile.add(name);

      const payload = {
        name,
        grade: cleanText(gradeRaw),
        day_pattern: cleanText(dayPatternRaw),
        campus: cleanText(campusRaw),
        memo: cleanText(memoRaw),
        is_active: parseIsActive(activeRaw),
        updated_at: new Date().toISOString()
      };

      const upsertRes = await supabase
        .from("classes")
        .upsert(payload, { onConflict: "name" })
        .select("id")
        .single();

      if (upsertRes.error) throw upsertRes.error;

      if (existingNames.has(name)) {
        updated += 1;
      } else {
        created += 1;
        existingNames.add(name);
      }
    }

    await logAction(supabase, guard.admin, "bulk_upload_classes_excel", "classes", null, {
      fileName,
      created,
      updated,
      skipped: skipped.length
    });

    return NextResponse.json({
      ok: true,
      type: "classes_excel",
      fileName,
      created,
      updated,
      skipped,
      message: `반 엑셀 업로드 완료: 신규 ${created}개, 갱신 ${updated}개, 건너뜀 ${skipped.length}건`
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
