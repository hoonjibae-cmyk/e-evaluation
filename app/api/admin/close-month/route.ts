import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAction } from "@/lib/adminGuard";
import { getSupabaseAdmin, getAppUrl } from "@/lib/supabaseServer";
import { toSafeErrorMessage } from "@/lib/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: any) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function getSlackToken() {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token || !token.startsWith("xoxb-")) return null;
  return token;
}

async function slackGet(method: string, params: Record<string, string>, token: string) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`${method} 실패: ${data.error || res.statusText}`);
  return data;
}

async function slackPost(method: string, payload: Record<string, any>, token: string) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`${method} 실패: ${data.error || res.statusText}`);
  return data;
}

// 해당월 설문조사 마감처리: 평가월을 '마감(closed)'으로 변경 + 총괄관리자에게 Slack 알림
export async function POST(request: NextRequest) {
  const guard = requireAdmin(request, "manage_master_data");
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const periodId = cleanText(body.evaluation_period_id);
    if (!periodId) {
      return NextResponse.json({ error: "마감할 평가월을 선택해주세요." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const periodRes = await supabase
      .from("evaluation_periods")
      .select("id, title, year_month, status, is_locked")
      .eq("id", periodId)
      .single();
    if (periodRes.error) throw periodRes.error;
    const period = periodRes.data;

    if (period.is_locked) {
      return NextResponse.json({ error: "이미 운영 안전 잠금된 평가월입니다. 잠금 해제 후 진행해주세요." }, { status: 400 });
    }

    // 1) 평가월 상태를 '마감'으로 변경 (해당 평가월만; 다른 달은 영향 없음)
    const updateRes = await supabase
      .from("evaluation_periods")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("id", periodId);
    if (updateRes.error) throw updateRes.error;

    await logAction(supabase, guard.admin, "close_month", "evaluation_periods", periodId, {
      title: period.title,
      previous_status: period.status
    });

    // 2) 총괄관리자에게 Slack 알림 (실패해도 마감 자체는 유지)
    const slackResult: { sent: number; failed: number; error: string | null } = { sent: 0, failed: 0, error: null };
    const token = getSlackToken();
    if (!token) {
      slackResult.error = "SLACK_BOT_TOKEN(xoxb-)이 설정되지 않아 알림을 보내지 못했습니다.";
    } else {
      try {
        const adminsRes = await supabase
          .from("admin_profiles")
          .select("email, name")
          .eq("role", "super_admin")
          .eq("is_active", true);
        if (adminsRes.error) throw adminsRes.error;
        const admins = (adminsRes.data || []).filter((a: any) => String(a.email || "").includes("@"));

        if (!admins.length) {
          slackResult.error = "활성화된 총괄관리자 이메일이 없어 알림을 보내지 못했습니다.";
        } else {
          const closedBy = guard.admin.name || guard.admin.email || "관리자";
          const appUrl = getAppUrl() || new URL(request.url).origin;
          const messageText =
            `[설문조사 마감 알림]\n\n` +
            `${period.title} 설문조사가 마감 처리되었습니다.\n` +
            `처리자: ${closedBy}\n` +
            `상태: 진행중 → 마감(closed)\n\n` +
            `이제 '원장 내부 확인용 리포트'를 생성하실 수 있습니다.\n${appUrl}`;

          for (const admin of admins) {
            try {
              const found = await slackGet("users.lookupByEmail", { email: String(admin.email).trim() }, token);
              const userId = found?.user?.id;
              if (!userId) throw new Error("Slack 사용자 ID를 찾지 못했습니다.");
              const opened = await slackPost("conversations.open", { users: userId }, token);
              const channelId = opened?.channel?.id;
              if (!channelId) throw new Error("Slack DM 채널을 열지 못했습니다.");
              await slackPost("chat.postMessage", { channel: channelId, text: messageText }, token);
              slackResult.sent += 1;
            } catch (err: any) {
              slackResult.failed += 1;
              slackResult.error = `${admin.name || admin.email}: ${toSafeErrorMessage(err)}`;
            }
          }
        }
      } catch (err: any) {
        slackResult.error = toSafeErrorMessage(err);
      }
    }

    const parts = [`${period.title}을(를) 마감 처리했습니다. 평가월 관리에서 '마감' 상태로 변경되었습니다.`];
    if (slackResult.sent) parts.push(`총괄관리자 ${slackResult.sent}명에게 Slack 알림을 보냈습니다.`);
    if (slackResult.error) parts.push(`(Slack 알림 일부/전체 실패: ${slackResult.error})`);

    return NextResponse.json({ ok: true, slack: slackResult, message: parts.join(" ") });
  } catch (error: any) {
    return NextResponse.json({ error: toSafeErrorMessage(error) }, { status: 500 });
  }
}
