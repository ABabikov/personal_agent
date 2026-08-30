import type { MacroSet, MealPlanTargets, MealSlot, Recipe } from "./types";

export type SlotKind = "breakfast" | "main" | "snack" | "other";

const PORTION_CANDIDATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Эвристика роли слота по подписи (и запасной по индексу). */
export function inferSlotKind(slot: MealSlot, index: number, total: number): SlotKind {
  const l = slot.label.toLowerCase();
  if (/завтрак|breakfast|утрен/u.test(l)) return "breakfast";
  if (/перекус|snack|снэк|полдник/u.test(l)) return "snack";
  if (/обед|ужин|lunch|dinner|основн/u.test(l)) return "main";
  if (total <= 2) return "main";
  if (total === 3) return index === 1 ? "main" : index === 0 ? "breakfast" : "main";
  // 4+: крайние чаще перекусы, середина — основные
  if (index === 0 || index === total - 1) return "snack";
  return "main";
}

/** Относительные веса слотов → сумма 1. */
export function slotWeightFractions(slots: MealSlot[]): number[] {
  if (slots.length === 0) return [];
  const raw = slots.map((s, i) => {
    const kind = inferSlotKind(s, i, slots.length);
    if (kind === "main") return 0.38;
    if (kind === "breakfast") return 0.22;
    if (kind === "snack") return 0.12;
    return 0.2;
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((w) => w / sum);
}

export function targetForSlot(targets: MealPlanTargets, slotIndex: number): MacroSet {
  const fracs = slotWeightFractions(targets.mealSlots);
  const f = fracs[slotIndex] ?? 1 / Math.max(1, targets.mealSlots.length);
  return {
    kcal: targets.kcal * f,
    proteinG: targets.proteinG * f,
    fatG: targets.fatG * f,
    carbsG: targets.carbsG * f,
  };
}

function perMealEqual(t: MealPlanTargets): MacroSet {
  const n = Math.max(1, t.mealSlots?.length ?? 1);
  return {
    kcal: t.kcal / n,
    proteinG: t.proteinG / n,
    fatG: t.fatG / n,
    carbsG: t.carbsG / n,
  };
}

/** Меньше = ближе к целевым КБЖУ (на порцию × scale). */
export function macroDistanceToTarget(macros: MacroSet, t: MacroSet): number {
  const dk = (macros.kcal - t.kcal) / Math.max(120, t.kcal);
  const dp = (macros.proteinG - t.proteinG) / Math.max(15, t.proteinG);
  const df = (macros.fatG - t.fatG) / Math.max(8, t.fatG);
  const dc = (macros.carbsG - t.carbsG) / Math.max(20, t.carbsG);
  // белок чуть важнее — дефицит белка хуже, чем лишние углеводы
  return dk * dk + dp * dp * 1.6 + df * df + dc * dc * 0.85;
}

export function scaleMacros(m: MacroSet, portions: number): MacroSet {
  return {
    kcal: m.kcal * portions,
    proteinG: m.proteinG * portions,
    fatG: m.fatG * portions,
    carbsG: m.carbsG * portions,
  };
}

/** Лучшая порция из дискретной сетки под цель слота. */
export function bestPortionsForTarget(recipe: Recipe, target: MacroSet): { portions: number; score: number } {
  let best = { portions: 1, score: Infinity };
  for (const p of PORTION_CANDIDATES) {
    const score = macroDistanceToTarget(scaleMacros(recipe.macrosPerServing, p), target);
    if (score < best.score) best = { portions: p, score };
  }
  return best;
}

/**
 * Оценка «насколько рецепт подходит слоту».
 * @param slotIndex — если задан, цель берётся с весами слотов; иначе равная доля дня.
 */
export function macroDistanceScore(
  recipe: Recipe,
  targets: MealPlanTargets,
  slotIndex?: number
): number {
  const t =
    slotIndex != null && slotIndex >= 0
      ? targetForSlot(targets, slotIndex)
      : perMealEqual(targets);
  return bestPortionsForTarget(recipe, t).score;
}

export function sortRecipesByFit(
  recipes: Recipe[],
  targets: MealPlanTargets,
  slotIndex?: number
): Recipe[] {
  return [...recipes].sort(
    (a, b) => macroDistanceScore(a, targets, slotIndex) - macroDistanceScore(b, targets, slotIndex)
  );
}

/** Грубый тег белка для анти-повторов (курица / рыба / …). */
export function proteinFamily(recipe: Recipe): string {
  const blob = `${recipe.name} ${recipe.ingredients.map((i) => i.name).join(" ")}`.toLowerCase();
  if (/тунец|треск|хек|лосос|рыб|кревет|seafood|fish|shrimp/u.test(blob)) return "fish";
  if (/говяд|beef/u.test(blob)) return "beef";
  if (/индейк|turkey/u.test(blob)) return "turkey";
  if (/курин|куриц|chicken/u.test(blob)) return "chicken";
  if (/творог|яйц|омлет|сыр|dairy|cottage/u.test(blob)) return "dairy-egg";
  if (/чечевиц|тофу|нут|боб|lentil|tofu|veg/u.test(blob)) return "plant";
  if (/фарш|мяс/u.test(blob)) return "meat-mixed";
  return "other";
}
