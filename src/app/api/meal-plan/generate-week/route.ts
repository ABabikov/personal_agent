import { NextResponse } from "next/server";
import { generateWeekPlan } from "@/lib/features/meal-plan/generateWeekPlan";
import { generateWeekPlanWithLlm } from "@/lib/features/meal-plan/generateWeekPlanLlm";
import { DEFAULT_TARGETS, type MealPlanTargets, type MealSlot, type Recipe } from "@/lib/features/meal-plan/types";
import type { WeekPlan, WeekPlanEntry } from "@/lib/features/meal-plan/weekPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RECIPES = 80;

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
      typeof o.id === "string" && o.id.trim()
        ? o.id.trim().slice(0, 64)
        : `slot-${slots.length + 1}`;
    slots.push({ id, label });
  }
  if (slots.length < 1 || slots.length > 8) return null;
  return slots;
}

function parseTargets(raw: unknown): MealPlanTargets | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const slots = parseSlots(o.mealSlots) ?? DEFAULT_TARGETS.mealSlots;
  const kcal = Number(o.kcal);
  const proteinG = Number(o.proteinG);
  const fatG = Number(o.fatG);
  const carbsG = Number(o.carbsG);
  if (![kcal, proteinG, fatG, carbsG].every(Number.isFinite)) return null;
  let deficitMin = Number(o.deficitKcalMin);
  let deficitMax = Number(o.deficitKcalMax);
  if (!Number.isFinite(deficitMin)) deficitMin = DEFAULT_TARGETS.deficitKcalMin;
  if (!Number.isFinite(deficitMax)) deficitMax = DEFAULT_TARGETS.deficitKcalMax;
  deficitMin = clamp(deficitMin, 0, 2000);
  deficitMax = clamp(deficitMax, 0, 2000);
  if (deficitMin > deficitMax) {
    const t = deficitMin;
    deficitMin = deficitMax;
    deficitMax = t;
  }
  return {
    kcal: clamp(kcal, 800, 6000),
    proteinG: clamp(proteinG, 40, 400),
    fatG: clamp(fatG, 20, 200),
    carbsG: clamp(carbsG, 50, 800),
    mealSlots: slots,
    deficitKcalMin: deficitMin,
    deficitKcalMax: deficitMax,
  };
}

function parseRecipes(raw: unknown): Recipe[] {
  if (!Array.isArray(raw)) return [];
  const out: Recipe[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!id || !name) continue;
    const macros = o.macrosPerServing;
    if (!macros || typeof macros !== "object") continue;
    const m = macros as Record<string, unknown>;
    const kcal = Number(m.kcal);
    const proteinG = Number(m.proteinG);
    const fatG = Number(m.fatG);
    const carbsG = Number(m.carbsG);
    if (![kcal, proteinG, fatG, carbsG].every(Number.isFinite)) continue;
    const minutes = Number(o.minutes);
    out.push({
      id: id.slice(0, 96),
      name: name.slice(0, 160),
      teaser: typeof o.teaser === "string" ? o.teaser.slice(0, 240) : "",
      minutes: Number.isFinite(minutes) ? clamp(minutes, 5, 240) : 40,
      macrosPerServing: { kcal, proteinG, fatG, carbsG },
      ingredients: Array.isArray(o.ingredients)
        ? o.ingredients
            .filter((x): x is { name: string; amount: number; unit: string } => {
              return (
                !!x &&
                typeof x === "object" &&
                typeof (x as { name?: unknown }).name === "string" &&
                Number.isFinite(Number((x as { amount?: unknown }).amount)) &&
                typeof (x as { unit?: unknown }).unit === "string"
              );
            })
            .slice(0, 40)
            .map((x) => ({
              name: String(x.name).slice(0, 80),
              amount: Number(x.amount),
              unit: String(x.unit).slice(0, 24),
            }))
        : [],
    });
    if (out.length >= MAX_RECIPES) break;
  }
  return out;
}

function parseWeekPlan(raw: unknown): WeekPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const weekStart = typeof o.weekStart === "string" ? o.weekStart.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const entries: WeekPlanEntry[] = [];
  if (Array.isArray(o.entries)) {
    for (const item of o.entries) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const date = typeof e.date === "string" ? e.date.trim() : "";
      const slotId = typeof e.slotId === "string" ? e.slotId.trim() : "";
      const recipeId = typeof e.recipeId === "string" ? e.recipeId.trim() : "";
      const portions = Number(e.portions);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slotId || !recipeId || !Number.isFinite(portions)) continue;
      entries.push({
        date,
        slotId,
        recipeId,
        portions: clamp(portions, 0.25, 32),
      });
    }
  }
  return {
    weekStart,
    locked: Boolean(o.locked),
    entries: entries.slice(0, 200),
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Пустое тело" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;

  const targets = parseTargets(o.targets);
  if (!targets) {
    return NextResponse.json({ ok: false, error: "Нужен корректный targets (КБЖУ + mealSlots)." }, { status: 400 });
  }
  const weekPlan = parseWeekPlan(o.weekPlan);
  if (!weekPlan) {
    return NextResponse.json({ ok: false, error: "Нужен weekPlan с weekStart YYYY-MM-DD." }, { status: 400 });
  }
  if (weekPlan.locked) {
    return NextResponse.json(
      { ok: false, error: "Неделя зафиксирована — сначала разблокируйте." },
      { status: 409 }
    );
  }

  const recipes = parseRecipes(o.recipes);
  if (recipes.length < 1) {
    return NextResponse.json({ ok: false, error: "Передайте recipes: непустой каталог." }, { status: 400 });
  }

  const mode = (o.mode === "replace-all" ? "replace-all" : "fill-empty") as
    | "fill-empty"
    | "replace-all";
  const useLlm = o.useLlm !== false; // по умолчанию с LLM
  const preferencesNotes = typeof o.preferencesNotes === "string" ? o.preferencesNotes.slice(0, 2000) : "";
  const seed = typeof o.seed === "number" && Number.isFinite(o.seed) ? (o.seed >>> 0) : undefined;

  const options = { mode, seed };

  if (!useLlm) {
    const result = generateWeekPlan(weekPlan, targets, recipes, options);
    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        source: "algorithm" as const,
      },
    });
  }

  const result = await generateWeekPlanWithLlm({
    weekPlan,
    targets,
    recipes,
    options,
    preferencesNotes,
  });

  return NextResponse.json({ ok: true, data: result });
}
