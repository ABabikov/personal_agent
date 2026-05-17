import type { HuaweiConfig } from "@/lib/integrations/huawei/config";
import { refreshAccessToken, tokenExpiresAt } from "@/lib/integrations/huawei/oauth";
import {
  getOAuthTokenRow,
  upsertOAuthTokens,
} from "@/lib/integrations/huawei/storage";
import type {
  HuaweiActivityRecordsResponse,
  HuaweiActivityRecord,
} from "@/lib/integrations/huawei/types";

const EXPIRY_BUFFER_MS = 60_000;

async function ensureAccessToken(
  config: HuaweiConfig,
  userId: string
): Promise<string> {
  const row = await getOAuthTokenRow(userId);
  if (!row) throw new Error("Huawei не подключён");

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const stillValid =
    row.access_token &&
    expiresAt > Date.now() + EXPIRY_BUFFER_MS;

  if (stillValid && row.access_token) {
    return row.access_token;
  }

  const refreshed = await refreshAccessToken(config, row.refresh_token);
  const access = refreshed.access_token;
  if (!access) throw new Error("Huawei refresh: пустой access_token");

  await upsertOAuthTokens(userId, {
    access_token: access,
    refresh_token: refreshed.refresh_token ?? row.refresh_token,
    expires_at: tokenExpiresAt(refreshed.expires_in),
    scope: refreshed.scope ?? row.scope,
  });

  return access;
}

async function healthFetch(
  config: HuaweiConfig,
  accessToken: string,
  path: string,
  searchParams?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${config.healthApiBase}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}

/** Lists activity records in [startMs, endMs]. Paginates via continueToken when present. */
export async function fetchActivityRecords(
  config: HuaweiConfig,
  userId: string,
  startMs: number,
  endMs: number,
  retried = false
): Promise<HuaweiActivityRecord[]> {
  const accessToken = await ensureAccessToken(config, userId);
  const all: HuaweiActivityRecord[] = [];
  let continueToken: string | undefined;

  do {
    const params: Record<string, string> = {
      startTime: String(startMs),
      endTime: String(endMs),
    };
    if (continueToken) params.continueToken = continueToken;

    const res = await healthFetch(
      config,
      accessToken,
      "/healthkit/v2/activityRecords",
      params
    );

    if (res.status === 401 && !retried) {
      const row = await getOAuthTokenRow(userId);
      if (row) {
        const refreshed = await refreshAccessToken(config, row.refresh_token);
        await upsertOAuthTokens(userId, {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? row.refresh_token,
          expires_at: tokenExpiresAt(refreshed.expires_in),
          scope: refreshed.scope ?? row.scope,
        });
        return fetchActivityRecords(config, userId, startMs, endMs, true);
      }
    }

    const json = (await res.json().catch(() => ({}))) as HuaweiActivityRecordsResponse & {
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = json.error?.message ?? res.statusText;
      throw new Error(`Huawei activityRecords: ${msg}`);
    }

    const batch = json.activityRecord ?? [];
    all.push(...batch);
    continueToken = json.continueToken;
  } while (continueToken);

  return all;
}
