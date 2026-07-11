import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSafeProfile, getAdminSessionFromRequest } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  const guard = requireAdmin(request, "view_dashboard");
  if (!guard.ok) return guard.response;

  try {
    const supabase = getSupabaseAdmin();
    const currentAdmin = getAdminSessionFromRequest(request);

    const [
      periodsRes,
      teachersRes,
      classesRes,
      assignmentsRes,
      qrLinksRes,
      questionsRes,
      responsesRes,
      metricsRes,
      classScoresRes,
      monthlyScoresRes,
      questionScoresRes,
      reportExportsRes,
      reportShareLinksRes,
      slackMessageLogsRes,
      responseImportBatchesRes,
      responseImportErrorsRes,
      adminProfilesRes,
      adminLoginLogsRes,
      actionLogsRes
    ] = await Promise.all([
      supabase.from("evaluation_periods").select("*").order("year_month", { ascending: false }),
      supabase.from("teachers").select("*").order("is_active", { ascending: false }).order("name"),
      supabase.from("classes").select("*").order("is_active", { ascending: false }).order("name"),
      supabase.from("teacher_class_assignments").select("*, teachers(*), classes(*), evaluation_periods(*)").order("created_at", { ascending: false }),
      supabase.from("teacher_qr_links").select("*, teachers(*), classes(*), evaluation_periods(*)").order("created_at", { ascending: false }),
      supabase.from("evaluation_questions").select("*").eq("is_active", true).order("display_order"),
      supabase.from("evaluation_responses").select("*, teachers(*), classes(*), evaluation_answers(*, evaluation_questions(*))").order("submitted_at", { ascending: false }),
      supabase.from("teacher_monthly_metrics").select("*"),
      supabase.from("v_teacher_class_monthly_scores").select("*"),
      supabase.from("v_teacher_monthly_scores").select("*"),
      supabase.from("v_teacher_question_monthly_scores").select("*"),
      supabase
        .from("teacher_report_exports")
        .select("*, teachers(*), evaluation_periods(*)")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("teacher_report_share_links")
        .select("*, teachers(*), evaluation_periods(*), teacher_report_exports(*)")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("slack_message_logs")
        .select("*, teachers(*), evaluation_periods(*), teacher_report_share_links(*)")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("response_import_batches")
        .select("*, evaluation_periods(*), admin_profiles:created_by(id, name, email)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("response_import_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      currentAdmin?.role === "super_admin"
        ? supabase.from("admin_profiles").select("id, email, name, role, is_active, last_login_at, created_at, updated_at, memo").order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      currentAdmin?.role === "super_admin"
        ? supabase.from("admin_login_logs").select("*, admin_profiles(id, name, email, role)").order("created_at", { ascending: false }).limit(30)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("action_logs")
        .select("*, admin_profiles:actor_admin_id(id, name, email, role)")
        .order("created_at", { ascending: false })
        .limit(120)
    ]);

    const classMappingsRes = await supabase
      .from("class_name_mappings")
      .select("*, from_class:classes!class_name_mappings_from_class_id_fkey(*), to_class:classes!class_name_mappings_to_class_id_fkey(*)")
      .order("created_at", { ascending: false });

    const classMappingsError = classMappingsRes.error
      ? String(classMappingsRes.error.message || "").toLowerCase().includes("class_name_mappings")
        || String(classMappingsRes.error.message || "").toLowerCase().includes("schema cache")
        ? null
        : classMappingsRes.error
      : null;

    const errors = [
      periodsRes.error,
      teachersRes.error,
      classesRes.error,
      assignmentsRes.error,
      qrLinksRes.error,
      questionsRes.error,
      responsesRes.error,
      metricsRes.error,
      classScoresRes.error,
      monthlyScoresRes.error,
      questionScoresRes.error,
      reportExportsRes.error,
      reportShareLinksRes.error,
      slackMessageLogsRes.error,
      responseImportBatchesRes.error,
      responseImportErrorsRes.error,
      adminProfilesRes.error,
      adminLoginLogsRes.error,
      actionLogsRes.error,
      classMappingsError
    ].filter(Boolean);

    if (errors.length) {
      return NextResponse.json({ error: errors[0]?.message }, { status: 500 });
    }

    return NextResponse.json({
      periods: periodsRes.data || [],
      teachers: teachersRes.data || [],
      classes: classesRes.data || [],
      assignments: assignmentsRes.data || [],
      qrLinks: qrLinksRes.data || [],
      questions: questionsRes.data || [],
      responses: responsesRes.data || [],
      metrics: metricsRes.data || [],
      classScores: classScoresRes.data || [],
      monthlyScores: monthlyScoresRes.data || [],
      questionScores: questionScoresRes.data || [],
      reportExports: reportExportsRes.data || [],
      reportShareLinks: reportShareLinksRes.data || [],
      slackMessageLogs: slackMessageLogsRes.data || [],
      responseImportBatches: responseImportBatchesRes.data || [],
      responseImportErrors: responseImportErrorsRes.data || [],
      currentAdmin: adminSafeProfile(currentAdmin),
      adminProfiles: adminProfilesRes.data || [],
      adminLoginLogs: adminLoginLogsRes.data || [],
      actionLogs: actionLogsRes.data || [],
      classMappings: classMappingsRes.error ? [] : (classMappingsRes.data || [])
    });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
