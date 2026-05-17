import { NextResponse } from "next/server";
import { getHuaweiConfig } from "@/lib/integrations/huawei/config";
import { buildAuthorizeUrl, buildOAuthState } from "@/lib/integrations/huawei/oauth";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = getHuaweiConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Huawei Health не настроен (env: CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const userId = resolveIntegrationUserId(url.searchParams.get("userId"));
  if (!userId) {
    return NextResponse.json(
      { error: "Нужен userId или WORKOUT_USER_ID на сервере" },
      { status: 400 }
    );
  }

  const state = buildOAuthState(userId);
  if (!state) {
    return NextResponse.json(
      { error: "Нужен SITE_AUTH_SECRET или HUAWEI_OAUTH_STATE_SECRET для OAuth state" },
      { status: 503 }
    );
  }

  const authorizeUrl = buildAuthorizeUrl(config, state);
  return NextResponse.redirect(authorizeUrl);
}
