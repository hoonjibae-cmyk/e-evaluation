// 원장 리포트 DM 수신 후보 조회. 관리자 Slack 로그인 판정과 독립적으로 유지한다.
export type ReportRecipientStaff = {
  empNo: string;
  name: string;
  email: string;
  department: "경영지원" | "교육운영팀" | "교수부";
  role: "admin" | "operations" | "report_viewer";
  slackLinked: boolean;
};

export function parseReportRecipientDirectory(payload: unknown): ReportRecipientStaff[] {
  if (!payload || typeof payload !== "object") throw new Error("HR directory response is invalid");
  const data = payload as Record<string, unknown>;
  if (data.app !== "e-evaluation" || !Array.isArray(data.items) ||
      !Number.isInteger(data.count) || data.count !== data.items.length) {
    throw new Error("HR directory response is invalid");
  }
  const seenEmpNos = new Set<string>();
  const seenEmails = new Set<string>();
  return data.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("HR directory staff is invalid");
    const row = item as Record<string, unknown>;
    const allowed = (row.department === "경영지원" && row.role === "admin") ||
      (row.department === "교육운영팀" && row.role === "operations") ||
      (row.department === "교수부" && row.role === "report_viewer");
    if (!allowed || typeof row.empNo !== "string" || !row.empNo.trim() ||
        typeof row.name !== "string" || !row.name.trim() ||
        typeof row.email !== "string" || typeof row.slackLinked !== "boolean" ||
        seenEmpNos.has(row.empNo.trim()) ||
        (row.email.trim() && seenEmails.has(row.email.trim().toLowerCase()))) {
      throw new Error("HR directory staff is invalid");
    }
    seenEmpNos.add(row.empNo.trim());
    if (row.email.trim()) seenEmails.add(row.email.trim().toLowerCase());
    return {
      empNo: row.empNo.trim(),
      name: row.name.trim(),
      email: row.email.trim().toLowerCase(),
      department: row.department,
      role: row.role,
      slackLinked: row.slackLinked
    } as ReportRecipientStaff;
  });
}

export async function listReportRecipientDirectory(): Promise<ReportRecipientStaff[]> {
  const url = new URL(process.env.HR_DIRECTORY_URL!);
  if (url.protocol !== "https:") throw new Error("HTTPS HR directory required");
  url.searchParams.set("app", "e-evaluation");
  url.searchParams.delete("slackUserId");
  const response = await fetch(url, {
    headers: { "x-api-key": process.env.HR_DIRECTORY_API_KEY! },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`HR directory unavailable (${response.status})`);
  return parseReportRecipientDirectory(await response.json());
}

export function profileMatchesHrRecipient(
  profile: { email: string; role: string },
  staff: ReportRecipientStaff
) {
  if (!staff.slackLinked || !staff.email || staff.email !== profile.email.trim().toLowerCase()) return false;
  return (profile.role === "super_admin" && staff.department === "경영지원" && staff.role === "admin") ||
    (profile.role === "general_admin" && staff.department === "교육운영팀" && staff.role === "operations") ||
    (profile.role === "report_viewer" && staff.department === "교수부" && staff.role === "report_viewer");
}
