import type { MappedActivityType } from "@/lib/integrations/huawei/types";

const SWIM_TYPES = new Set([
  "swimming",
  "swimmingpool",
  "swimmingopenwater",
  "waterpolo",
  "diving",
  "scubadiving",
  "freediving",
]);

const GYM_TYPES = new Set([
  "strengthtraining",
  "weightlifting",
  "crossfit",
  "functionaltraining",
  "physicaltraining",
  "hiit",
  "circuittraining",
  "coretraining",
  "kettlebelltraining",
  "calisthenics",
  "bodycombat",
  "crossfit",
  "p90x",
  "elliptical",
  "rowingmachine",
  "stairclimbingmachine",
  "treadmill",
  "runningmachine",
  "cyclingindoor",
  "spinning",
]);

function normalize(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Maps Huawei activity type → internal tag for workout matching. */
export function mapHuaweiActivityType(
  activityTypeRaw: string | number | null | undefined
): MappedActivityType {
  const key = normalize(activityTypeRaw);
  if (!key) return "other";
  if (SWIM_TYPES.has(key) || key.includes("swim")) return "swim";
  if (GYM_TYPES.has(key) || key.includes("strength") || key.includes("weight")) {
    return "gym";
  }
  return "other";
}

/** Числовые sportType из Motion path detail export (см. activityLabels.ts). */
const MOTION_PATH_SWIM = new Set([6, 102, 104]);
const MOTION_PATH_GYM = new Set([80]);

/**
 * Maps Huawei motion-path `sportType` → gym/swim/other.
 * `opts` — запасной эвристический контекст для неоднозначных кодов (117/218).
 */
export function mapHuaweiMotionPathType(
  sportType: number | null | undefined,
  opts?: { totalDistanceM?: number; durationMinutes?: number | null }
): MappedActivityType {
  if (sportType == null || !Number.isFinite(sportType)) return "other";
  if (MOTION_PATH_SWIM.has(sportType)) return "swim";
  if (MOTION_PATH_GYM.has(sportType)) return "gym";

  // 117 «Другое» / 218 Outdoor: короткая сессия без дистанции ≈ зал.
  if (sportType === 117 || sportType === 218) {
    const dist = opts?.totalDistanceM ?? 0;
    const mins = opts?.durationMinutes ?? null;
    if (dist < 50 && mins != null && mins >= 20 && mins <= 180) return "gym";
  }

  return "other";
}
