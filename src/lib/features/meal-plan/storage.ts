import type { MealPlanTargets, PlanLine, MealSlot } from "./types";
import { DEFAULT_TARGETS, STORAGE_PLAN, STORAGE_STAPLES, STORAGE_TARGETS } from "./types";
import { buildMealPlanPayload, type MealPlanAgentPayload } from "./mealPlanMerge";
import { loadRecipeDiscoveryState, saveRecipePreferences, saveRecipeSources, toAgentRecipeDiscovery } from "./recipeDiscoveryStorage";
import { loadWeekPlan, saveWeekPlan, type WeekPlan } from "./weekPlan";

const DEFAULT_STAPLES = `яйца
молоко
лук
чеснок
оливковое масло
соль
рис
гречка
`;

export function loadStaples(): string {
  if (typeof window === "undefined") return DEFAULT_STAPLES;
  try {
    const v = localStorage.getItem(STORAGE_STAPLES);
    return v != null && v.length > 0 ? v : DEFAULT_STAPLES;
  } catch {
    return DEFAULT_STAPLES;
  }
}

export function saveStaples(text: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_STAPLES, text);
  } catch {
    /* ignore */
  }
}

export function loadTargets(): MealPlanTargets {
  if (typeof window === "undefined") return DEFAULT_TARGETS;
  try {
    const raw = localStorage.getItem(STORAGE_TARGETS);
    if (!raw) return DEFAULT_TARGETS;
    const j = JSON.parse(raw) as Partial<MealPlanTargets> & { mealsPerDay?: unknown };
    let deficitMin = clampNum(j.deficitKcalMin, DEFAULT_TARGETS.deficitKcalMin, 0, 2000);
    let deficitMax = clampNum(j.deficitKcalMax, DEFAULT_TARGETS.deficitKcalMax, 0, 2000);
    if (deficitMin > deficitMax) {
      const t = deficitMin;
      deficitMin = deficitMax;
      deficitMax = t;
    }
    const mealSlots = parseMealSlots(j.mealSlots, j.mealsPerDay);
    return {
      kcal: clampNum(j.kcal, DEFAULT_TARGETS.kcal, 800, 6000),
      proteinG: clampNum(j.proteinG, DEFAULT_TARGETS.proteinG, 40, 400),
      fatG: clampNum(j.fatG, DEFAULT_TARGETS.fatG, 20, 200),
      carbsG: clampNum(j.carbsG, DEFAULT_TARGETS.carbsG, 50, 800),
      mealSlots,
      deficitKcalMin: deficitMin,
      deficitKcalMax: deficitMax,
    };
  } catch {
    return DEFAULT_TARGETS;
  }
}

export function saveTargets(t: MealPlanTargets): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_TARGETS, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

export function loadPlan(): PlanLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_PLAN);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is PlanLine => {
        return (
          x &&
          typeof x === "object" &&
          typeof (x as PlanLine).recipeId === "string" &&
          typeof (x as PlanLine).portions === "number"
        );
      })
      .map((x) => ({
        recipeId: x.recipeId,
        portions: Math.max(0.25, Math.min(32, x.portions)),
      }));
  } catch {
    return [];
  }
}

export function savePlan(plan: PlanLine[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PLAN, JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

export function loadWeekMealPlan(): WeekPlan {
  return loadWeekPlan();
}

export function saveWeekMealPlan(plan: WeekPlan): void {
  saveWeekPlan(plan);
}

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Собрать снимок для агента (только в браузере). */
export function readMealPlanSnapshotForAgent(): MealPlanAgentPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const discovery = toAgentRecipeDiscovery(loadRecipeDiscoveryState());
    return buildMealPlanPayload(loadTargets(), loadStaples(), loadPlan(), discovery);
  } catch {
    return null;
  }
}

export const MEAL_PLAN_UPDATED_EVENT = "personal-agent-meal-plan-updated";

/** Применить ответ тула set_meal_plan_state. */
export function writeMealPlanSnapshotFromAgent(merged: MealPlanAgentPayload): void {
  if (typeof window === "undefined") return;
  try {
    saveTargets(merged.targets);
    saveStaples(merged.staples);
    savePlan(merged.plan);
    if (merged.recipeDiscovery) {
      saveRecipeSources(merged.recipeDiscovery.sources);
      saveRecipePreferences(merged.recipeDiscovery.preferences);
    }
    window.dispatchEvent(new CustomEvent(MEAL_PLAN_UPDATED_EVENT, { detail: { source: "chat" } }));
  } catch {
    /* ignore */
  }
}

export function createMealSlotId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `slot-${crypto.randomUUID()}`;
  }
  return `slot-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** Разбор слотов из JSON; при отсутствии — из legacy `mealsPerDay` (число приёмов). */
function parseMealSlots(rawSlots: unknown, legacyMealsPerDay: unknown): MealSlot[] {
  if (Array.isArray(rawSlots)) {
    const slots: MealSlot[] = [];
    for (const item of rawSlots) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim().slice(0, 80) : "";
      if (!label) continue;
      const id =
        typeof o.id === "string" && o.id.trim().length > 0 ? String(o.id).trim().slice(0, 64) : createMealSlotId();
      slots.push({ id, label });
    }
    if (slots.length >= 1 && slots.length <= 8) return slots;
    if (slots.length > 8) return slots.slice(0, 8);
  }
  const n = Math.round(clampNum(legacyMealsPerDay, 3, 1, 8));
  return Array.from({ length: n }, (_, i) => ({
    id: `slot-${i + 1}`,
    label: `Приём ${i + 1}`,
  }));
}
