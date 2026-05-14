/**
 * Чистые функции слияния/нормализации состояния питания (сервер + клиент).
 */

import type { MealPlanTargets, PlanLine, MealSlot } from "./types";
import { DEFAULT_TARGETS } from "./types";
import { recipeById } from "./seedRecipes";
import type { RecipeDiscoveryForAgent } from "./recipeDiscoveryTypes";
import {
  mergeAgentDiscoveryPatch,
  parseRecipeDiscoveryForAgentPayload,
} from "./recipeDiscoveryStorage";

export type MealPlanAgentPayload = {
  targets: MealPlanTargets;
  staples: string;
  plan: PlanLine[];
  /** Источники рецептов в сети, предпочтения и хвост истории (анти-повторы). */
  recipeDiscovery: RecipeDiscoveryForAgent;
  summary: {
    planTotalsKcal: number;
    planTotalsProteinG: number;
    planTotalsFatG: number;
    planTotalsCarbsG: number;
    slotCount: number;
    deficitKcalMin: number;
    deficitKcalMax: number;
  };
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseSlots(raw: unknown): MealSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const slots: MealSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 80) : "";
    if (!label) continue;
    const id =
      typeof o.id === "string" && o.id.trim().length > 0
        ? String(o.id).trim().slice(0, 64)
        : `slot-${slots.length + 1}`;
    slots.push({ id, label });
  }
  if (slots.length < 1 || slots.length > 8) return null;
  return slots;
}

function parseSlotsOrKeep(raw: unknown, fallback: MealSlot[]): MealSlot[] {
  const s = parseSlots(raw);
  return s ?? fallback;
}

function parsePlan(raw: unknown): PlanLine[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PlanLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const recipeId = typeof o.recipeId === "string" ? o.recipeId.trim() : "";
    const portions = typeof o.portions === "number" ? o.portions : Number(o.portions);
    if (!recipeId || !Number.isFinite(portions)) continue;
    if (!recipeById(recipeId)) continue;
    out.push({ recipeId, portions: clamp(portions, 0.25, 32) });
  }
  return out;
}

/** Частичное обновление целей: незаданные поля берутся из base. */
export function mergeTargetsPartial(base: MealPlanTargets, raw: unknown): MealPlanTargets | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const slots = parseSlotsOrKeep(o.mealSlots, base.mealSlots);
  let deficitMin =
    typeof o.deficitKcalMin === "number"
      ? o.deficitKcalMin
      : typeof o.deficitKcalMin === "string"
        ? Number(o.deficitKcalMin)
        : base.deficitKcalMin;
  let deficitMax =
    typeof o.deficitKcalMax === "number"
      ? o.deficitKcalMax
      : typeof o.deficitKcalMax === "string"
        ? Number(o.deficitKcalMax)
        : base.deficitKcalMax;
  if (!Number.isFinite(deficitMin)) deficitMin = base.deficitKcalMin;
  if (!Number.isFinite(deficitMax)) deficitMax = base.deficitKcalMax;
  deficitMin = clamp(deficitMin, 0, 2000);
  deficitMax = clamp(deficitMax, 0, 2000);
  if (deficitMin > deficitMax) {
    const t = deficitMin;
    deficitMin = deficitMax;
    deficitMax = t;
  }
  const nk = o.kcal != null ? Number(o.kcal) : base.kcal;
  const np = o.proteinG != null ? Number(o.proteinG) : base.proteinG;
  const nf = o.fatG != null ? Number(o.fatG) : base.fatG;
  const nc = o.carbsG != null ? Number(o.carbsG) : base.carbsG;
  return {
    kcal: Number.isFinite(nk) ? clamp(nk, 800, 6000) : base.kcal,
    proteinG: Number.isFinite(np) ? clamp(np, 40, 400) : base.proteinG,
    fatG: Number.isFinite(nf) ? clamp(nf, 20, 200) : base.fatG,
    carbsG: Number.isFinite(nc) ? clamp(nc, 50, 800) : base.carbsG,
    mealSlots: slots,
    deficitKcalMin: deficitMin,
    deficitKcalMax: deficitMax,
  };
}

export function planTotalsFromLines(plan: PlanLine[]): {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
} {
  let kcal = 0;
  let proteinG = 0;
  let fatG = 0;
  let carbsG = 0;
  for (const line of plan) {
    const r = recipeById(line.recipeId);
    if (!r) continue;
    const p = Math.max(0, line.portions);
    kcal += r.macrosPerServing.kcal * p;
    proteinG += r.macrosPerServing.proteinG * p;
    fatG += r.macrosPerServing.fatG * p;
    carbsG += r.macrosPerServing.carbsG * p;
  }
  return { kcal, proteinG, fatG, carbsG };
}

export function buildMealPlanPayload(
  targets: MealPlanTargets,
  staples: string,
  plan: PlanLine[],
  recipeDiscovery: RecipeDiscoveryForAgent
): MealPlanAgentPayload {
  const t = planTotalsFromLines(plan);
  return {
    targets,
    staples: staples.slice(0, 12000),
    plan,
    recipeDiscovery,
    summary: {
      planTotalsKcal: t.kcal,
      planTotalsProteinG: t.proteinG,
      planTotalsFatG: t.fatG,
      planTotalsCarbsG: t.carbsG,
      slotCount: targets.mealSlots.length,
      deficitKcalMin: targets.deficitKcalMin,
      deficitKcalMax: targets.deficitKcalMax,
    },
  };
}

export function mergeMealPlanPayload(
  base: MealPlanAgentPayload,
  patch: {
    targets?: unknown;
    staples?: unknown;
    plan?: unknown;
    recipeDiscovery?: unknown;
  }
): { ok: true; merged: MealPlanAgentPayload } | { ok: false; error: string } {
  let targets = base.targets;
  if (patch.targets !== undefined) {
    const n = mergeTargetsPartial(base.targets, patch.targets);
    if (!n) return { ok: false, error: "Некорректный объект targets." };
    targets = n;
  }

  let staples = base.staples;
  if (patch.staples !== undefined) {
    if (typeof patch.staples !== "string") return { ok: false, error: "staples должен быть строкой." };
    staples = patch.staples.slice(0, 12000);
  }

  let plan = base.plan;
  if (patch.plan !== undefined) {
    const p = parsePlan(patch.plan);
    if (p === null) return { ok: false, error: "plan должен быть массивом." };
    plan = p;
  }

  let recipeDiscovery = base.recipeDiscovery;
  if (patch.recipeDiscovery !== undefined) {
    if (!patch.recipeDiscovery || typeof patch.recipeDiscovery !== "object") {
      return { ok: false, error: "recipeDiscovery должен быть объектом с опциональными sources и preferences." };
    }
    const rd = patch.recipeDiscovery as Record<string, unknown>;
    recipeDiscovery = mergeAgentDiscoveryPatch(base.recipeDiscovery, {
      sources: rd.sources,
      preferences: rd.preferences,
    });
  }

  return { ok: true, merged: buildMealPlanPayload(targets, staples, plan, recipeDiscovery) };
}

/** Разбор JSON из тела POST /api/chat (поле mealPlan). */
export function safeParseClientMealPlanPayload(raw: unknown): MealPlanAgentPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.staples !== "string") return null;
  if (!Array.isArray(o.plan)) return null;
  const plan = parsePlan(o.plan);
  if (plan === null) return null;
  if (!o.targets || typeof o.targets !== "object") return null;
  const t = mergeTargetsPartial(DEFAULT_TARGETS, o.targets);
  if (!t) return null;
  const recipeDiscovery = parseRecipeDiscoveryForAgentPayload(o.recipeDiscovery);
  return buildMealPlanPayload(t, o.staples, plan, recipeDiscovery);
}
