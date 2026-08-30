/**
 * LLM-улучшение автозаполнения недели: модель выбирает блюда/порции из каталога,
 * результат валидируется; при сбое — fallback на детерминированный план.
 */

import { chatCompletion } from "@/lib/agent/llm/openrouter";
import {
  catalogForLlm,
  generateWeekPlan,
  type GenerateWeekPlanOptions,
  type GenerateWeekPlanResult,
} from "./generateWeekPlan";
import { bestPortionsForTarget, targetForSlot } from "./macrosFit";
import type { MealPlanTargets, Recipe } from "./types";
import { datesForWeek, type WeekPlan, type WeekPlanEntry } from "./weekPlan";

/** Отдельная модель для рациона (можно переопределить env). */
export function mealPlanLlmModel(): string {
  return (
    process.env.OPENROUTER_MEAL_PLAN_MODEL?.trim() ||
    process.env.OPENROUTER_LLM_MODEL?.trim() ||
    "anthropic/claude-sonnet-4"
  );
}

function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const raw = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validateLlmEntries(
  raw: unknown,
  weekStart: string,
  targets: MealPlanTargets,
  recipesById: Map<string, Recipe>,
  mode: "fill-empty" | "replace-all",
  existing: WeekPlanEntry[]
): WeekPlanEntry[] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const arr = o.entries;
  if (!Array.isArray(arr)) return null;

  const dates = new Set(datesForWeek(weekStart));
  const slotIds = new Set(targets.mealSlots.map((s) => s.id));
  const out: WeekPlanEntry[] = [];
  const seen = new Set<string>();

  if (mode === "fill-empty") {
    for (const e of existing) {
      if (!dates.has(e.date)) continue;
      out.push(e);
      seen.add(`${e.date}__${e.slotId}`);
    }
  }

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const slotId = typeof row.slotId === "string" ? row.slotId.trim() : "";
    const recipeId = typeof row.recipeId === "string" ? row.recipeId.trim() : "";
    let portions = typeof row.portions === "number" ? row.portions : Number(row.portions);
    if (!dates.has(date) || !slotIds.has(slotId) || !recipesById.has(recipeId)) continue;
    if (!Number.isFinite(portions)) portions = 1;
    portions = Math.min(2, Math.max(0.5, Math.round(portions * 4) / 4));

    const key = `${date}__${slotId}`;
    if (mode === "fill-empty" && seen.has(key)) continue;

    // подтянуть порции к цели слота, если модель сильно промахнулась
    const slotIndex = targets.mealSlots.findIndex((s) => s.id === slotId);
    const recipe = recipesById.get(recipeId)!;
    if (slotIndex >= 0) {
      const target = targetForSlot(targets, slotIndex);
      const best = bestPortionsForTarget(recipe, target);
      const modelKcal = recipe.macrosPerServing.kcal * portions;
      if (Math.abs(modelKcal - target.kcal) > Math.abs(recipe.macrosPerServing.kcal * best.portions - target.kcal) + 80) {
        portions = best.portions;
      }
    }

    const filtered = out.filter((e) => `${e.date}__${e.slotId}` !== key);
    filtered.push({ date, slotId, recipeId, portions });
    out.length = 0;
    out.push(...filtered);
    seen.add(key);
  }

  // все слоты должны быть заполнены (или хотя бы большинство)
  const needed = datesForWeek(weekStart).length * targets.mealSlots.length;
  if (out.length < Math.ceil(needed * 0.6)) return null;
  return out;
}

function buildPrompt(input: {
  weekStart: string;
  targets: MealPlanTargets;
  recipes: Recipe[];
  baseline: GenerateWeekPlanResult;
  mode: "fill-empty" | "replace-all";
  preferencesNotes?: string;
}): string {
  const dates = datesForWeek(input.weekStart);
  const slots = input.targets.mealSlots.map((s, i) => ({
    id: s.id,
    label: s.label,
    index: i,
  }));
  const catalog = catalogForLlm(input.recipes);
  const baselineCompact = input.baseline.weekPlan.entries.map((e) => ({
    date: e.date,
    slotId: e.slotId,
    recipeId: e.recipeId,
    portions: e.portions,
  }));

  return [
    "Ты составляешь недельный рацион для персонального приложения.",
    "Верни ТОЛЬКО JSON вида: {\"entries\":[{\"date\":\"YYYY-MM-DD\",\"slotId\":\"...\",\"recipeId\":\"...\",\"portions\":1}]}",
    "Правила:",
    "- recipeId только из каталога ниже;",
    `- даты только из: ${dates.join(", ")};`,
    `- slotId только из: ${slots.map((s) => s.id).join(", ")};`,
    "- portions: 0.5 … 2 с шагом 0.25;",
    "- каждый день: сумма ккал ≈ цели дня (±12%), белок не ниже ~85% цели;",
    "- разнообразие: не повторять одно блюдо >2 раз за неделю; чередовать семейства белка (fish/chicken/turkey/plant/…);",
    "- перекусы — проще и быстрее (меньше минут), основные приёмы — сытнее;",
    "- вкус и разнообразие кухонь важны: не неделя «грудь+гречка»;",
    input.mode === "fill-empty"
      ? "- mode=fill-empty: не трогай уже занятые слоты из baseline (их можно не дублировать в ответе)."
      : "- mode=replace-all: заполни ВСЕ слоты всех дней.",
    input.preferencesNotes?.trim()
      ? `Пожелания пользователя: ${input.preferencesNotes.trim().slice(0, 500)}`
      : "",
    "",
    `Цели на день: ${input.targets.kcal} ккал, Б ${input.targets.proteinG}, Ж ${input.targets.fatG}, У ${input.targets.carbsG}`,
    `Слоты: ${JSON.stringify(slots)}`,
    `Каталог: ${JSON.stringify(catalog)}`,
    `Baseline (алгоритм): ${JSON.stringify(baselineCompact)}`,
    "Улучши baseline: лучше вкус/разнообразие при сохранении КБЖУ. JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type GenerateWeekWithLlmInput = {
  weekPlan: WeekPlan;
  targets: MealPlanTargets;
  recipes: Recipe[];
  options?: GenerateWeekPlanOptions;
  preferencesNotes?: string;
};

export type GenerateWeekWithLlmResult = GenerateWeekPlanResult & {
  source: "llm" | "algorithm";
  modelUsed?: string;
  llmError?: string;
};

/**
 * Сначала алгоритм, затем LLM-улучшение; при ошибке LLM — алгоритм.
 */
export async function generateWeekPlanWithLlm(
  input: GenerateWeekWithLlmInput
): Promise<GenerateWeekWithLlmResult> {
  const options = input.options ?? {};
  const baseline = generateWeekPlan(input.weekPlan, input.targets, input.recipes, options);
  const mode = options.mode ?? "fill-empty";

  if (input.recipes.length < 3) {
    return { ...baseline, source: "algorithm", llmError: "Слишком мало рецептов для LLM." };
  }

  try {
    const completion = await chatCompletion({
      model: mealPlanLlmModel(),
      temperature: 0.45,
      maxTokens: 3500,
      messages: [
        {
          role: "system",
          content:
            "Ты планировщик питания. Отвечаешь строго валидным JSON без markdown-обёртки, если возможно.",
        },
        {
          role: "user",
          content: buildPrompt({
            weekStart: input.weekPlan.weekStart,
            targets: input.targets,
            recipes: input.recipes,
            baseline,
            mode,
            preferencesNotes: input.preferencesNotes,
          }),
        },
      ],
    });

    const text = completion.content?.trim() ?? "";
    const parsed = parseJsonObject(text);
    const recipesById = new Map(input.recipes.map((r) => [r.id, r]));
    const existing =
      mode === "fill-empty"
        ? input.weekPlan.entries.filter((e) => datesForWeek(input.weekPlan.weekStart).includes(e.date))
        : [];
    const validated = parsed
      ? validateLlmEntries(parsed, input.weekPlan.weekStart, input.targets, recipesById, mode, existing)
      : null;

    if (!validated) {
      return {
        ...baseline,
        source: "algorithm",
        modelUsed: completion.modelUsed,
        llmError: "Модель вернула невалидный план — оставлен алгоритм.",
      };
    }

    const weekPlan: WeekPlan = {
      weekStart: input.weekPlan.weekStart,
      locked: input.weekPlan.locked,
      entries: validated,
    };

    const daySummaries = datesForWeek(weekPlan.weekStart).map((date) => {
      let kcal = 0;
      let proteinG = 0;
      for (const e of validated) {
        if (e.date !== date) continue;
        const r = recipesById.get(e.recipeId);
        if (!r) continue;
        kcal += r.macrosPerServing.kcal * e.portions;
        proteinG += r.macrosPerServing.proteinG * e.portions;
      }
      return {
        date,
        kcal: Math.round(kcal),
        proteinG: Math.round(proteinG * 10) / 10,
        targetKcal: input.targets.kcal,
        targetProteinG: input.targets.proteinG,
      };
    });

    const filled = validated.length;
    return {
      weekPlan,
      filled,
      skipped: 0,
      daySummaries,
      source: "llm",
      modelUsed: completion.modelUsed,
    };
  } catch (e) {
    return {
      ...baseline,
      source: "algorithm",
      llmError: e instanceof Error ? e.message : String(e),
    };
  }
}
