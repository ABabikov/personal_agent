import { loadUserProfile } from "@/lib/db/profile";
import { supabase } from "@/lib/db/supabase";
import { dishPer100, macrosForGrams } from "@/lib/features/nutrition/dishMacros";
import { summarizeWeek, weekDates, type WeekSummary } from "@/lib/features/nutrition/week";
import { todayIso, type MealSlotId } from "@/lib/features/nutrition/slots";
import {
  computeDayTarget,
  DEFAULT_NUTRITION_SETTINGS,
  emptyMacros,
  subtractMacros,
  tdeeFromProfile,
  bmrFromProfile,
  addMacros,
  type DayTarget,
  type MacroTotals,
  type NutritionSettings,
} from "@/lib/features/nutrition/targets";
import type { Database } from "@/types/database";

type ProductSource = Database["public"]["Tables"]["food_products"]["Row"]["source"];

export type FoodProduct = {
  id: string;
  source: ProductSource;
  externalId: string | null;
  name: string;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  packageGrams: number | null;
  url: string | null;
};

export type DishIngredientView = {
  productId: string;
  name: string;
  grams: number;
};

export type DishView = {
  id: string;
  name: string;
  cookedWeightG: number;
  ingredientGrams: number;
  total: MacroTotals;
  per100: MacroTotals;
  ingredients: DishIngredientView[];
};

export type FoodLogEntry = {
  id: string;
  eatenOn: string;
  slot: MealSlotId;
  label: string;
  grams: number | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  productId: string | null;
  dishId: string | null;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapProduct(row: Database["public"]["Tables"]["food_products"]["Row"]): FoodProduct {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    name: row.name,
    kcalPer100: num(row.kcal_per_100),
    proteinPer100: num(row.protein_per_100),
    fatPer100: num(row.fat_per_100),
    carbsPer100: num(row.carbs_per_100),
    packageGrams: numOrNull(row.package_grams),
    url: row.url,
  };
}

function mapSettings(row: Database["public"]["Tables"]["nutrition_settings"]["Row"]): NutritionSettings {
  return {
    proteinGPerKg: num(row.protein_g_per_kg),
    carbsGPerKg: num(row.carbs_g_per_kg),
    fatFloorGPerKg: num(row.fat_floor_g_per_kg),
    deficitKcalMin: num(row.deficit_kcal_min),
    deficitKcalMax: num(row.deficit_kcal_max),
    kcalOverride: numOrNull(row.kcal_override),
    proteinGOverride: numOrNull(row.protein_g_override),
    carbsGOverride: numOrNull(row.carbs_g_override),
    fatGOverride: numOrNull(row.fat_g_override),
  };
}

function mapEntry(row: Database["public"]["Tables"]["food_log_entries"]["Row"]): FoodLogEntry {
  return {
    id: row.id,
    eatenOn: row.eaten_on,
    slot: row.slot,
    label: row.label,
    grams: numOrNull(row.grams),
    kcal: num(row.kcal),
    proteinG: num(row.protein_g),
    fatG: num(row.fat_g),
    carbsG: num(row.carbs_g),
    productId: row.food_product_id,
    dishId: row.dish_id,
  };
}

export async function loadNutritionSettings(
  userId: string
): Promise<{ settings: NutritionSettings } | { error: string }> {
  const { data, error } = await supabase
    .from("nutrition_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { settings: { ...DEFAULT_NUTRITION_SETTINGS } };
  return { settings: mapSettings(data) };
}

export async function saveNutritionSettings(
  userId: string,
  settings: NutritionSettings
): Promise<{ settings: NutritionSettings } | { error: string }> {
  const row: Database["public"]["Tables"]["nutrition_settings"]["Insert"] = {
    user_id: userId,
    protein_g_per_kg: settings.proteinGPerKg,
    carbs_g_per_kg: settings.carbsGPerKg,
    fat_floor_g_per_kg: settings.fatFloorGPerKg,
    deficit_kcal_min: settings.deficitKcalMin,
    deficit_kcal_max: settings.deficitKcalMax,
    kcal_override: settings.kcalOverride,
    protein_g_override: settings.proteinGOverride,
    carbs_g_override: settings.carbsGOverride,
    fat_g_override: settings.fatGOverride,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("nutrition_settings")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Не удалось сохранить норму." };
  return { settings: mapSettings(data) };
}

export async function searchLocalProducts(
  userId: string,
  query: string,
  limit = 8
): Promise<{ products: FoodProduct[] } | { error: string }> {
  const q = query.trim();
  let req = supabase
    .from("food_products")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (q.length > 0) req = req.ilike("name", `%${q}%`);
  const { data, error } = await req;
  if (error) return { error: error.message };
  return { products: (data ?? []).map(mapProduct) };
}

export async function listFoodProducts(
  userId: string
): Promise<{ products: FoodProduct[] } | { error: string }> {
  const { data, error } = await supabase
    .from("food_products")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true })
    .limit(200);
  if (error) return { error: error.message };
  return { products: (data ?? []).map(mapProduct) };
}

export async function saveFoodProduct(
  userId: string,
  input: {
    name: string;
    source: ProductSource;
    externalId?: string | null;
    kcalPer100: number;
    proteinPer100: number;
    fatPer100: number;
    carbsPer100: number;
    packageGrams?: number | null;
    url?: string | null;
  }
): Promise<{ product: FoodProduct } | { error: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Нужно название продукта." };
  if (![input.kcalPer100, input.proteinPer100, input.fatPer100, input.carbsPer100].every(Number.isFinite)) {
    return { error: "КБЖУ на 100 г должны быть числами." };
  }
  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    const { data: existing, error: selErr } = await supabase
      .from("food_products")
      .select("*")
      .eq("user_id", userId)
      .eq("source", input.source)
      .eq("external_id", externalId)
      .maybeSingle();
    if (selErr) return { error: selErr.message };
    if (existing) {
      const { data, error } = await supabase
        .from("food_products")
        .update({
          name,
          kcal_per_100: input.kcalPer100,
          protein_per_100: input.proteinPer100,
          fat_per_100: input.fatPer100,
          carbs_per_100: input.carbsPer100,
          package_grams: input.packageGrams ?? null,
          url: input.url ?? null,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error || !data) return { error: error?.message ?? "Не удалось обновить продукт." };
      return { product: mapProduct(data) };
    }
  }
  const { data, error } = await supabase
    .from("food_products")
    .insert({
      user_id: userId,
      source: input.source,
      external_id: externalId,
      name,
      kcal_per_100: input.kcalPer100,
      protein_per_100: input.proteinPer100,
      fat_per_100: input.fatPer100,
      carbs_per_100: input.carbsPer100,
      package_grams: input.packageGrams ?? null,
      url: input.url ?? null,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Не удалось сохранить продукт." };
  return { product: mapProduct(data) };
}

export async function getFoodProduct(
  userId: string,
  id: string
): Promise<{ product: FoodProduct } | { error: string }> {
  const { data, error } = await supabase
    .from("food_products")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Продукт не найден." };
  return { product: mapProduct(data) };
}

async function insertLog(
  userId: string,
  input: {
    eatenOn: string;
    slot: MealSlotId;
    label: string;
    grams: number | null;
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    productId: string | null;
    dishId: string | null;
  }
): Promise<{ entry: FoodLogEntry } | { error: string }> {
  const { data, error } = await supabase
    .from("food_log_entries")
    .insert({
      user_id: userId,
      eaten_on: input.eatenOn,
      slot: input.slot,
      label: input.label,
      grams: input.grams,
      kcal: input.kcal,
      protein_g: input.proteinG,
      fat_g: input.fatG,
      carbs_g: input.carbsG,
      food_product_id: input.productId,
      dish_id: input.dishId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Не удалось записать приём." };
  return { entry: mapEntry(data) };
}

export async function logProductPortion(
  userId: string,
  input: { eatenOn: string; slot: MealSlotId; productId: string; grams: number }
): Promise<{ entry: FoodLogEntry } | { error: string }> {
  if (!(input.grams > 0)) return { error: "Граммы должны быть больше нуля." };
  const found = await getFoodProduct(userId, input.productId);
  if ("error" in found) return found;
  const m = macrosForGrams(input.grams, {
    kcal: found.product.kcalPer100,
    proteinG: found.product.proteinPer100,
    fatG: found.product.fatPer100,
    carbsG: found.product.carbsPer100,
  });
  return insertLog(userId, {
    eatenOn: input.eatenOn,
    slot: input.slot,
    label: found.product.name,
    grams: input.grams,
    kcal: m.kcal,
    proteinG: m.proteinG,
    fatG: m.fatG,
    carbsG: m.carbsG,
    productId: found.product.id,
    dishId: null,
  });
}

export async function logQuickMeal(
  userId: string,
  input: {
    eatenOn: string;
    slot: MealSlotId;
    label: string;
    kcal: number;
    proteinG?: number;
    fatG?: number;
    carbsG?: number;
  }
): Promise<{ entry: FoodLogEntry } | { error: string }> {
  const label = input.label.trim();
  if (!label) return { error: "Нужно название." };
  if (!(input.kcal >= 0)) return { error: "Ккал не могут быть отрицательными." };
  return insertLog(userId, {
    eatenOn: input.eatenOn,
    slot: input.slot,
    label,
    grams: null,
    kcal: input.kcal,
    proteinG: input.proteinG ?? 0,
    fatG: input.fatG ?? 0,
    carbsG: input.carbsG ?? 0,
    productId: null,
    dishId: null,
  });
}

export async function listDishes(
  userId: string
): Promise<{ dishes: DishView[] } | { error: string }> {
  const { data: dishes, error } = await supabase
    .from("dishes")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) return { error: error.message };
  if (!dishes?.length) return { dishes: [] };

  const ids = dishes.map((d) => d.id);
  const { data: ingredients, error: ingErr } = await supabase
    .from("dish_ingredients")
    .select("*")
    .in("dish_id", ids)
    .order("sort_order", { ascending: true });
  if (ingErr) return { error: ingErr.message };

  const productIds = [...new Set((ingredients ?? []).map((i) => i.food_product_id))];
  const { data: products, error: prodErr } =
    productIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("food_products").select("*").in("id", productIds).eq("user_id", userId);
  if (prodErr) return { error: prodErr.message };
  const byId = new Map((products ?? []).map((p) => [p.id, mapProduct(p)]));

  const views: DishView[] = [];
  for (const dish of dishes) {
    const lines = (ingredients ?? []).filter((i) => i.dish_id === dish.id);
    const mapped = lines.map((line) => {
      const product = byId.get(line.food_product_id);
      return {
        productId: line.food_product_id,
        name: product?.name ?? "продукт",
        grams: num(line.grams),
        kcalPer100: product?.kcalPer100 ?? 0,
        proteinPer100: product?.proteinPer100 ?? 0,
        fatPer100: product?.fatPer100 ?? 0,
        carbsPer100: product?.carbsPer100 ?? 0,
      };
    });
    const calc = dishPer100(mapped, num(dish.cooked_weight_g));
    if ("error" in calc) continue;
    views.push({
      id: dish.id,
      name: dish.name,
      cookedWeightG: num(dish.cooked_weight_g),
      ingredientGrams: calc.ingredientGrams,
      total: calc.total,
      per100: calc.per100,
      ingredients: mapped.map((m) => ({ productId: m.productId, name: m.name, grams: m.grams })),
    });
  }
  return { dishes: views };
}

export async function saveDish(
  userId: string,
  input: {
    name: string;
    cookedWeightG?: number | null;
    ingredients: { productId: string; grams: number }[];
  }
): Promise<{ dish: DishView } | { error: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Нужно название блюда." };
  if (input.ingredients.length < 1) return { error: "Добавь хотя бы один продукт." };

  const products: FoodProduct[] = [];
  for (const line of input.ingredients) {
    const found = await getFoodProduct(userId, line.productId);
    if ("error" in found) return found;
    products.push(found.product);
  }
  const cooked =
    input.cookedWeightG != null && input.cookedWeightG > 0
      ? input.cookedWeightG
      : input.ingredients.reduce((s, l) => s + l.grams, 0);
  const calc = dishPer100(
    input.ingredients.map((line, i) => ({
      grams: line.grams,
      kcalPer100: products[i].kcalPer100,
      proteinPer100: products[i].proteinPer100,
      fatPer100: products[i].fatPer100,
      carbsPer100: products[i].carbsPer100,
    })),
    cooked
  );
  if ("error" in calc) return calc;

  const { data: dish, error } = await supabase
    .from("dishes")
    .insert({
      user_id: userId,
      name,
      cooked_weight_g: cooked,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !dish) return { error: error?.message ?? "Не удалось сохранить блюдо." };

  const { error: ingErr } = await supabase.from("dish_ingredients").insert(
    input.ingredients.map((line, i) => ({
      dish_id: dish.id,
      food_product_id: line.productId,
      grams: line.grams,
      sort_order: i,
    }))
  );
  if (ingErr) return { error: ingErr.message };

  return {
    dish: {
      id: dish.id,
      name,
      cookedWeightG: cooked,
      ingredientGrams: calc.ingredientGrams,
      total: calc.total,
      per100: calc.per100,
      ingredients: input.ingredients.map((line, i) => ({
        productId: line.productId,
        name: products[i].name,
        grams: line.grams,
      })),
    },
  };
}

export async function logDishPortion(
  userId: string,
  input: { eatenOn: string; slot: MealSlotId; dishId: string; grams: number }
): Promise<{ entry: FoodLogEntry } | { error: string }> {
  if (!(input.grams > 0)) return { error: "Граммы должны быть больше нуля." };
  const listed = await listDishes(userId);
  if ("error" in listed) return listed;
  const dish = listed.dishes.find((d) => d.id === input.dishId);
  if (!dish) return { error: "Блюдо не найдено." };
  const m = macrosForGrams(input.grams, {
    kcal: dish.per100.kcal,
    proteinG: dish.per100.proteinG,
    fatG: dish.per100.fatG,
    carbsG: dish.per100.carbsG,
  });
  return insertLog(userId, {
    eatenOn: input.eatenOn,
    slot: input.slot,
    label: dish.name,
    grams: input.grams,
    kcal: m.kcal,
    proteinG: m.proteinG,
    fatG: m.fatG,
    carbsG: m.carbsG,
    productId: null,
    dishId: dish.id,
  });
}

export async function listFoodLog(
  userId: string,
  eatenOn: string
): Promise<{ entries: FoodLogEntry[] } | { error: string }> {
  const { data, error } = await supabase
    .from("food_log_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("eaten_on", eatenOn)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };
  return { entries: (data ?? []).map(mapEntry) };
}

export async function listRecentFoodLog(
  userId: string,
  limit = 40
): Promise<{ entries: FoodLogEntry[] } | { error: string }> {
  const { data, error } = await supabase
    .from("food_log_entries")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message };
  return { entries: (data ?? []).map(mapEntry) };
}

export async function softDeleteFoodLog(
  userId: string,
  id: string
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("food_log_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function loadWeight(
  userId: string,
  weighedOn: string
): Promise<{ kg: number | null } | { error: string }> {
  const { data, error } = await supabase
    .from("weight_logs")
    .select("kg")
    .eq("user_id", userId)
    .eq("weighed_on", weighedOn)
    .maybeSingle();
  if (error) return { error: error.message };
  return { kg: data ? num(data.kg) : null };
}

export async function saveWeight(
  userId: string,
  weighedOn: string,
  kg: number
): Promise<{ kg: number } | { error: string }> {
  if (!(kg > 0 && kg < 400)) return { error: "Вес выглядит неверно." };
  const { data, error } = await supabase
    .from("weight_logs")
    .upsert(
      { user_id: userId, weighed_on: weighedOn, kg },
      { onConflict: "user_id,weighed_on" }
    )
    .select("kg")
    .single();
  if (error || !data) return { error: error?.message ?? "Не удалось сохранить вес." };
  return { kg: num(data.kg) };
}

export type NutritionDay = {
  date: string;
  settings: NutritionSettings;
  target: DayTarget | null;
  targetError: string | null;
  entries: FoodLogEntry[];
  eaten: MacroTotals;
  remaining: MacroTotals | null;
  weightKg: number | null;
  profileWeightKg: number | null;
};

export async function loadNutritionDay(
  userId: string,
  eatenOn: string
): Promise<{ day: NutritionDay } | { error: string }> {
  const [settingsR, entriesR, weightR, profileR] = await Promise.all([
    loadNutritionSettings(userId),
    listFoodLog(userId, eatenOn),
    loadWeight(userId, eatenOn),
    loadUserProfile(userId),
  ]);
  if ("error" in settingsR) return settingsR;
  if ("error" in entriesR) return entriesR;
  if ("error" in weightR) return weightR;
  if ("error" in profileR) return profileR;

  const profile = profileR.data;
  const tdee = profile
    ? tdeeFromProfile({
        weight: profile.weight,
        height: profile.height,
        age: profile.age,
        gender: profile.gender,
        activityLevel: profile.activity_level,
        bodyFatPct: profile.body_fat_pct,
      })
    : null;
  const computed = computeDayTarget({
    weightKg: profile?.weight ?? null,
    tdee,
    settings: settingsR.settings,
  });
  const eaten = entriesR.entries.reduce(
    (sum, entry) =>
      addMacros(sum, {
        kcal: entry.kcal,
        proteinG: entry.proteinG,
        fatG: entry.fatG,
        carbsG: entry.carbsG,
      }),
    emptyMacros()
  );
  const target = computed.ok ? computed.target : null;
  return {
    day: {
      date: eatenOn,
      settings: settingsR.settings,
      target,
      targetError: computed.ok ? null : computed.error,
      entries: entriesR.entries,
      eaten,
      remaining: target ? subtractMacros(target, eaten) : null,
      weightKg: weightR.kg,
      profileWeightKg: profile?.weight ?? null,
    },
  };
}

export async function loadNutritionWeek(
  userId: string,
  anchorIso: string
): Promise<{ week: WeekSummary; targetKcal: number | null } | { error: string }> {
  const dates = weekDates(anchorIso);
  const from = dates[0];
  const to = dates[6];
  const [settingsR, profileR, entriesRes, weightsRes, workoutsRes] = await Promise.all([
    loadNutritionSettings(userId),
    loadUserProfile(userId),
    supabase
      .from("food_log_entries")
      .select("*")
      .eq("user_id", userId)
      .gte("eaten_on", from)
      .lte("eaten_on", to)
      .is("deleted_at", null),
    supabase
      .from("weight_logs")
      .select("weighed_on, kg")
      .eq("user_id", userId)
      .gte("weighed_on", from)
      .lte("weighed_on", to),
    supabase
      .from("workouts")
      .select("date, calories_estimated")
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to)
      .is("deleted_at", null),
  ]);
  if ("error" in settingsR) return settingsR;
  if ("error" in profileR) return profileR;
  if (entriesRes.error) return { error: entriesRes.error.message };
  if (weightsRes.error) return { error: weightsRes.error.message };
  if (workoutsRes.error) return { error: workoutsRes.error.message };

  const profile = profileR.data;
  const profileInput = profile
    ? {
        weight: profile.weight,
        height: profile.height,
        age: profile.age,
        gender: profile.gender,
        activityLevel: profile.activity_level,
        bodyFatPct: profile.body_fat_pct,
      }
    : null;
  const bmr = profileInput ? bmrFromProfile(profileInput) : null;
  const tdee = profileInput ? tdeeFromProfile(profileInput) : null;
  const computed = computeDayTarget({
    weightKg: profile?.weight ?? null,
    tdee,
    settings: settingsR.settings,
  });
  const week = summarizeWeek({
    anchorIso,
    today: todayIso(),
    bmr,
    entries: (entriesRes.data ?? []).map(mapEntry),
    weights: (weightsRes.data ?? []).map((row) => ({ date: row.weighed_on, kg: num(row.kg) })),
    workouts: (workoutsRes.data ?? []).map((row) => ({
      date: row.date,
      kcal: num(row.calories_estimated),
    })),
  });
  return { week, targetKcal: computed.ok ? computed.target.kcal : null };
}
