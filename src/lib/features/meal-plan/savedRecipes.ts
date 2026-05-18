import type { MacroSet, Recipe } from "./types";
import { normalizeUrlKey } from "./recipeDiscoveryStorage";

export type SavedRecipe = Recipe & {
  sourceUrl: string;
  savedAt: string;
};

export const STORAGE_SAVED_RECIPES = "meal-plan:saved-recipes";

export function savedRecipeIdFromUrl(url: string): string {
  const key = normalizeUrlKey(url);
  const safe = key.replace(/[^a-z0-9_-]/g, "_").slice(0, 120);
  return `web-${safe || "unknown"}`;
}

export function loadSavedRecipes(): SavedRecipe[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_SAVED_RECIPES);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: SavedRecipe[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const sourceUrl = typeof o.sourceUrl === "string" ? o.sourceUrl.trim() : "";
      if (!id || !name || !sourceUrl) continue;
      const macros = parseMacros(o.macrosPerServing);
      out.push({
        id,
        name: name.slice(0, 200),
        teaser: typeof o.teaser === "string" ? o.teaser.slice(0, 500) : "",
        minutes: typeof o.minutes === "number" && Number.isFinite(o.minutes) ? Math.min(600, Math.max(0, o.minutes)) : 0,
        macrosPerServing: macros,
        ingredients: Array.isArray(o.ingredients) ? parseIngredients(o.ingredients) : [],
        imageUrl: typeof o.imageUrl === "string" ? o.imageUrl : undefined,
        sourceUrl,
        savedAt: typeof o.savedAt === "string" ? o.savedAt : new Date().toISOString(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveSavedRecipes(list: SavedRecipe[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_SAVED_RECIPES, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

export function upsertSavedRecipeFromSearchHit(input: {
  title: string;
  url: string;
  snippet?: string;
  macrosPerServing: MacroSet;
}): SavedRecipe {
  const id = savedRecipeIdFromUrl(input.url);
  const existing = loadSavedRecipes().find((r) => r.id === id);
  const next: SavedRecipe = {
    id,
    name: input.title.trim().slice(0, 200) || existing?.name || "Рецепт из сети",
    teaser:
      input.snippet?.trim().slice(0, 500) ||
      existing?.teaser ||
      "Сохранено из поиска. КБЖУ — ориентир на один приём; уточните по странице рецепта.",
    minutes: existing?.minutes ?? 0,
    macrosPerServing: input.macrosPerServing,
    ingredients: existing?.ingredients ?? [],
    sourceUrl: input.url,
    savedAt: existing?.savedAt ?? new Date().toISOString(),
  };
  const list = loadSavedRecipes().filter((r) => r.id !== id);
  list.unshift(next);
  saveSavedRecipes(list);
  return next;
}

function parseMacros(raw: unknown): MacroSet {
  if (!raw || typeof raw !== "object") {
    return { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    kcal: num(o.kcal),
    proteinG: num(o.proteinG),
    fatG: num(o.fatG),
    carbsG: num(o.carbsG),
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function parseIngredients(raw: unknown[]): Recipe["ingredients"] {
  const out: Recipe["ingredients"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const amount = num(o.amount);
    const unit = typeof o.unit === "string" ? o.unit.trim().slice(0, 24) : "";
    if (!name) continue;
    out.push({ name: name.slice(0, 120), amount, unit: unit || "—" });
  }
  return out.slice(0, 80);
}
