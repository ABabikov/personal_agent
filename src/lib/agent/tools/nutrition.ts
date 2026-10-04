import type { AgentTool } from "@/lib/agent/tools/types";
import {
  listDishes,
  listFoodProducts,
  loadNutritionDay,
  loadNutritionWeek,
  logDishPortion,
  logProductPortion,
  logQuickMeal,
  saveDish,
  saveFoodProduct,
  saveNutritionSettings,
  saveWeight,
  searchLocalProducts,
  softDeleteFoodLog,
} from "@/lib/db/nutrition";
import { searchMagnit } from "@/lib/features/nutrition/magnitCatalog";
import { searchYarche } from "@/lib/features/nutrition/yarcheCatalog";
import { REFERENCE_FOODS, searchReferenceFoods } from "@/lib/features/nutrition/referenceCatalog";
import { isMealSlot, todayIso, type MealSlotId } from "@/lib/features/nutrition/slots";
import { suggestRemainingMeals, type MealSuggestion } from "@/lib/features/nutrition/suggest";
import type { NutritionSettings } from "@/lib/features/nutrition/targets";

function dateOrToday(raw: unknown): string {
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayIso();
}

function slotOr(raw: unknown, fallback: MealSlotId): MealSlotId {
  if (typeof raw === "string" && isMealSlot(raw)) return raw;
  return fallback;
}

export const getNutritionDayTool: AgentTool = {
  name: "get_nutrition_day",
  description:
    "Дневник питания за день: норма КБЖУ, съедено, остаток, записи приёмов и утренний вес. date = YYYY-MM-DD, по умолчанию сегодня по Москве.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const day = await loadNutritionDay(ctx.userId, dateOrToday(args.date));
    if ("error" in day) return { ok: false, error: day.error };
    return { ok: true, data: day.day };
  },
};

export const getNutritionWeekTool: AgentTool = {
  name: "get_nutrition_week",
  description:
    "Сводка дневника за календарную неделю даты (пн–вс): ккал по дням, среднее КБЖУ только по полным дням (два приёма и больше), ориентир расхода (базовый обмен × наступившие дни + калории тренировок), вес если записан. date — любой день этой недели, по умолчанию сегодня. Ничего не записывает.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const week = await loadNutritionWeek(ctx.userId, dateOrToday(args.date));
    if ("error" in week) return { ok: false, error: week.error };
    return { ok: true, data: week };
  },
};

export const searchFoodProductsTool: AgentTool = {
  name: "search_food_products",
  description:
    "Ищет продукт: свои сохранённые, справочник (мясо, крупы, готовые блюда вроде том яма — с КБЖУ на 100 г), Магнит и Ярче, если на карточке есть КБЖУ. «Говядина тушёная» в справочнике — мясо, не банка. Тушенка находится по слову «тушенка». Ничего не записывает.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Например: творог Ирмень обезжиренный" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query.length < 2) return { ok: false, error: "Запрос короче 2 символов." };
    const [local, magnitAll, yarche] = await Promise.all([
      searchLocalProducts(ctx.userId, query, 8),
      searchMagnit(query, 4),
      searchYarche(query, 8),
    ]);
    const yarcheHits = yarche.hits.filter((hit) => hit.kcalPer100 != null);
    return {
      ok: true,
      data: {
        local: "error" in local ? [] : local.products,
        localError: "error" in local ? local.error : null,
        reference: searchReferenceFoods(query, 24),
        magnit: magnitAll.filter((hit) => hit.kcalPer100 != null),
        yarche: yarcheHits,
        yarcheNote: yarche.unavailable
          ? "Каталог Ярче сейчас не ответил. Внеси КБЖУ с упаковки."
          : yarche.hits.length > 0 && yarcheHits.length === 0
            ? "В Ярче нашлись товары без КБЖУ на карточке."
            : null,
      },
    };
  },
};

export const logFoodTool: AgentTool = {
  name: "log_food",
  description: [
    "Записывает съеденное в дневник. Только после явного «да».",
    "Варианты одной записи: productId+grams (свой продукт), dishId+grams (своё блюдо),",
    "product{name,kcalPer100,proteinPer100,fatPer100,carbsPer100,grams,source,externalId} — сохранить карточку и записать порцию,",
    "quick{label,kcal,proteinG,fatG,carbsG} — только калории, без продукта.",
    "КБЖУ бренда не выдумывай: сначала search_food_products. Если карточки нет — спроси цифры с упаковки.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      date: { type: "string" },
      slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      productId: { type: "string" },
      referenceId: { type: "string", description: "id из search_food_products.reference, например beef-braised" },
      dishId: { type: "string" },
      grams: { type: "number" },
      product: {
        type: "object",
        properties: {
          name: { type: "string" },
          kcalPer100: { type: "number" },
          proteinPer100: { type: "number" },
          fatPer100: { type: "number" },
          carbsPer100: { type: "number" },
          source: { type: "string", enum: ["manual", "magnit", "yarche"] },
          externalId: { type: "string" },
          packageGrams: { type: "number" },
          url: { type: "string" },
        },
        required: ["name", "kcalPer100", "proteinPer100", "fatPer100", "carbsPer100"],
      },
      quick: {
        type: "object",
        properties: {
          label: { type: "string" },
          kcal: { type: "number" },
          proteinG: { type: "number" },
          fatG: { type: "number" },
          carbsG: { type: "number" },
        },
        required: ["label", "kcal"],
      },
    },
    required: ["slot"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const slot = slotOr(args.slot, "snack");
    const date = dateOrToday(args.date);
    const grams = typeof args.grams === "number" ? args.grams : null;

    if (typeof args.referenceId === "string" && grams != null) {
      const food = REFERENCE_FOODS.find((item) => item.id === args.referenceId);
      if (!food) return { ok: false, error: "В справочнике нет такого id." };
      const saved = await saveFoodProduct(ctx.userId, {
        name: food.name,
        source: "manual",
        externalId: `ref:${food.id}`,
        kcalPer100: food.kcalPer100,
        proteinPer100: food.proteinPer100,
        fatPer100: food.fatPer100,
        carbsPer100: food.carbsPer100,
      });
      if ("error" in saved) return { ok: false, error: saved.error };
      const logged = await logProductPortion(ctx.userId, {
        eatenOn: date,
        slot,
        productId: saved.product.id,
        grams,
      });
      if ("error" in logged) return { ok: false, error: logged.error };
      return { ok: true, data: { product: saved.product, entry: logged.entry } };
    }
    if (typeof args.productId === "string" && grams != null) {
      const logged = await logProductPortion(ctx.userId, {
        eatenOn: date,
        slot,
        productId: args.productId,
        grams,
      });
      if ("error" in logged) return { ok: false, error: logged.error };
      return { ok: true, data: logged.entry };
    }
    if (typeof args.dishId === "string" && grams != null) {
      const logged = await logDishPortion(ctx.userId, {
        eatenOn: date,
        slot,
        dishId: args.dishId,
        grams,
      });
      if ("error" in logged) return { ok: false, error: logged.error };
      return { ok: true, data: logged.entry };
    }
    if (args.product && typeof args.product === "object" && grams != null) {
      const p = args.product as Record<string, unknown>;
      const source =
        p.source === "magnit" || p.source === "yarche" || p.source === "manual" ? p.source : "manual";
      const saved = await saveFoodProduct(ctx.userId, {
        name: String(p.name ?? ""),
        source,
        externalId: typeof p.externalId === "string" ? p.externalId : null,
        kcalPer100: Number(p.kcalPer100),
        proteinPer100: Number(p.proteinPer100),
        fatPer100: Number(p.fatPer100),
        carbsPer100: Number(p.carbsPer100),
        packageGrams: typeof p.packageGrams === "number" ? p.packageGrams : null,
        url: typeof p.url === "string" ? p.url : null,
      });
      if ("error" in saved) return { ok: false, error: saved.error };
      const logged = await logProductPortion(ctx.userId, {
        eatenOn: date,
        slot,
        productId: saved.product.id,
        grams,
      });
      if ("error" in logged) return { ok: false, error: logged.error };
      return { ok: true, data: { product: saved.product, entry: logged.entry } };
    }
    if (args.quick && typeof args.quick === "object") {
      const q = args.quick as Record<string, unknown>;
      const logged = await logQuickMeal(ctx.userId, {
        eatenOn: date,
        slot,
        label: String(q.label ?? ""),
        kcal: Number(q.kcal),
        proteinG: typeof q.proteinG === "number" ? q.proteinG : 0,
        fatG: typeof q.fatG === "number" ? q.fatG : 0,
        carbsG: typeof q.carbsG === "number" ? q.carbsG : 0,
      });
      if ("error" in logged) return { ok: false, error: logged.error };
      return { ok: true, data: logged.entry };
    }
    return { ok: false, error: "Укажи productId, referenceId, dishId, product или quick, и граммы где нужно." };
  },
};

export const deleteFoodLogTool: AgentTool = {
  name: "delete_food_log",
  description: "Прячет запись дневника (soft-delete). Только после явного «да». id из get_nutrition_day.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) return { ok: false, error: "Нет id." };
    const res = await softDeleteFoodLog(ctx.userId, id);
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: { deleted: id } };
  },
};

export const logWeightTool: AgentTool = {
  name: "log_weight",
  description: "Утренний вес в кг на дату. Одна запись на день, повтор перезаписывает. Только после явного «да».",
  parameters: {
    type: "object",
    properties: {
      kg: { type: "number" },
      date: { type: "string" },
    },
    required: ["kg"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const kg = typeof args.kg === "number" ? args.kg : Number.NaN;
    const saved = await saveWeight(ctx.userId, dateOrToday(args.date), kg);
    if ("error" in saved) return { ok: false, error: saved.error };
    return { ok: true, data: saved };
  },
};

export const saveDishTool: AgentTool = {
  name: "save_dish",
  description: [
    "Сохраняет своё блюдо из продуктов с граммами. КБЖУ на 100 г готового = сумма ингредиентов / вес готового.",
    "cookedWeightG — вес готовой формы; если не передан, берётся сумма граммов ингредиентов.",
    "productId — уже сохранённые продукты. Только после явного «да». Само в дневник не пишет.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      cookedWeightG: { type: "number" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            productId: { type: "string" },
            grams: { type: "number" },
          },
          required: ["productId", "grams"],
        },
      },
    },
    required: ["name", "ingredients"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const ingredients = Array.isArray(args.ingredients)
      ? args.ingredients.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          if (typeof row.productId !== "string" || typeof row.grams !== "number") return [];
          return [{ productId: row.productId, grams: row.grams }];
        })
      : [];
    const saved = await saveDish(ctx.userId, {
      name: typeof args.name === "string" ? args.name : "",
      cookedWeightG: typeof args.cookedWeightG === "number" ? args.cookedWeightG : null,
      ingredients,
    });
    if ("error" in saved) return { ok: false, error: saved.error };
    return { ok: true, data: saved.dish };
  },
};

export const saveNutritionSettingsTool: AgentTool = {
  name: "save_nutrition_settings",
  description: [
    "Меняет норму дневника. Белок и углеводы — г/кг. Жир считается остатком и ниже пола не опускается.",
    "Пустое поле не передавай: оно останется как было. override = null снимает фиксацию и возвращает формулу.",
    "Только после явного «да». Сначала покажи, какие граммы получатся.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      proteinGPerKg: { type: "number" },
      carbsGPerKg: { type: "number" },
      fatFloorGPerKg: { type: "number" },
      deficitKcalMin: { type: "number" },
      deficitKcalMax: { type: "number" },
      kcalOverride: { type: "number" },
      proteinGOverride: { type: "number" },
      carbsGOverride: { type: "number" },
      fatGOverride: { type: "number" },
      clearKcalOverride: { type: "boolean" },
      clearProteinOverride: { type: "boolean" },
      clearCarbsOverride: { type: "boolean" },
      clearFatOverride: { type: "boolean" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const current = await loadNutritionDay(ctx.userId, todayIso());
    if ("error" in current) return { ok: false, error: current.error };
    const next: NutritionSettings = { ...current.day.settings };
    const numField = (key: keyof NutritionSettings, raw: unknown) => {
      if (typeof raw === "number") (next[key] as number) = raw;
    };
    numField("proteinGPerKg", args.proteinGPerKg);
    numField("carbsGPerKg", args.carbsGPerKg);
    numField("fatFloorGPerKg", args.fatFloorGPerKg);
    numField("deficitKcalMin", args.deficitKcalMin);
    numField("deficitKcalMax", args.deficitKcalMax);
    const nullable = (
      key: "kcalOverride" | "proteinGOverride" | "carbsGOverride" | "fatGOverride",
      clearKey: string
    ) => {
      if (args[clearKey] === true) next[key] = null;
      else if (typeof args[key] === "number") next[key] = args[key] as number;
    };
    nullable("kcalOverride", "clearKcalOverride");
    nullable("proteinGOverride", "clearProteinOverride");
    nullable("carbsGOverride", "clearCarbsOverride");
    nullable("fatGOverride", "clearFatOverride");
    if (next.deficitKcalMin > next.deficitKcalMax) {
      const swap = next.deficitKcalMin;
      next.deficitKcalMin = next.deficitKcalMax;
      next.deficitKcalMax = swap;
    }
    const saved = await saveNutritionSettings(ctx.userId, next);
    if ("error" in saved) return { ok: false, error: saved.error };
    const day = await loadNutritionDay(ctx.userId, todayIso());
    if ("error" in day) return { ok: true, data: { settings: saved.settings } };
    return { ok: true, data: { settings: saved.settings, target: day.day.target } };
  },
};

export const suggestRemainingMealsTool: AgentTool = {
  name: "suggest_remaining_meals",
  description:
    "Предлагает 1–2 порции из своих блюд и недавних продуктов под остаток КБЖУ. Ничего не записывает. Запись — отдельным log_food после «да».",
  parameters: {
    type: "object",
    properties: { date: { type: "string" } },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const day = await loadNutritionDay(ctx.userId, dateOrToday(args.date));
    if ("error" in day) return { ok: false, error: day.error };
    if (!day.day.remaining) return { ok: false, error: day.day.targetError ?? "Нет нормы." };
    const [dishes, products] = await Promise.all([
      listDishes(ctx.userId),
      listFoodProducts(ctx.userId),
    ]);
    if ("error" in dishes) return { ok: false, error: dishes.error };
    if ("error" in products) return { ok: false, error: products.error };

    const lastGrams = new Map<string, number>();
    for (const entry of [...day.day.entries].reverse()) {
      if (entry.grams == null) continue;
      const key = entry.dishId ? `dish:${entry.dishId}` : entry.productId ? `product:${entry.productId}` : "";
      if (key && !lastGrams.has(key)) lastGrams.set(key, entry.grams);
    }

    const candidates: MealSuggestion[] = [];
    for (const dish of dishes.dishes) {
      const grams = lastGrams.get(`dish:${dish.id}`) ?? 200;
      const k = grams / 100;
      candidates.push({
        kind: "dish",
        id: dish.id,
        name: dish.name,
        grams,
        kcal: Math.round(dish.per100.kcal * k * 10) / 10,
        proteinG: Math.round(dish.per100.proteinG * k * 10) / 10,
        fatG: Math.round(dish.per100.fatG * k * 10) / 10,
        carbsG: Math.round(dish.per100.carbsG * k * 10) / 10,
      });
    }
    for (const product of products.products) {
      const grams = lastGrams.get(`product:${product.id}`) ?? 100;
      const k = grams / 100;
      candidates.push({
        kind: "product",
        id: product.id,
        name: product.name,
        grams,
        kcal: Math.round(product.kcalPer100 * k * 10) / 10,
        proteinG: Math.round(product.proteinPer100 * k * 10) / 10,
        fatG: Math.round(product.fatPer100 * k * 10) / 10,
        carbsG: Math.round(product.carbsPer100 * k * 10) / 10,
      });
    }
    return {
      ok: true,
      data: {
        remaining: day.day.remaining,
        suggestions: suggestRemainingMeals(day.day.remaining, candidates),
      },
    };
  },
};
