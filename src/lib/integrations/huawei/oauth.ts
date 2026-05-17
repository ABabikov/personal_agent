import { createHmac, timingSafeEqual } from "node:crypto";
import type { HuaweiConfig } from "@/lib/integrations/huawei/config";
import { getOAuthStateSecret } from "@/lib/integrations/huawei/config";
import type { HuaweiTokenResponse } from "@/lib/integrations/huawei/types";

const STATE_TTL_MS = 15 * 60 * 1000;

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

/** Signed OAuth state: userId + timestamp (CSRF + session binding). */
export function buildOAuthState(userId: string): string | null {
  const secret = getOAuthStateSecret();
  if (!secret) return null;
  const ts = Date.now();
  const payload = `${userId}:${ts}`;
  const sig = signPayload(payload, secret);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function parseOAuthState(state: string): { userId: string } | null {
  const secret = getOAuthStateSecret();
  if (!secret) return null;
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    const sig = parts.pop()!;
    const ts = Number(parts.pop());
    const userId = parts.join(":");
    if (!userId || !Number.isFinite(ts)) return null;
    if (Date.now() - ts > STATE_TTL_MS) return null;
    const payload = `${userId}:${ts}`;
    const expected = signPayload(payload, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { userId };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(config: HuaweiConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    access_type: "offline",
    state,
  });
  return `${config.oauthAuthorizeUrl}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: HuaweiConfig,
  code: string
): Promise<HuaweiTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "error_description" in json
        ? String((json as { error_description: unknown }).error_description)
        : res.statusText;
    throw new Error(`Huawei token exchange failed: ${msg}`);
  }
  return json as HuaweiTokenResponse;
}

export async function refreshAccessToken(
  config: HuaweiConfig,
  refreshToken: string
): Promise<HuaweiTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const res = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "error_description" in json
        ? String((json as { error_description: unknown }).error_description)
        : res.statusText;
    throw new Error(`Huawei token refresh failed: ${msg}`);
  }
  return json as HuaweiTokenResponse;
}

export function tokenExpiresAt(expiresInSec: number | undefined): string | null {
  if (!expiresInSec || expiresInSec <= 0) return null;
  return new Date(Date.now() + expiresInSec * 1000).toISOString();
}
