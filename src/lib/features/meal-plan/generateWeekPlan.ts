/**
 * Автозаполнение плана на неделю: веса слотов, подгон порций, анти-повторы.
 * Чистая функция — работает и в браузере, и на сервере.
 */

import {
  bestPortionsForTarget,
  inferSlotKind,
  proteinFamily,
  targetForSlot,
  type SlotKind,
} from "./macrosFit";
import type { MealPlanTargets, Recipe } from "./types";
import {
  datesForWeek,
  getWeekEntry,
  type WeekPlan,
  type WeekPlanEntry,
} from "./weekPlan";

export type GenerateWeekPlanOptions = {
  /** Только пустые слоты (по умолчанию) или перезаписать всю неделю. */
  mode?: "fill-empty" | "replace-all";
  /** Зерно для лёгкой рандомизации среди близких кандидатов. */
  seed?: number;
  /** Макс. повторов одного recipeId за неделю (включая уже занятые слоты). */
  maxRepeatsPerRecipe?: number;
};

export type GenerateWeekPlanResult = {
  weekPlan: WeekPlan;
  filled: number;
  skipped: number;
  daySummaries: {
    date: string;
    kcal: number;
    proteinG: number;
    targetKcal: number;
    targetProteinG: number;
  }[];
};

function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function defaultSeed(): number {
  return (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
}

function kindEffortCap(kind: SlotKind): number {
  if (kind === "snack") return 35;
  if (kind === "breakfast") return 45;
  return 120;
}

function pickBestCandidate(
  recipes: Recipe[],
  target: ReturnType<typeof targetForSlot>,
  kind: SlotKind,
  usedCounts: Map<string, number>,
  recentFamilies: string[],
  maxRepeats: number,
  rng: () => number
): { recipe: Recipe; portions: number; score: number } | null {
  const scored: { recipe: Recipe; portions: number; score: number }[] = [];
  const effortCap = kindEffortCap(kind);

  for (const recipe of recipes) {
    const used = usedCounts.get(recipe.id) ?? 0;
    if (used >= maxRepeats) continue;
    // перекусы — полегче по времени
    if (kind === "snack" && recipe.minutes > effortCap + 15) continue;

    const { portions, score: fit } = bestPortionsForTarget(recipe, target);
    let score = fit;

    // штраф за повтор белка подряд
    const fam = proteinFamily(recipe);
    const last = recentFamilies[recentFamilies.length - 1];
    const prev = recentFamilies[recentFamilies.length - 2];
    if (last && fam === last) score += 0.35;
    if (prev && fam === last && fam === prev) score += 0.55;

    // уже использовали в неделе
    score += used * 0.22;

    // лёгкий бонус незапарным основным / перекусам
    if (kind === "snack" || kind === "breakfast") {
      if (recipe.minutes <= effortCap) score -= 0.04;
    }

    // очень жирные перекусы — хуже
    if (kind === "snack" && recipe.macrosPerServing.kcal > target.kcal * 1.8) {
      score += 0.25;
    }

    scored.push({ recipe, portions, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => a.score - b.score);

  // среди топ-3 — слегка рандомизируем, чтобы недели не были клонами
  const topN = Math.min(3, scored.length);
  const pick = Math.min(topN - 1, Math.floor(rng() * topN));
  return scored[pick]!;
}

function macrosForEntries(
  entries: WeekPlanEntry[],
  date: string,
  recipesById: Map<string, Recipe>
): { kcal: number; proteinG: number } {
  let kcal = 0;
  let proteinG = 0;
  for (const e of entries) {
    if (e.date !== date) continue;
    const r = recipesById.get(e.recipeId);
    if (!r) continue;
    kcal += r.macrosPerServing.kcal * e.portions;
    proteinG += r.macrosPerServing.proteinG * e.portions;
  }
  return { kcal, proteinG };
}

/**
 * Собирает недельный план: день за днём, слот за слотом.
 * Уже заполненные слоты (в режиме fill-empty) сохраняются.
 */
export function generateWeekPlan(
  current: WeekPlan,
  targets: MealPlanTargets,
  recipes: Recipe[],
  options: GenerateWeekPlanOptions = {}
): GenerateWeekPlanResult {
  const mode = options.mode ?? "fill-empty";
  const maxRepeats = options.maxRepeatsPerRecipe ?? 2;
  const rng = createRng(options.seed ?? defaultSeed());
  const dates = datesForWeek(current.weekStart);
  const slots = targets.mealSlots;
  const recipesById = new Map(recipes.map((r) => [r.id, r]));

  let entries: WeekPlanEntry[] =
    mode === "replace-all"
      ? []
      : current.entries.filter((e) => dates.includes(e.date));

  const usedCounts = new Map<string, number>();
  for (const e of entries) {
    usedCounts.set(e.recipeId, (usedCounts.get(e.recipeId) ?? 0) + 1);
  }

  const recentFamilies: string[] = [];
  for (const e of entries) {
    const r = recipesById.get(e.recipeId);
    if (r) recentFamilies.push(proteinFamily(r));
  }

  let filled = 0;
  let skipped = 0;

  for (const date of dates) {
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si]!;
      const existing = getWeekEntry({ ...current, entries }, date, slot.id);
      if (existing && mode === "fill-empty") {
        skipped += 1;
        continue;
      }
      if (existing && mode === "replace-all") {
        entries = entries.filter((e) => !(e.date === date && e.slotId === slot.id));
      }

      const kind = inferSlotKind(slot, si, slots.length);
      const target = targetForSlot(targets, si);
      const pick = pickBestCandidate(
        recipes,
        target,
        kind,
        usedCounts,
        recentFamilies,
        maxRepeats,
        rng
      );
      if (!pick) {
        skipped += 1;
        continue;
      }

      entries.push({
        date,
        slotId: slot.id,
        recipeId: pick.recipe.id,
        portions: pick.portions,
      });
      usedCounts.set(pick.recipe.id, (usedCounts.get(pick.recipe.id) ?? 0) + 1);
      recentFamilies.push(proteinFamily(pick.recipe));
      if (recentFamilies.length > 12) recentFamilies.shift();
      filled += 1;
    }
  }

  const weekPlan: WeekPlan = {
    weekStart: current.weekStart,
    locked: current.locked,
    entries,
  };

  const daySummaries = dates.map((date) => {
    const m = macrosForEntries(entries, date, recipesById);
    return {
      date,
      kcal: Math.round(m.kcal),
      proteinG: Math.round(m.proteinG * 10) / 10,
      targetKcal: targets.kcal,
      targetProteinG: targets.proteinG,
    };
  });

  return { weekPlan, filled, skipped, daySummaries };
}

/** Компактное описание каталога для LLM (без длинных списков ингредиентов). */
export function catalogForLlm(recipes: Recipe[]): {
  id: string;
  name: string;
  minutes: number;
  teaser: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  family: string;
}[] {
  return recipes.map((r) => ({
    id: r.id,
    name: r.name,
    minutes: r.minutes,
    teaser: r.teaser.slice(0, 120),
    kcal: r.macrosPerServing.kcal,
    proteinG: r.macrosPerServing.proteinG,
    fatG: r.macrosPerServing.fatG,
    carbsG: r.macrosPerServing.carbsG,
    family: proteinFamily(r),
  }));
}
