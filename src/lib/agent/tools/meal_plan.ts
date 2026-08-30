/**
 * Тулы агента для раздела «Питание» (/meal-plan): чтение снимка с клиента и запись через merge.
 * Данные живут в localStorage браузера; клиент передаёт снимок в POST /api/chat как mealPlan,
 * после успешного set_meal_plan_state клиент применяет merged к localStorage.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import type { MealPlanAgentPayload } from "@/lib/features/meal-plan/mealPlanMerge";
import { mergeMealPlanPayload } from "@/lib/features/meal-plan/mealPlanMerge";
import { generateWeekPlan } from "@/lib/features/meal-plan/generateWeekPlan";
import { generateWeekPlanWithLlm } from "@/lib/features/meal-plan/generateWeekPlanLlm";
import { recipeById, SEED_RECIPES } from "@/lib/features/meal-plan/recipes";
import { weekPlanToPlanLines, type WeekPlan, type WeekPlanEntry } from "@/lib/features/meal-plan/weekPlan";

const RECIPE_IDS = SEED_RECIPES.map((r) => r.id).join(", ");

function enrichPlan(payload: MealPlanAgentPayload) {
  return {
    ...payload,
    planLines: payload.plan.map((line) => ({
      ...line,
      recipeName: recipeById(line.recipeId)?.name ?? line.recipeId,
    })),
  };
}

function recipeDiscoverySummary(payload: MealPlanAgentPayload) {
  const rd = payload.recipeDiscovery;
  const enabled = rd.sources.filter((s) => s.enabled);
  return {
    sourceCount: rd.sources.length,
    enabledHosts: enabled.map((s) => s.host),
    preferencesNotesPreview: rd.preferences.notes.slice(0, 400),
    novelty: rd.preferences.novelty,
    excludeRecent: rd.preferences.excludeRecent,
    historyRecentCount: rd.historyRecent.length,
  };
}

function parseWeekPlanArg(raw: unknown, fallbackStart: string): WeekPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const weekStart =
    typeof o.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.weekStart.trim())
      ? o.weekStart.trim()
      : fallbackStart;
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
      if (!recipeById(recipeId) && !SEED_RECIPES.some((r) => r.id === recipeId)) continue;
      entries.push({
        date,
        slotId,
        recipeId,
        portions: Math.min(32, Math.max(0.25, portions)),
      });
    }
  }
  return { weekStart, locked: Boolean(o.locked), entries: entries.slice(0, 200) };
}

export const getMealPlanStateTool: AgentTool = {
  name: "get_meal_plan_state",
  description: [
    "Раздел «Питание»: цели КБЖУ, слоты приёмов, коридор дефицита ккал, база продуктов дома, план порций по встроенному каталогу,",
    "плюс recipeDiscovery: список сайтов-источников рецептов (hostname), предпочтения поиска и хвост истории URL (чтобы реже повторяться).",
    "Работает только если в запросе чата передан снимок mealPlan (клиент шлёт автоматически).",
    "Кейсы: план, цели, источники рецептов, что недавно смотрели, подсказать запрос для поиска рецептов под предпочтения.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (_args, ctx) => {
    if (!ctx.mealPlanClient) {
      return {
        ok: false,
        error:
          "Снимок питания не передан. Откройте /meal-plan в этом браузере или отправьте сообщение из приложения — клиент должен приложить mealPlan к запросу чата.",
      };
    }
    return {
      ok: true,
      data: {
        ...enrichPlan(ctx.mealPlanClient),
        recipeDiscovery: recipeDiscoverySummary(ctx.mealPlanClient),
        recipeDiscoveryHistoryRecent: ctx.mealPlanClient.recipeDiscovery.historyRecent,
        knownRecipeIds: RECIPE_IDS,
        weekPlan: ctx.mealPlanClient.weekPlan ?? null,
      },
    };
  },
};

export const generateMealWeekPlanTool: AgentTool = {
  name: "generate_meal_week_plan",
  description: [
    "Автозаполнение недельного рациона по текущим targets из снимка mealPlan.",
    "Сначала алгоритм (веса слотов, порции, анти-повторы); при useLlm=true — доработка умной моделью.",
    "Не пишет в localStorage сам: покажи краткое превью (ккал/день, блюда), получи согласие,",
    "затем set_meal_plan_state с полями weekPlan и plan из ответа этого тула.",
    "mode: fill-empty (только пустые слоты) или replace-all. Каталог на сервере — сиды (knownRecipeIds).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["fill-empty", "replace-all"],
        description: "fill-empty — только пустые слоты; replace-all — пересобрать неделю.",
      },
      useLlm: {
        type: "boolean",
        description: "true (по умолчанию) — улучшить план через LLM; false — только алгоритм.",
      },
      weekStart: {
        type: "string",
        description: "Понедельник недели YYYY-MM-DD. Если нет — из снимка weekPlan или текущий понедельник.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    if (!ctx.mealPlanClient) {
      return {
        ok: false,
        error: "Нет снимка mealPlan — откройте /meal-plan и напишите из приложения.",
      };
    }
    const mode = args.mode === "replace-all" ? "replace-all" : "fill-empty";
    const useLlm = args.useLlm !== false;
    const fromClient = ctx.mealPlanClient.weekPlan;
    const weekStart =
      typeof args.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.weekStart.trim())
        ? args.weekStart.trim()
        : fromClient?.weekStart ??
          (() => {
            const d = new Date();
            const day = d.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            d.setDate(d.getDate() + diff);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${dd}`;
          })();

    const current: WeekPlan = {
      weekStart,
      locked: Boolean(fromClient?.locked),
      entries: fromClient?.weekStart === weekStart ? (fromClient.entries ?? []) : [],
    };
    if (current.locked) {
      return { ok: false, error: "Неделя зафиксирована — попросите пользователя разблокировать в UI." };
    }

    const options = { mode: mode as "fill-empty" | "replace-all" };
    const notes = ctx.mealPlanClient.recipeDiscovery?.preferences?.notes ?? "";

    const result = useLlm
      ? await generateWeekPlanWithLlm({
          weekPlan: current,
          targets: ctx.mealPlanClient.targets,
          recipes: SEED_RECIPES,
          options,
          preferencesNotes: notes,
        })
      : {
          ...generateWeekPlan(current, ctx.mealPlanClient.targets, SEED_RECIPES, options),
          source: "algorithm" as const,
        };

    const plan = weekPlanToPlanLines(result.weekPlan);
    return {
      ok: true,
      data: {
        source: result.source,
        modelUsed: "modelUsed" in result ? result.modelUsed : undefined,
        llmError: "llmError" in result ? result.llmError : undefined,
        filled: result.filled,
        daySummaries: result.daySummaries,
        weekPlan: result.weekPlan,
        plan,
        previewLines: result.weekPlan.entries.map((e) => ({
          ...e,
          recipeName: recipeById(e.recipeId)?.name ?? e.recipeId,
        })),
        hint: "После согласия пользователя вызови set_meal_plan_state({ weekPlan, plan }) с этими полями.",
      },
    };
  },
};

export const setMealPlanStateTool: AgentTool = {
  name: "set_meal_plan_state",
  description: [
    "Обновить настройки питания и/или план порций: частично передать targets, staples, plan, recipeDiscovery, weekPlan — слияние с текущим снимком mealPlan.",
    "После успешного вызова клиент запишет результат в localStorage (пользователь увидит изменения на /meal-plan).",
    "targets: объект с полями kcal, proteinG, fatG, carbsG, deficitKcalMin, deficitKcalMax, mealSlots [{id, label}].",
    "Можно менять только часть полей — остальное сохранится из снимка.",
    "recipeDiscovery: только { sources?, preferences? }; каждый source { id, label, host, enabled }; host без протокола и пути;",
    "историю поиска на клиенте тул не перезаписывает.",
    "plan: массив { recipeId, portions }; recipeId только из knownRecipeIds из get_meal_plan_state.",
    "weekPlan: { weekStart, entries:[{date,slotId,recipeId,portions}], locked? } — план по дням/слотам (после generate_meal_week_plan).",
    "Правило продукта: любая запись в БД тренировок/финансов — только после явного «да» пользователя;",
    "для питания тоже сначала кратко покажи, что изменится, затем вызывай этот тул после согласия.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      targets: {
        type: "object",
        description: "Частичное или полное обновление целей (ккал, БЖУ, mealSlots, дефицит).",
        additionalProperties: true,
      },
      staples: {
        type: "string",
        description: "Полный текст базовых продуктов (многострочный), если нужно заменить.",
      },
      plan: {
        type: "array",
        description: "Новый план порций [{ recipeId, portions }].",
        items: {
          type: "object",
          properties: {
            recipeId: { type: "string" },
            portions: { type: "number" },
          },
          required: ["recipeId", "portions"],
        },
      },
      weekPlan: {
        type: "object",
        description: "Недельный план { weekStart, entries, locked? }.",
        additionalProperties: true,
      },
      recipeDiscovery: {
        type: "object",
        description: "Частичное обновление источников рецептов и предпочтений поиска.",
        additionalProperties: true,
        properties: {
          sources: { type: "array", description: "Полный или частичный список { id, label, host, enabled }" },
          preferences: {
            type: "object",
            description: "notes (строка), novelty (0–1), excludeRecent (число)",
            additionalProperties: true,
          },
        },
      },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    if (!ctx.mealPlanClient) {
      return {
        ok: false,
        error: "Нет снимка mealPlan — нельзя применить изменения. Клиент должен передать текущее состояние.",
      };
    }
    const patch: {
      targets?: unknown;
      staples?: unknown;
      plan?: unknown;
      recipeDiscovery?: unknown;
      weekPlan?: unknown;
    } = {};
    if (args.targets !== undefined) patch.targets = args.targets;
    if (args.staples !== undefined) patch.staples = args.staples;
    if (args.plan !== undefined) patch.plan = args.plan;
    if (args.recipeDiscovery !== undefined) patch.recipeDiscovery = args.recipeDiscovery;
    if (args.weekPlan !== undefined) patch.weekPlan = args.weekPlan;
    if (
      patch.targets === undefined &&
      patch.staples === undefined &&
      patch.plan === undefined &&
      patch.recipeDiscovery === undefined &&
      patch.weekPlan === undefined
    ) {
      return {
        ok: false,
        error: "Укажи хотя бы одно из полей: targets, staples, plan, recipeDiscovery, weekPlan.",
      };
    }

    let weekPlanToPersist: WeekPlan | undefined;
    if (patch.weekPlan !== undefined) {
      const fallback = ctx.mealPlanClient.weekPlan?.weekStart ?? new Date().toISOString().slice(0, 10);
      const parsed = parseWeekPlanArg(patch.weekPlan, fallback);
      if (!parsed) return { ok: false, error: "Некорректный weekPlan." };
      weekPlanToPersist = parsed;
      if (patch.plan === undefined) {
        patch.plan = weekPlanToPlanLines(parsed);
      }
    }

    const merged = mergeMealPlanPayload(ctx.mealPlanClient, patch);
    if (!merged.ok) return { ok: false, error: merged.error };

    const withWeek =
      weekPlanToPersist != null ? { ...merged.merged, weekPlan: weekPlanToPersist } : merged.merged;

    return {
      ok: true,
      data: {
        merged: withWeek,
        clientShouldPersist: true,
        preview: enrichPlan(withWeek),
      },
    };
  },
};
