import type { MealSlot } from "./types";

export type WeekPlanEntry = {
  /** Локальная дата YYYY-MM-DD */
  date: string;
  slotId: string;
  recipeId: string;
  portions: number;
};

export type WeekPlan = {
  /** Понедельник недели (локальная дата YYYY-MM-DD) */
  weekStart: string;
  /** Зафиксировано — редактирование слотов отключено до «Разблокировать» */
  locked: boolean;
  entries: WeekPlanEntry[];
};

export const STORAGE_WEEK_PLAN = "meal-plan:week";

const EMPTY: WeekPlan = {
  weekStart: mondayIsoLocal(new Date()),
  locked: false,
  entries: [],
};

export function mondayIsoLocal(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return formatIsoDate(x);
}

export function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + days);
  return formatIsoDate(dt);
}

export function datesForWeek(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
}

export function weekdayLabelRu(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return dt.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
}

export function loadWeekPlan(): WeekPlan {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = localStorage.getItem(STORAGE_WEEK_PLAN);
    if (!raw) return { ...EMPTY, weekStart: mondayIsoLocal(new Date()) };
    const j = JSON.parse(raw) as Partial<WeekPlan>;
    const weekStart =
      typeof j.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.weekStart)
        ? j.weekStart
        : mondayIsoLocal(new Date());
    const entries = parseEntries(j.entries);
    return {
      weekStart,
      locked: Boolean(j.locked),
      entries,
    };
  } catch {
    return { ...EMPTY, weekStart: mondayIsoLocal(new Date()) };
  }
}

export function saveWeekPlan(plan: WeekPlan): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_WEEK_PLAN,
      JSON.stringify({
        weekStart: plan.weekStart,
        locked: plan.locked,
        entries: plan.entries.slice(0, 200),
      })
    );
  } catch {
    /* ignore */
  }
}

function parseEntries(raw: unknown): WeekPlanEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WeekPlanEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date.trim() : "";
    const slotId = typeof o.slotId === "string" ? o.slotId.trim() : "";
    const recipeId = typeof o.recipeId === "string" ? o.recipeId.trim() : "";
    const portions = typeof o.portions === "number" ? o.portions : Number(o.portions);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slotId || !recipeId || !Number.isFinite(portions)) continue;
    out.push({
      date,
      slotId,
      recipeId,
      portions: Math.min(32, Math.max(0.25, portions)),
    });
  }
  return out;
}

export function entryKey(date: string, slotId: string): string {
  return `${date}__${slotId}`;
}

export function getWeekEntry(
  plan: WeekPlan,
  date: string,
  slotId: string
): WeekPlanEntry | undefined {
  const k = entryKey(date, slotId);
  return plan.entries.find((e) => entryKey(e.date, e.slotId) === k);
}

export function setWeekEntry(
  plan: WeekPlan,
  date: string,
  slotId: string,
  recipeId: string,
  portions: number
): WeekPlan {
  const k = entryKey(date, slotId);
  const rest = plan.entries.filter((e) => entryKey(e.date, e.slotId) !== k);
  return {
    ...plan,
    entries: [...rest, { date, slotId, recipeId, portions: Math.min(32, Math.max(0.25, portions)) }],
  };
}

export function clearWeekEntry(plan: WeekPlan, date: string, slotId: string): WeekPlan {
  const k = entryKey(date, slotId);
  return { ...plan, entries: plan.entries.filter((e) => entryKey(e.date, e.slotId) !== k) };
}

/** Первый пустой слот начиная с date (включительно) в пределах недели. */
export function firstEmptySlotInWeek(
  plan: WeekPlan,
  fromDate: string,
  slots: MealSlot[]
): { date: string; slotId: string } | null {
  const dates = datesForWeek(plan.weekStart);
  const startIdx = Math.max(0, dates.indexOf(fromDate));
  for (let di = startIdx; di < dates.length; di++) {
    const date = dates[di]!;
    for (const slot of slots) {
      if (!getWeekEntry(plan, date, slot.id)) return { date, slotId: slot.id };
    }
  }
  return null;
}

export function weekPlanToPlanLines(plan: WeekPlan): { recipeId: string; portions: number }[] {
  const map = new Map<string, number>();
  for (const e of plan.entries) {
    if (!datesForWeek(plan.weekStart).includes(e.date)) continue;
    map.set(e.recipeId, (map.get(e.recipeId) ?? 0) + e.portions);
  }
  return [...map.entries()].map(([recipeId, portions]) => ({ recipeId, portions }));
}
