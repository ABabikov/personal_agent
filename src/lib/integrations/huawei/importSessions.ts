import type { HuaweiConfig } from "@/lib/integrations/huawei/config";
import { fetchActivityRecords } from "@/lib/integrations/huawei/client";
import { mapActivityRecordToSession } from "@/lib/integrations/huawei/parseRecord";
import { upsertDeviceSession } from "@/lib/integrations/huawei/storage";
import { autoLinkSessionsForUser } from "@/lib/integrations/huawei/linkSessions";

export type ImportResult = {
  fetched: number;
  upserted: number;
  linked: number;
};

export async function importHuaweiSessions(
  config: HuaweiConfig,
  userId: string,
  from: Date,
  to: Date
): Promise<ImportResult> {
  const records = await fetchActivityRecords(
    config,
    userId,
    from.getTime(),
    to.getTime()
  );

  let upserted = 0;
  const sessionIds: string[] = [];

  for (const record of records) {
    const mapped = mapActivityRecordToSession(record);
    if (!mapped) continue;
    const row = await upsertDeviceSession(userId, mapped);
    sessionIds.push(row.id);
    upserted++;
  }

  const linked = await autoLinkSessionsForUser(userId, sessionIds);

  return { fetched: records.length, upserted, linked };
}

/** Default sync window: last N days. */
export function defaultSyncRange(days = 30): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}
