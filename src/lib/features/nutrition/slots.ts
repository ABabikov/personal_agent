export const MEAL_SLOTS = [
  { id: "breakfast", label: "Завтрак" },
  { id: "lunch", label: "Обед" },
  { id: "dinner", label: "Ужин" },
  { id: "snack", label: "Перекус" },
] as const;

export type MealSlotId = (typeof MEAL_SLOTS)[number]["id"];

const SLOT_IDS = new Set<string>(MEAL_SLOTS.map((s) => s.id));

export function isMealSlot(value: string): value is MealSlotId {
  return SLOT_IDS.has(value);
}

export function slotLabel(id: MealSlotId): string {
  return MEAL_SLOTS.find((s) => s.id === id)?.label ?? id;
}

/** Слот по локальному часу, если пользователь его не назвал. */
export function slotFromHour(hour: number): MealSlotId {
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

export function todayIso(timeZone = "Europe/Moscow"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}
