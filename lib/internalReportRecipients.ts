// 원장 내부 확인용 리포트의 Slack DM 수신 대상을 찾습니다.
//
// 수신 대상은 admin_profiles.receives_internal_report = true 인 활성 계정입니다.
// 권한(role)과는 별개라서, 일반관리자에게 총괄관리자 권한을 주지 않고도 리포트만 받게 할 수 있습니다.
//
// 아직 v2.6.19 SQL을 실행하지 않았거나(컬럼 없음) 지정된 수신자가 한 명도 없으면,
// 예전처럼 '활성 총괄관리자 전원'으로 되돌아갑니다. (리포트가 아무에게도 안 가는 상황 방지)

export type InternalReportRecipient = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
};

export type InternalReportRecipientLookup = {
  recipients: InternalReportRecipient[];
  /** 지정 수신자를 쓰지 못하고 총괄관리자 전원으로 대체했는지 */
  usedSuperAdminFallback: boolean;
  /** receives_internal_report 컬럼이 아직 없는지 (SQL 미실행) */
  columnMissing: boolean;
};

function isMissingColumnError(error: any) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  return code === "42703" || code === "PGRST204" || message.includes("receives_internal_report");
}

function withEmail(rows: any[]): InternalReportRecipient[] {
  return (rows || []).filter((row: any) => String(row?.email || "").includes("@"));
}

export async function loadInternalReportRecipients(supabase: any): Promise<InternalReportRecipientLookup> {
  const flagged = await supabase
    .from("admin_profiles")
    .select("id, email, name, role, is_active")
    .eq("is_active", true)
    .eq("receives_internal_report", true)
    .order("created_at", { ascending: true });

  const columnMissing = Boolean(flagged.error) && isMissingColumnError(flagged.error);
  if (flagged.error && !columnMissing) throw flagged.error;

  if (!columnMissing) {
    const rows = withEmail(flagged.data);
    if (rows.length) {
      return { recipients: rows, usedSuperAdminFallback: false, columnMissing: false };
    }
  }

  const superAdmins = await supabase
    .from("admin_profiles")
    .select("id, email, name, role, is_active")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (superAdmins.error) throw superAdmins.error;

  return {
    recipients: withEmail(superAdmins.data),
    usedSuperAdminFallback: true,
    columnMissing
  };
}

export { isMissingColumnError };
