/**
 * Тулы агента для раздела «Питание» (/meal-plan): чтение снимка с клиента и запись через merge.
 * Данные живут в localStorage браузера; клиент передаёт снимок в POST /api/chat как mealPlan,
 * после успешного set_meal_plan_state клиент применяет merged к localStorage.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import type { MealPlanAgentPayload } from "@/lib/features/meal-plan/mealPlanMerge";
import { mergeMealPlanPayload } from "@/lib/features/meal-plan/mealPlanMerge";
import { recipeById, SEED_RECIPES } from "@/lib/features/meal-plan/seedRecipes";

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
      },
    };
  },
};

export const setMealPlanStateTool: AgentTool = {
  name: "set_meal_plan_state",
  description: [
    "Обновить настройки питания и/или план порций: частично передать targets, staples, plan, recipeDiscovery — слияние с текущим снимком mealPlan.",
    "После успешного вызова клиент запишет результат в localStorage (пользователь увидит изменения на /meal-plan).",
    "targets: объект с полями kcal, proteinG, fatG, carbsG, deficitKcalMin, deficitKcalMax, mealSlots [{id, label}].",
    "Можно менять только часть полей — остальное сохранится из снимка.",
    "recipeDiscovery: только { sources?, preferences? }; каждый source { id, label, host, enabled }; host без протокола и пути;",
    "историю поиска на клиенте тул не перезаписывает.",
    "plan: массив { recipeId, portions }; recipeId только из knownRecipeIds из get_meal_plan_state.",
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
    } = {};
    if (args.targets !== undefined) patch.targets = args.targets;
    if (args.staples !== undefined) patch.staples = args.staples;
    if (args.plan !== undefined) patch.plan = args.plan;
    if (args.recipeDiscovery !== undefined) patch.recipeDiscovery = args.recipeDiscovery;
    if (
      patch.targets === undefined &&
      patch.staples === undefined &&
      patch.plan === undefined &&
      patch.recipeDiscovery === undefined
    ) {
      return {
        ok: false,
        error: "Укажи хотя бы одно из полей: targets, staples, plan, recipeDiscovery.",
      };
    }
    const merged = mergeMealPlanPayload(ctx.mealPlanClient, patch);
    if (!merged.ok) return { ok: false, error: merged.error };
    return {
      ok: true,
      data: {
        merged: merged.merged,
        clientShouldPersist: true,
        preview: enrichPlan(merged.merged),
      },
    };
  },
};
