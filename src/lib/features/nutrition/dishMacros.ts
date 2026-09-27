import type { MacroTotals } from "@/lib/features/nutrition/targets";

export type IngredientMacros = {
  grams: number;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function macrosForGrams(
  grams: number,
  per100: { kcal: number; proteinG: number; fatG: number; carbsG: number }
): MacroTotals {
  const k = grams / 100;
  return {
    kcal: round1(per100.kcal * k),
    proteinG: round1(per100.proteinG * k),
    fatG: round1(per100.fatG * k),
    carbsG: round1(per100.carbsG * k),
  };
}

/** Сумма ингредиентов и КБЖУ на 100 г готового блюда. */
export function dishPer100(ingredients: IngredientMacros[], cookedWeightG: number): {
  total: MacroTotals;
  per100: MacroTotals;
  ingredientGrams: number;
} | { error: string } {
  if (!(cookedWeightG > 0)) return { error: "Вес готового блюда должен быть больше нуля." };
  if (ingredients.length < 1) return { error: "В блюде нужен хотя бы один продукт." };
  let kcal = 0;
  let proteinG = 0;
  let fatG = 0;
  let carbsG = 0;
  let ingredientGrams = 0;
  for (const item of ingredients) {
    if (!(item.grams > 0)) return { error: "Граммы ингредиента должны быть больше нуля." };
    const m = macrosForGrams(item.grams, {
      kcal: item.kcalPer100,
      proteinG: item.proteinPer100,
      fatG: item.fatPer100,
      carbsG: item.carbsPer100,
    });
    kcal += m.kcal;
    proteinG += m.proteinG;
    fatG += m.fatG;
    carbsG += m.carbsG;
    ingredientGrams += item.grams;
  }
  const total = {
    kcal: round1(kcal),
    proteinG: round1(proteinG),
    fatG: round1(fatG),
    carbsG: round1(carbsG),
  };
  const per100 = macrosForGrams(100, {
    kcal: (total.kcal / cookedWeightG) * 100,
    proteinG: (total.proteinG / cookedWeightG) * 100,
    fatG: (total.fatG / cookedWeightG) * 100,
    carbsG: (total.carbsG / cookedWeightG) * 100,
  });
  return { total, per100, ingredientGrams: round1(ingredientGrams) };
}
