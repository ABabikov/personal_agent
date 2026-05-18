import { SEED_RECIPES } from "./seedRecipes";
import { loadSavedRecipes, type SavedRecipe } from "./savedRecipes";
import type { Recipe } from "./types";

export { SEED_RECIPES };

let cachedSaved: SavedRecipe[] | null = null;

/** В браузере подмешивает сохранённые из поиска; на сервере — только сиды. */
export function getAllRecipes(): Recipe[] {
  const saved =
    typeof window !== "undefined"
      ? (cachedSaved ?? loadSavedRecipes())
      : [];
  if (typeof window !== "undefined") cachedSaved = saved;
  const ids = new Set<string>();
  const out: Recipe[] = [];
  for (const r of SEED_RECIPES) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    out.push(r);
  }
  for (const r of saved) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    out.push(r);
  }
  return out;
}

export function invalidateSavedRecipesCache(): void {
  cachedSaved = null;
}

export function recipeById(id: string): Recipe | undefined {
  const seed = SEED_RECIPES.find((r) => r.id === id);
  if (seed) return seed;
  const saved = typeof window !== "undefined" ? loadSavedRecipes() : [];
  return saved.find((r) => r.id === id);
}

export function isSavedWebRecipe(id: string): boolean {
  return id.startsWith("web-");
}
