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
