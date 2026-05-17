import { mapHuaweiActivityType } from "@/lib/integrations/huawei/mapActivityType";
import type {
  DeviceSessionUpsert,
  HuaweiActivityRecord,
  HuaweiDataSummaryItem,
} from "@/lib/integrations/huawei/types";

function activityTypeRaw(record: HuaweiActivityRecord): string | null {
  const raw = record.activityTypeId ?? record.activityType;
  return raw != null ? String(raw) : null;
}

function extractFromSummary(
  record: HuaweiActivityRecord
): { calories: number | null; avgHr: number | null } {
  const items = record.activitySummary?.dataSummary ?? [];
  let calories: number | null = null;
  let avgHr: number | null = null;

  for (const item of items) {
    const name = (item.dataTypeName ?? "").toLowerCase();
    const val = firstNumeric(item);
    if (val == null) continue;
    if (name.includes("calorie") || name.includes("calories")) {
      calories = val;
    }
    if (name.includes("heart_rate") || name.includes("heartrate")) {
      avgHr = val;
    }
  }
  return { calories, avgHr };
}

function firstNumeric(item: HuaweiDataSummaryItem): number | null {
  const values = item.value ?? [];
  for (const v of values) {
    if (typeof v.floatValue === "number" && Number.isFinite(v.floatValue)) {
      return v.floatValue;
    }
    if (typeof v.intValue === "number" && Number.isFinite(v.intValue)) {
      return v.intValue;
    }
  }
  return null;
}

export function mapActivityRecordToSession(
  record: HuaweiActivityRecord
): DeviceSessionUpsert | null {
  if (!record.id || !record.startTime) return null;

  const started = new Date(record.startTime);
  if (Number.isNaN(started.getTime())) return null;

  const endedMs = record.endTime ?? record.startTime + (record.activeTimeMillis ?? 0);
  const ended = record.endTime != null ? new Date(endedMs) : null;

  const typeRaw = activityTypeRaw(record);
  const mapped = mapHuaweiActivityType(typeRaw);
  const { calories, avgHr } = extractFromSummary(record);

  const durationSec =
    record.activeTimeMillis != null
      ? Math.round(record.activeTimeMillis / 1000)
      : record.endTime != null
        ? Math.max(0, Math.round((record.endTime - record.startTime) / 1000))
        : null;

  return {
    external_id: record.id,
    started_at: started.toISOString(),
    ended_at: ended && !Number.isNaN(ended.getTime()) ? ended.toISOString() : null,
    activity_type_raw: typeRaw,
    activity_type_mapped: mapped,
    calories_device: calories,
    avg_heart_rate: avgHr,
    duration_seconds: durationSec,
    payload: record as unknown as Record<string, unknown>,
  };
}
