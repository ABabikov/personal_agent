export type HuaweiConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  oauthAuthorizeUrl: string;
  oauthTokenUrl: string;
  healthApiBase: string;
  scopes: string[];
};

const DEFAULT_AUTHORIZE = "https://oauth-login.cloud.huawei.com/oauth2/v3/authorize";
const DEFAULT_TOKEN = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const DEFAULT_HEALTH_API = "https://health-api.cloud.huawei.com";

/** Scopes approved in Huawei Developer Console — extend via HUAWEI_HEALTH_SCOPES (space-separated). */
const DEFAULT_SCOPES = [
  "https://www.huawei.com/healthkit/activityrecord.read",
  // Year of history before first authorization (requires matching approval in Huawei console).
  "https://www.huawei.com/healthkit/historydata.open.year",
];

export function getHuaweiConfig(): HuaweiConfig | null {
  const clientId = process.env.HUAWEI_HEALTH_CLIENT_ID?.trim();
  const clientSecret = process.env.HUAWEI_HEALTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.HUAWEI_HEALTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;

  const extraScopes = process.env.HUAWEI_HEALTH_SCOPES?.trim();
  const scopes = extraScopes
    ? extraScopes.split(/\s+/).filter(Boolean)
    : DEFAULT_SCOPES;

  return {
    clientId,
    clientSecret,
    redirectUri,
    oauthAuthorizeUrl:
      process.env.HUAWEI_HEALTH_OAUTH_AUTHORIZE_URL?.trim() || DEFAULT_AUTHORIZE,
    oauthTokenUrl: process.env.HUAWEI_HEALTH_OAUTH_TOKEN_URL?.trim() || DEFAULT_TOKEN,
    healthApiBase: process.env.HUAWEI_HEALTH_API_BASE?.trim() || DEFAULT_HEALTH_API,
    scopes,
  };
}

export function getOAuthStateSecret(): string | null {
  return (
    process.env.HUAWEI_OAUTH_STATE_SECRET?.trim() ||
    process.env.SITE_AUTH_SECRET?.trim() ||
    null
  );
}
