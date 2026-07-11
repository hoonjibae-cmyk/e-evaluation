import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin, getAppUrl } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSlackToken() {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN 환경변수가 없습니다. Vercel에 Slack Bot Token을 등록한 뒤 재배포해주세요.");
  }
  if (token.startsWith("xoxp-")) {
    throw new Error("현재 Vercel의 SLACK_BOT_TOKEN 값이 xoxp-로 시작하는 사용자 토큰입니다. Slack App > OAuth & Permissions의 Bot User OAuth Token(xoxb-...)으로 교체한 뒤 Vercel을 다시 배포해주세요.");
  }
  if (!token.startsWith("xoxb-")) {
    throw new Error("SLACK_BOT_TOKEN은 xoxb-로 시작하는 Bot User OAuth Token이어야 합니다. Slack App > OAuth & Permissions에서 Bot User OAuth Token을 복사했는지 확인해주세요.");
  }
  return token;
}

async function slackGet(method: string, params: Record<string, string>, token: string) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`${method} 실패: ${data.error || res.statusText}`);
  }
  return data;
}

async function slackPost(method: string, payload: Record<string, any>, token: string) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`${method} 실패: ${data.error || res.statusText}`);
  }
  return data;
}

function originFromRequest(request: NextRequest) {
  const configured = getAppUrl();
  if (configured) return configured;
  return request.headers.get("origin") || new URL(request.url).origin;
}

function isInternalReportLink(link: any) {
  const pages = link?.teacher_report_exports?.pages || {};
  const title = String(link?.title || "");
  return pages?.reportTemplate === "internal"
    || pages?.audience === "director_internal"
    || pages?.internalOnly === true
    || title.includes("원장 내부 확인용");
}

async function resolveSlackUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  teacher: any,
  token: string,
  emailOverride?: string
) {
  const email = String(emailOverride || teacher?.slack_email || "").trim();

  if (teacher?.slack_user_id && !emailOverride) return teacher.slack_user_id;

  if (!email) {
    throw new Error("선생님 Slack 이메일이 등록되어 있지 않습니다. 선생님 관리에서 Slack 이메일을 입력한 뒤 다시 눌러주세요.");
  }

  const found = await slackGet("users.lookupByEmail", { email }, token);
  const userId = found?.user?.id;

  if (!userId) {
    throw new Error("Slack 사용자 ID를 찾지 못했습니다. 입력한 이메일이 선생님의 Slack 계정 이메일과 같은지 확인해주세요.");
  }

  const updated = await supabase
    .from("teachers")
    .update({
      slack_email: email,
      slack_user_id: userId,
      slack_dm_enabled: true,
      slack_last_checked_at: new Date().toISOString()
    })
    .eq("id", teacher.id);

  if (updated.error) {
    throw new Error(`Slack 사용자 정보 저장 실패: ${updated.error.message}. v2.2 SQL이 실행되었는지 확인해주세요.`);
  }

  return userId;
}

async function logSlackMessage(supabase: ReturnType<typeof getSupabaseAdmin>, row: Record<string, any>) {
  const inserted = await supabase.from("slack_message_logs").insert(row).select("*").single();
  if (inserted.error) {
    // Slack 발송 자체가 성공했는데 로그 저장 실패로 운영 흐름이 막히지 않게 합니다.
    console.error("slack_message_logs insert failed", inserted.error);
  }
  return inserted.data;
}

export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "export_reports");
  if (!guard.ok) return guard.response;

  const supabase = getSupabaseAdmin();

  let body: any = {};
  try {
    body = await request.json();
    const action = String(body?.action || "");
    const slackToken = getSlackToken();

    if (action === "lookup_teacher" || action === "test_teacher") {
      const teacherId = String(body?.teacherId || "");
      if (!teacherId) {
        return NextResponse.json({ error: "선생님 ID가 없습니다." }, { status: 400 });
      }

      const teacherRes = await supabase.from("teachers").select("*").eq("id", teacherId).single();
      if (teacherRes.error) throw teacherRes.error;

      const slackEmail = String(body?.slackEmail || "").trim();
      const userId = await resolveSlackUser(supabase, teacherRes.data, slackToken, slackEmail);

      if (action === "lookup_teacher") {
        await logAction(supabase, guard.admin, "slack_lookup_teacher", "teachers", teacherId, { slackUserId: userId });
        return NextResponse.json({ ok: true, message: "Slack 사용자 연결을 확인했습니다.", slackUserId: userId });
      }

      const opened = await slackPost("conversations.open", { users: userId }, slackToken);
      const channelId = opened?.channel?.id;
      if (!channelId) throw new Error("Slack DM 채널을 열지 못했습니다.");

      const sent = await slackPost("chat.postMessage", {
        channel: channelId,
        text: `[e강의평가] Slack DM 테스트 메시지입니다.\n${teacherRes.data.name} 선생님 리포트 링크 발송 설정이 정상입니다.`
      }, slackToken);

      await logSlackMessage(supabase, {
        teacher_id: teacherId,
        evaluation_period_id: null,
        report_share_link_id: null,
        slack_user_id: userId,
        slack_channel_id: channelId,
        message_ts: sent.ts || null,
        status: "sent",
        message_text: "Slack DM 테스트 메시지",
        sent_by: guard.admin.adminId
      });

      return NextResponse.json({ ok: true, message: "Slack 테스트 DM을 발송했습니다.", slackUserId: userId });
    }

    if (action === "send_internal_report") {
      const shareLinkId = String(body?.shareLinkId || "");
      if (!shareLinkId) {
        return NextResponse.json({ error: "리포트 링크 ID가 없습니다." }, { status: 400 });
      }

      const linkRes = await supabase
        .from("teacher_report_share_links")
        .select("*, teachers(*), evaluation_periods(*), teacher_report_exports(*)")
        .eq("id", shareLinkId)
        .single();

      if (linkRes.error) throw linkRes.error;
      const link = linkRes.data;

      if (link.is_active === false) {
        throw new Error("비활성화된 리포트 링크는 발송할 수 없습니다.");
      }
      if (!isInternalReportLink(link)) {
        throw new Error("원장 내부 확인용으로 생성된 리포트만 총괄관리자 DM으로 발송할 수 있습니다.");
      }

      const adminsRes = await supabase
        .from("admin_profiles")
        .select("id, email, name, role, is_active")
        .eq("role", "super_admin")
        .eq("is_active", true)
        .order("created_at", { ascending: true });

      if (adminsRes.error) throw adminsRes.error;

      const admins = (adminsRes.data || []).filter((admin: any) => String(admin.email || "").includes("@"));
      if (!admins.length) {
        throw new Error("활성화된 총괄관리자 이메일을 찾지 못했습니다. 관리자 계정의 이메일을 확인해주세요.");
      }

      const period = link.evaluation_periods;
      const reportUrl = `${originFromRequest(request)}/r/${link.token}`;
      const messageText = `[원장 내부 확인용 리포트 생성 완료]\n\n평가월: ${period?.title || "강의평가"}\n리포트 유형: 원장 내부 확인용\n확인 링크: ${reportUrl}\n\n※ 본 리포트는 직원/선생님에게 발송되지 않았습니다.`;

      let sentCount = 0;
      const failures: string[] = [];

      for (const admin of admins) {
        try {
          const found = await slackGet("users.lookupByEmail", { email: String(admin.email || "").trim() }, slackToken);
          const userId = found?.user?.id;
          if (!userId) throw new Error("Slack 사용자 ID를 찾지 못했습니다.");

          const opened = await slackPost("conversations.open", { users: userId }, slackToken);
          const channelId = opened?.channel?.id;
          if (!channelId) throw new Error("Slack DM 채널을 열지 못했습니다.");

          const sent = await slackPost("chat.postMessage", {
            channel: channelId,
            text: messageText
          }, slackToken);

          await logSlackMessage(supabase, {
            teacher_id: null,
            evaluation_period_id: link.evaluation_period_id,
            report_share_link_id: link.id,
            slack_user_id: userId,
            slack_channel_id: channelId,
            message_ts: sent.ts || null,
            status: "sent",
            message_text: messageText,
            sent_by: guard.admin.adminId
          });

          sentCount += 1;
        } catch (error: any) {
          const reason = toSafeErrorMessage(error);
          failures.push(`${admin.name || admin.email}: ${reason}`);
          await logSlackMessage(supabase, {
            teacher_id: null,
            evaluation_period_id: link.evaluation_period_id,
            report_share_link_id: link.id,
            status: "failed",
            error_message: reason,
            sent_by: guard.admin.adminId
          });
        }
      }

      if (sentCount === 0) {
        throw new Error(`총괄관리자 Slack DM 발송 실패: ${failures[0] || "Slack 계정 이메일을 확인해주세요."}`);
      }

      await logAction(supabase, guard.admin, "send_internal_report_to_super_admin", "teacher_report_share_links", link.id, {
        evaluationPeriodId: link.evaluation_period_id,
        sentCount,
        failures
      });

      const failureNotice = failures.length ? ` 실패 ${failures.length}건: ${failures[0]}` : "";
      return NextResponse.json({
        ok: true,
        message: `총괄관리자 Slack DM ${sentCount}건을 발송했습니다.${failureNotice}`
      });
    }

    if (action === "send_report") {
      const shareLinkId = String(body?.shareLinkId || "");
      if (!shareLinkId) {
        return NextResponse.json({ error: "리포트 링크 ID가 없습니다." }, { status: 400 });
      }

      const linkRes = await supabase
        .from("teacher_report_share_links")
        .select("*, teachers(*), evaluation_periods(*), teacher_report_exports(*)")
        .eq("id", shareLinkId)
        .single();

      if (linkRes.error) throw linkRes.error;
      const link = linkRes.data;

      if (link.is_active === false) {
        throw new Error("비활성화된 리포트 링크는 발송할 수 없습니다.");
      }
      if (isInternalReportLink(link)) {
        throw new Error("원장 내부 확인용 리포트는 선생님/직원에게 Slack DM으로 발송할 수 없습니다. 총괄관리자 DM으로만 발송하세요.");
      }

      const teacher = link.teachers;
      const period = link.evaluation_periods;
      const userId = await resolveSlackUser(supabase, teacher, slackToken);
      const opened = await slackPost("conversations.open", { users: userId }, slackToken);
      const channelId = opened?.channel?.id;
      if (!channelId) throw new Error("Slack DM 채널을 열지 못했습니다.");

      const reportUrl = `${originFromRequest(request)}/r/${link.token}`;
      const messageText = `[${period?.title || "강의평가"} 리포트]\n\n${teacher?.name || "선생님"} 선생님,\n강의평가 웹 리포트가 생성되었습니다.\n\n리포트 보기: ${reportUrl}\n\n※ 본 링크는 내부 공유용입니다. 학생 이름은 표시되지 않습니다.`;

      const sent = await slackPost("chat.postMessage", {
        channel: channelId,
        text: messageText
      }, slackToken);

      await logSlackMessage(supabase, {
        teacher_id: teacher.id,
        evaluation_period_id: link.evaluation_period_id,
        report_share_link_id: link.id,
        slack_user_id: userId,
        slack_channel_id: channelId,
        message_ts: sent.ts || null,
        status: "sent",
        message_text: messageText,
        sent_by: guard.admin.adminId
      });

      await logAction(supabase, guard.admin, "send_slack_report_link", "teacher_report_share_links", link.id, {
        teacherId: teacher.id,
        evaluationPeriodId: link.evaluation_period_id
      });

      return NextResponse.json({ ok: true, message: "Slack DM으로 리포트 링크를 발송했습니다.", slackUserId: userId });
    }

    return NextResponse.json({ error: "지원하지 않는 Slack 작업입니다." }, { status: 400 });
  } catch (error: any) {
    // 발송 실패도 가능한 범위에서 이력에 남깁니다.
    try {
      const shareLinkId = String(body?.shareLinkId || "");
      if (shareLinkId) {
        const linkRes = await supabase
          .from("teacher_report_share_links")
          .select("*")
          .eq("id", shareLinkId)
          .maybeSingle();

        await logSlackMessage(supabase, {
          teacher_id: String(body?.action || "") === "send_internal_report" ? null : (linkRes.data?.teacher_id || null),
          evaluation_period_id: linkRes.data?.evaluation_period_id || null,
          report_share_link_id: shareLinkId,
          status: "failed",
          error_message: toSafeErrorMessage(error),
          sent_by: guard.admin.adminId
        });
      }
    } catch {
      // 실패 로그 저장 실패는 무시합니다.
    }

    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
