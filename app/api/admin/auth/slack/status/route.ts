import { NextResponse } from "next/server";
import { slackAuthConfigured, slackLoginEnforced } from "@/lib/slackAdminAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: slackAuthConfigured(), enforced: slackLoginEnforced() }, {
    headers: { "Cache-Control": "no-store" }
  });
}
