import type { MacroTotals } from "@/lib/features/nutrition/targets";

export type MealSuggestion = {
  kind: "product" | "dish";
  id: string;
  name: string;
  grams: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

/**
 * 1–2 варианта из своих продуктов и блюд под остаток.
 * Не превышает ккал больше чем на 15%, добирает белок.
 */
export function suggestRemainingMeals(
  remaining: MacroTotals,
  candidates: MealSuggestion[],
  limit = 2
): MealSuggestion[] {
  if (remaining.kcal <= 30 || candidates.length === 0) return [];
  const scored = candidates
    .filter((c) => c.kcal > 0 && c.grams > 0)
    .map((c) => {
      const over = Math.max(0, c.kcal - remaining.kcal);
      const overRatio = over / Math.max(80, remaining.kcal);
      if (overRatio > 0.15) return { c, score: -1 };
      const proteinFill =
        remaining.proteinG > 0 ? Math.min(c.proteinG, remaining.proteinG) / remaining.proteinG : 0;
      const kcalFill = Math.min(c.kcal, remaining.kcal) / remaining.kcal;
      const score = proteinFill * 1.6 + kcalFill * 0.6 - overRatio;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: MealSuggestion[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const key = `${row.c.kind}:${row.c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(row.c);
    if (picked.length >= limit) break;
  }
  return picked;
}
