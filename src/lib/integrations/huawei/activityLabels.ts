/** Подписи sportType из выгрузки / API Huawei (только отображение). */
const NUMERIC_LABELS: Record<number, string> = {
  3: "Велосипед",
  4: "Бег",
  5: "Ходьба",
  6: "Бассейн",
  13: "Лыжи",
  48: "Сноуборд",
  52: "Сноуборд",
  80: "Силовая",
  97: "Горные лыжи",
  102: "Бассейн",
  104: "Открытая вода",
  117: "Другое",
  218: "Outdoor (GPS)",
};

const STRING_LABELS: Record<string, string> = {
  snowboarding: "Сноуборд",
  skiing: "Лыжи",
  alpineskiing: "Горные лыжи",
  snowboardingcrosscountry: "Сноуборд",
};

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Человекочитаемый тип активности Huawei для UI. */
export function huaweiActivityLabel(
  activityTypeRaw: string | number | null | undefined
): string | null {
  if (activityTypeRaw == null || activityTypeRaw === "") return null;
  if (typeof activityTypeRaw === "number" && Number.isFinite(activityTypeRaw)) {
    return NUMERIC_LABELS[activityTypeRaw] ?? `Huawei ${activityTypeRaw}`;
  }
  const key = normalizeKey(String(activityTypeRaw));
  const asNum = Number(key);
  if (Number.isFinite(asNum) && String(asNum) === key) {
    return NUMERIC_LABELS[asNum] ?? `Huawei ${asNum}`;
  }
  return STRING_LABELS[key] ?? String(activityTypeRaw);
}

/** Есть ли в маппинге явный сноуборд (в вашей выгрузке motion path — только 102, 117, 218). */
export function isSnowboardLikeType(
  activityTypeRaw: string | number | null | undefined
): boolean {
  if (activityTypeRaw == null) return false;
  if (typeof activityTypeRaw === "number") {
    return activityTypeRaw === 48 || activityTypeRaw === 52;
  }
  const k = normalizeKey(String(activityTypeRaw));
  return k.includes("snowboard") || k.includes("snowboarding");
}
