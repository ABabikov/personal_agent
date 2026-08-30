import { mapHuaweiMotionPathType } from "@/lib/integrations/huawei/mapActivityType";
import type { DeviceSessionUpsert } from "@/lib/integrations/huawei/types";

/** One row from Huawei personal data export — Motion path detail data. */
export type HuaweiMotionPathRecord = {
  recordId?: string;
  startTime?: number;
  endTime?: number;
  sportType?: number;
  totalCalories?: number;
  totalDistance?: number;
  totalTime?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  attribute?: string;
  [key: string]: unknown;
};

const HR_TAG = "tp=h-r";

/** Parses tp=h-r heart rate series from motion path `attribute` string. */
export function parseHeartRatesFromAttribute(
  attribute: string | null | undefined
): number[] {
  if (!attribute) return [];
  const rates: number[] = [];
  const chunks = attribute.split(HR_TAG);
  for (let i = 1; i < chunks.length; i++) {
    const part = chunks[i];
    const vMatch = /(?:^|[;\s])v=(\d+(?:\.\d+)?)/.exec(part);
    if (vMatch) {
      const v = Number(vMatch[1]);
      if (Number.isFinite(v) && v > 0 && v < 250) rates.push(v);
    }
  }
  return rates;
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Huawei export stores calories × 1000 (millicalories). */
export function huaweiExportCaloriesToKcal(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw / 1000;
}

export function mapMotionPathToSession(
  record: HuaweiMotionPathRecord
): DeviceSessionUpsert | null {
  const externalId = record.recordId?.trim();
  if (!externalId || record.startTime == null) return null;

  const started = new Date(record.startTime);
  if (Number.isNaN(started.getTime())) return null;

  const endMs =
    record.endTime ??
    (record.totalTime != null ? record.startTime + record.totalTime : null);
  const ended = endMs != null ? new Date(endMs) : null;

  const durationSeconds =
    record.totalTime != null
      ? Math.round(record.totalTime / 1000)
      : endMs != null
        ? Math.max(0, Math.round((endMs - record.startTime) / 1000))
        : null;

  const durationMinutes =
    durationSeconds != null ? durationSeconds / 60 : null;

  const typeRaw =
    record.sportType != null ? String(record.sportType) : null;
  const mapped = mapHuaweiMotionPathType(record.sportType, {
    totalDistanceM: record.totalDistance ?? 0,
    durationMinutes,
  });

  const hrFromAttr = parseHeartRatesFromAttribute(
    typeof record.attribute === "string" ? record.attribute : null
  );
  const avgHr =
    record.avgHeartRate != null && Number.isFinite(record.avgHeartRate)
      ? record.avgHeartRate
      : average(hrFromAttr);

  return {
    external_id: externalId,
    started_at: started.toISOString(),
    ended_at: ended && !Number.isNaN(ended.getTime()) ? ended.toISOString() : null,
    activity_type_raw: typeRaw,
    activity_type_mapped: mapped,
    calories_device: huaweiExportCaloriesToKcal(record.totalCalories),
    avg_heart_rate: avgHr,
    duration_seconds: durationSeconds,
    payload: {
      source: "huawei_export_motion_path",
      sportType: record.sportType,
      totalDistance: record.totalDistance,
      totalSteps: record.totalSteps,
      maxHeartRate: record.maxHeartRate,
    },
  };
}
