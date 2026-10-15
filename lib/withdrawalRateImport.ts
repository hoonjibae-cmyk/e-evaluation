/**
 * 학생 카드가 보내는 **월별 퇴원율 확정 자료** → 선생님별 퇴원율 입력 줄 (순수 함수, 테스트 있음).
 *
 * 왜 여기서 맞추나
 * ---------------
 * 학생 카드의 담임 이름과 여기 선생님 이름(name · display_name)은 둘 다 HR Manager 명부에서 온 같은
 * 이름이다. 그래서 **이름으로** 맞춘다. 공백은 지우고 비교한다("이 서영" 도 "이서영"). 못 맞춘 이름은
 * 버리지 않고 돌려주어 사람이 보게 한다 — 조용히 빠지면 그 선생님의 퇴원율만 비어 있는 채로 남는다.
 */

export interface IncomingRateRow {
  teacher: string;
  department?: string;
  /** 보낼 퇴원율 (%) — 학생 카드 화면의 큰 숫자(원래 퇴원율). 분모가 0 이면 null */
  withdrawalRatePercent: number | null;
  /** 특수 퇴원(고3 졸업 · 이사 등)을 뺀 조정 퇴원율 (%) — 메모에만 적는다 */
  adjustedRatePercent?: number | null;
  special?: number;
  counts?: Record<string, number>;
  memo?: string;
}

export interface TeacherLike {
  id: string;
  name: string | null;
  display_name?: string | null;
  is_active?: boolean | null;
}

export const normalizeName = (s: unknown) => String(s ?? "").replace(/\s+/g, "").trim();

/** 0~100 사이, 소수점 둘째 자리 — 아니면 null */
export function clampPercent(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

const toCount = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/** 받은 본문의 rows 를 믿지 않고 하나씩 다듬는다 — 이름 없는 줄은 버린다 */
export function parseIncomingRows(raw: unknown): IncomingRateRow[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingRateRow[] = [];
  for (const r of raw) {
    const teacher = String((r as any)?.teacher ?? "").trim();
    if (!teacher) continue;
    const counts: Record<string, number> = {};
    const c = (r as any)?.counts;
    if (c && typeof c === "object") {
      for (const k of ["a", "b", "c", "d", "e", "g"]) if (k in c) counts[k] = toCount((c as any)[k]);
    }
    out.push({
      teacher,
      department: String((r as any)?.department ?? "").trim() || undefined,
      withdrawalRatePercent: clampPercent((r as any)?.withdrawalRatePercent),
      adjustedRatePercent: clampPercent((r as any)?.adjustedRatePercent),
      special: toCount((r as any)?.special),
      counts,
      memo: String((r as any)?.memo ?? "").trim().slice(0, 300) || undefined,
    });
  }
  return out;
}

export interface MatchResult {
  matched: Array<{ teacherId: string; teacherName: string; row: IncomingRateRow }>;
  /** 이름으로 못 찾은 선생님 */
  unmatched: string[];
  /** 찾았지만 퇴원율이 없는(분모 0) 선생님 — 비워 둔 채 둔다 */
  skipped: string[];
}

export function matchTeachers(rows: IncomingRateRow[], teachers: TeacherLike[]): MatchResult {
  const byName = new Map<string, TeacherLike>();
  for (const t of teachers) {
    if (t.is_active === false) continue;
    for (const key of [normalizeName(t.name), normalizeName(t.display_name)]) {
      if (key && !byName.has(key)) byName.set(key, t);
    }
  }
  const out: MatchResult = { matched: [], unmatched: [], skipped: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    const t = byName.get(normalizeName(row.teacher));
    if (!t) { out.unmatched.push(row.teacher); continue; }
    if (seen.has(t.id)) continue;                 // 같은 선생님이 두 줄로 오면 첫 줄만
    seen.add(t.id);
    if (row.withdrawalRatePercent === null) { out.skipped.push(row.teacher); continue; }
    out.matched.push({ teacherId: t.id, teacherName: String(t.name ?? row.teacher), row });
  }
  return out;
}

/** 입력 메모 — 어디서 온 숫자인지, 무엇을 뺀 것인지 (화면의 메모 칸에 그대로 보인다) */
export function buildMemo(
  row: IncomingRateRow,
  ctx: { yearMonth: string; confirmedBy?: string | null; confirmedAt?: string | null }
): string {
  const 날 = String(ctx.confirmedAt || "").slice(0, 10);
  const c = row.counts || {};
  const 부분 = [
    `학생 카드 확정 ${ctx.yearMonth}${ctx.confirmedBy ? ` (${ctx.confirmedBy}${날 ? ` · ${날}` : ""})` : 날 ? ` (${날})` : ""}`,
    row.withdrawalRatePercent !== null ? `퇴원율 ${row.withdrawalRatePercent}%` : "",
    row.special ? `특수 퇴원 ${row.special}명 제외 조정 ${row.adjustedRatePercent ?? "-"}%` : "",
    "a" in c ? `전월 ${c.a} · 신입 ${c.b ?? 0} · 전입 ${c.c ?? 0} · 전출 ${c.d ?? 0} · 퇴원 ${c.e ?? 0}` : "",
    row.memo || "",
  ].filter(Boolean);
  return 부분.join(" — ").slice(0, 500);
}
