import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 진단용(민감정보 없음): 이 함수가 실행되는 Vercel 리전과 Supabase까지의 왕복 시간을 보여줍니다.
// 브라우저에서 /api/region 을 열어 확인하세요.
//  - region 이 hnd1 이면 도쿄(Supabase와 같은 리전), iad1 이면 미국 동부(느림)
//  - dbPingMs 가 함수↔DB 왕복 시간(같은 리전이면 보통 5~30ms, 대륙 넘으면 250~450ms)
export async function GET() {
  const region = process.env.VERCEL_REGION || "unknown(local)";

  const pings: number[] = [];
  let dbError: string | null = null;
  try {
    const supabase = getSupabaseAdmin();
    for (let i = 0; i < 3; i += 1) {
      const t0 = Date.now();
      const res = await supabase.from("evaluation_periods").select("id", { count: "exact", head: true });
      pings.push(Date.now() - t0);
      if (res.error) {
        dbError = res.error.message;
        break;
      }
    }
  } catch (error: any) {
    dbError = String(error?.message || error);
  }

  const dbPingMs = pings.length ? Math.min(...pings) : null;

  return NextResponse.json({
    region,
    dbPingMs,
    dbPingSamplesMs: pings,
    dbError,
    hint:
      region.startsWith("hnd1")
        ? "함수가 도쿄에서 실행 중입니다(Supabase와 동일 리전)."
        : region.startsWith("iad1")
        ? "함수가 미국 동부(iad1)에서 실행 중입니다. Supabase(도쿄)와 멀어 느립니다. 리전 이전 필요."
        : `함수 리전: ${region}`
  });
}
