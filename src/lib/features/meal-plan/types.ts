/** Прототип планировщика питания: рецепты, КБЖУ, список покупок. */

export type MacroSet = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type RecipeIngredient = {
  /** Название продукта для списка покупок */
  name: string;
  amount: number;
  unit: string;
};

export type Recipe = {
  id: string;
  name: string;
  /** Коротко: что интересного во вкусе / технике */
  teaser: string;
  minutes: number;
  /** На одну порцию */
  macrosPerServing: MacroSet;
  ingredients: RecipeIngredient[];
};

export type MealSlot = {
  id: string;
  label: string;
};

export type MealPlanTargets = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** Упорядоченные слоты дня (обед, перекусы, ужин и т.д.) — на них делится суточное КБЖУ для подбора. */
  mealSlots: MealSlot[];
  /** Нижняя граница желаемого суточного дефицита ккал (к расходу: TDEE + тренировки + часы). */
  deficitKcalMin: number;
  /** Верхняя граница того же дефицита. */
  deficitKcalMax: number;
};

export type PlanLine = {
  recipeId: string;
  portions: number;
};

/** Пример: завтра обед, перекус, ужин, перекус — настраивается в UI. */
export const DEFAULT_MEAL_SLOTS: MealSlot[] = [
  { id: "lunch", label: "Обед" },
  { id: "snack-after-lunch", label: "Перекус после обеда" },
  { id: "dinner", label: "Ужин" },
  { id: "snack-after-dinner", label: "Перекус после ужина" },
];

export const DEFAULT_TARGETS: MealPlanTargets = {
  kcal: 2200,
  proteinG: 140,
  fatG: 75,
  carbsG: 220,
  mealSlots: DEFAULT_MEAL_SLOTS,
  deficitKcalMin: 200,
  deficitKcalMax: 400,
};

export const STORAGE_STAPLES = "meal-plan:staples";
export const STORAGE_TARGETS = "meal-plan:targets";
export const STORAGE_PLAN = "meal-plan:selection";
