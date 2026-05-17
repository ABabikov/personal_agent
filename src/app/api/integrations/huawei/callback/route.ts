import { NextResponse } from "next/server";
import { getHuaweiConfig } from "@/lib/integrations/huawei/config";
import {
  exchangeCodeForTokens,
  parseOAuthState,
  tokenExpiresAt,
} from "@/lib/integrations/huawei/oauth";
import { upsertOAuthTokens } from "@/lib/integrations/huawei/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function profileRedirect(req: Request, params: Record<string, string>) {
  const base = new URL("/profile", req.url);
  for (const [k, v] of Object.entries(params)) {
    base.searchParams.set(k, v);
  }
  return NextResponse.redirect(base);
}

export async function GET(req: Request) {
  const config = getHuaweiConfig();
  if (!config) {
    return profileRedirect(req, { huawei: "error", reason: "not_configured" });
  }

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) {
    return profileRedirect(req, { huawei: "error", reason: error });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return profileRedirect(req, { huawei: "error", reason: "missing_code" });
  }

  const parsed = parseOAuthState(state);
  if (!parsed) {
    return profileRedirect(req, { huawei: "error", reason: "invalid_state" });
  }

  try {
    const tokens = await exchangeCodeForTokens(config, code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return profileRedirect(req, { huawei: "error", reason: "no_tokens" });
    }

    await upsertOAuthTokens(parsed.userId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokenExpiresAt(tokens.expires_in),
      scope: tokens.scope ?? null,
    });

    return profileRedirect(req, { huawei: "connected" });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "token_exchange";
    return profileRedirect(req, { huawei: "error", reason });
  }
}
