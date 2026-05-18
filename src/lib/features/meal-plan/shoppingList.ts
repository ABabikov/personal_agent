import type { PlanLine, RecipeIngredient } from "./types";
import { recipeById } from "./recipes";
import { planTotalsFromLines } from "./mealPlanMerge";

export type AggregatedLine = RecipeIngredient & {
  /** Сколько рецептов дало эту строку (для подсказки) */
  sources: number;
};

export type ShoppingRow = AggregatedLine & {
  /** Совпало с базовым продуктом (уже дома) */
  fromStaples: boolean;
};

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ё/g, "е");
}

function parseStaples(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => norm(s))
    .filter((s) => s.length >= 2);
}

/** Грубое совпадение: ингредиент содержит базу или база — начало ингредиента. */
export function ingredientMatchesStaple(ingredientName: string, staple: string): boolean {
  const i = norm(ingredientName);
  const s = norm(staple);
  if (!s || s.length < 2) return false;
  if (i.includes(s)) return true;
  const first = i.split(/\s+/)[0] ?? "";
  if (first.length >= 3 && s.startsWith(first)) return true;
  if (s.length >= 3 && first.startsWith(s)) return true;
  return false;
}

export function isFromStaples(ingredientName: string, staplesText: string): boolean {
  const staples = parseStaples(staplesText);
  return staples.some((st) => ingredientMatchesStaple(ingredientName, st));
}

function aggKey(ing: RecipeIngredient): string {
  return `${norm(ing.name)}__${ing.unit}`;
}

/** Складывает ингредиенты с одинаковым названием и единицей. */
export function aggregateIngredients(lines: RecipeIngredient[]): AggregatedLine[] {
  const map = new Map<string, AggregatedLine>();
  for (const ing of lines) {
    const k = aggKey(ing);
    const prev = map.get(k);
    if (prev) {
      prev.amount += ing.amount;
      prev.sources += 1;
    } else {
      map.set(k, { ...ing, sources: 1 });
    }
  }
  return [...map.values()].sort((a, b) => norm(a.name).localeCompare(norm(b.name), "ru"));
}

export function buildShoppingList(
  plan: PlanLine[],
  staplesText: string
): { buy: ShoppingRow[]; atHome: ShoppingRow[] } {
  const expanded: RecipeIngredient[] = [];
  for (const line of plan) {
    const r = recipeById(line.recipeId);
    if (!r) continue;
    const p = Math.max(0.25, line.portions);
    for (const ing of r.ingredients) {
      expanded.push({
        name: ing.name,
        amount: ing.amount * p,
        unit: ing.unit,
      });
    }
  }
  const agg = aggregateIngredients(expanded);
  const rows: ShoppingRow[] = agg.map((row) => ({
    ...row,
    fromStaples: isFromStaples(row.name, staplesText),
  }));
  const atHome = rows.filter((x) => x.fromStaples);
  const buy = rows.filter((x) => !x.fromStaples);
  return { buy, atHome };
}

export function planMacrosTotal(plan: PlanLine[]): {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
} {
  return planTotalsFromLines(plan);
}