import type { MacroSet, MealPlanTargets, Recipe } from "./types";

function perMealTarget(t: MealPlanTargets): MacroSet {
  const n = Math.max(1, t.mealSlots?.length ?? 1);
  return {
    kcal: t.kcal / n,
    proteinG: t.proteinG / n,
    fatG: t.fatG / n,
    carbsG: t.carbsG / n,
  };
}

/** Меньше = ближе к целевым КБЖУ на один приём. */
export function macroDistanceScore(recipe: Recipe, targets: MealPlanTargets): number {
  const m = recipe.macrosPerServing;
  const t = perMealTarget(targets);
  const dk = (m.kcal - t.kcal) / Math.max(120, t.kcal);
  const dp = (m.proteinG - t.proteinG) / Math.max(15, t.proteinG);
  const df = (m.fatG - t.fatG) / Math.max(8, t.fatG);
  const dc = (m.carbsG - t.carbsG) / Math.max(20, t.carbsG);
  return dk * dk + dp * dp * 1.2 + df * df + dc * dc;
}

export function sortRecipesByFit(recipes: Recipe[], targets: MealPlanTargets): Recipe[] {
  return [...recipes].sort((a, b) => macroDistanceScore(a, targets) - macroDistanceScore(b, targets));
}
