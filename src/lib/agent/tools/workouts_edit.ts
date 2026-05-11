/**
 * Destructive операции с тренировками: edit, soft-delete, restore.
 *
 * SOFT-DELETE: ставим `workouts.deleted_at` и опциональный `deleted_reason`.
 * Все read-запросы (календарь, аналитика, last_*, recent_*) фильтруют `deleted_at IS NULL`,
 * поэтому удалённая тренировка пропадает из UI/статистики, но строки остаются в БД.
 * Восстановить можно через `restore_workout` или вручную:
 *   `UPDATE workouts SET deleted_at = NULL WHERE id = '...';`
 *
 * UPDATE-операции делают «in-place» апдейт (старая версия теряется). Перед каждым апдейтом
 * агент обязан показать diff пользователю и получить подтверждение — это правило прописано в system prompt.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import { supabase } from "@/lib/db/supabase";
import { loadUserProfile } from "@/lib/db/profile";
import { exerciseTonnage, totalTonnage } from "@/lib/features/workouts/tonnage";
import { estimateGymCalories } from "@/lib/features/workouts/calories";
import type { Database, GymSet } from "@/types/database";

type WorkoutUpdate = Database["public"]["Tables"]["workouts"]["Update"];

function parseSets(raw: unknown): GymSet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const weight = Number(o.weight);
      const reps = Number(o.reps);
      if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
      return { weight, reps };
    })
    .filter((x): x is GymSet => x != null);
}

async function fetchOwnedActiveWorkout(workoutId: string, userId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("id", workoutId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Тренировка не найдена или уже удалена" };
  return { workout: data };
}

// ───────────────────────────── DELETE / RESTORE ─────────────────────────────

export const deleteWorkoutTool: AgentTool = {
  name: "delete_workout",
  description: [
    "БЕЗОПАСНОЕ удаление тренировки (soft delete).",
    "Ставит флаг `deleted_at = now()` — строка остаётся в БД, но скрывается из всех UI и статистик.",
    "Восстановить можно тулом `restore_workout` или вручную в SQL.",
    "",
    "ВАЖНО: перед вызовом покажи пользователю карточку тренировки (что именно удаляешь — дата/тип/основные числа) и попроси подтверждение.",
    "",
    "Кейсы:",
    "— «удали тренировку 13.05» / «убери последнюю силовую — это была ошибка»,",
    "— «удали то плавание, где я указал 5 км вместо 1.5 км».",
    "Чтобы найти id — сначала get_recent_workouts / get_workouts_in_range / get_last_*.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "workouts.id" },
      reason: {
        type: "string",
        description: "Опционально: причина удаления (пишется в deleted_reason для аудита)",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = String(args.id);
    const reason = typeof args.reason === "string" ? args.reason : null;
    const r = await fetchOwnedActiveWorkout(id, ctx.userId);
    if ("error" in r) return { ok: false, error: r.error ?? "Ошибка" };
    const { error } = await supabase
      .from("workouts")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_reason: reason,
      })
      .eq("id", id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: {
        soft_deleted: true,
        id,
        restore_with: "restore_workout({id})",
      },
    };
  },
};

export const restoreWorkoutTool: AgentTool = {
  name: "restore_workout",
  description: [
    "Восстановить ранее soft-deleted тренировку: убирает `deleted_at`, она снова появляется в UI и статистике.",
    "Чтобы увидеть кандидатов — вызови `list_deleted_workouts`.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = String(args.id);
    const { data, error } = await supabase
      .from("workouts")
      .update({ deleted_at: null, deleted_reason: null })
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .not("deleted_at", "is", null)
      .select("id, date, type")
      .single();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Тренировка не найдена или не была удалена" };
    return { ok: true, data: { restored: true, ...data } };
  },
};

export const listDeletedWorkoutsTool: AgentTool = {
  name: "list_deleted_workouts",
  description: [
    "Список soft-deleted тренировок (deleted_at IS NOT NULL). Полезно когда пользователь",
    "просит восстановить тренировку, но не знает её id.",
    "Возвращает: id, date, type, deleted_at, deleted_reason, основные числа.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, args.limit)) : 50;
    const { data, error } = await supabase
      .from("workouts")
      .select(
        "id, date, type, body_weight, total_tonnage, total_distance, calories_estimated, notes, deleted_at, deleted_reason"
      )
      .eq("user_id", ctx.userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { workouts: data ?? [], count: data?.length ?? 0 } };
  },
};

// ───────────────────────────── UPDATE workout-level ─────────────────────────

export const updateWorkoutTool: AgentTool = {
  name: "update_workout",
  description: [
    "Изменяет поля самой тренировки (БЕЗ упражнений/серий — для них есть update_gym_exercises и update_swim_series).",
    "Меняем только то, что передал: дату, заметки, вес тела (для силовой), длительность/калории (для свободного override).",
    "",
    "ВАЖНО: in-place апдейт. Сначала покажи пользователю текущее значение → новое, попроси подтверждение.",
    "",
    "Кейсы:",
    "— «поменяй дату 13.05 → 14.05»,",
    "— «добавь заметку: болело колено»,",
    "— «я указал не тот вес тела, на самом деле 78».",
    "",
    "Если меняешь body_weight на силовой — `calories_estimated` пересчитывается автоматически",
    "(берётся тоннаж из gym_exercises). Это можно отключить, передав `recompute_calories: false`.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" },
      notes: { type: "string", description: "Чтобы стереть — передай пустую строку" },
      body_weight: { type: "number" },
      calories_estimated: { type: "number", description: "Явный override калорий" },
      recompute_calories: {
        type: "boolean",
        description: "Если true и есть тоннаж — пересчитать калории. По умолчанию true, если поменялся body_weight.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = String(args.id);
    const r = await fetchOwnedActiveWorkout(id, ctx.userId);
    if ("error" in r) return { ok: false, error: r.error ?? "Ошибка" };
    const w = r.workout;

    const patch: WorkoutUpdate = {};
    if (typeof args.date === "string" && args.date) patch.date = args.date;
    if (typeof args.notes === "string") patch.notes = args.notes ? args.notes : null;
    if (typeof args.body_weight === "number") patch.body_weight = args.body_weight;
    if (typeof args.calories_estimated === "number") patch.calories_estimated = args.calories_estimated;

    const wantsRecompute =
      typeof args.recompute_calories === "boolean"
        ? args.recompute_calories
        : typeof args.body_weight === "number";

    // Пересчёт калорий: только для силовой, если есть подходы и валидный вес тела.
    if (wantsRecompute && w.type === "gym" && typeof args.calories_estimated !== "number") {
      let bw: number | null =
        typeof args.body_weight === "number" ? args.body_weight : w.body_weight;
      if (!bw || bw <= 0) {
        const prof = await loadUserProfile(ctx.userId);
        if (!("error" in prof)) bw = prof.data?.weight ?? null;
      }
      if (bw && bw > 0) {
        const { data: ex } = await supabase
          .from("gym_exercises")
          .select("sets")
          .eq("workout_id", id);
        const exercises = (ex ?? []).map((e) => ({ sets: e.sets as GymSet[] }));
        const est = estimateGymCalories({
          bodyWeightKg: bw,
          exercises,
          durationMinOverride: null,
        });
        if (est) patch.calories_estimated = est.calories;
      }
    }

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "Нечего обновлять (пустой patch)" };
    }

    const { data, error } = await supabase
      .from("workouts")
      .update(patch)
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .is("deleted_at", null)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { updated: true, before: w, after: data } };
  },
};

// ───────────────────────────── UPDATE gym exercises ─────────────────────────

export const updateGymExercisesTool: AgentTool = {
  name: "update_gym_exercises",
  description: [
    "ПОЛНАЯ замена упражнений силовой тренировки. Старые `gym_exercises` удаляются (HARD), вставляются новые.",
    "Это правильный путь, чтобы исправить любой подход / переименовать упражнение / добавить-убрать упражнение.",
    "",
    "ВАЖНО: дочерние записи НЕ имеют soft-delete (только сама workout). Поэтому перед апдейтом",
    "ОБЯЗАТЕЛЬНО:",
    "  1. get_workout_details(id) — получить текущее содержание,",
    "  2. показать пользователю diff (что меняется),",
    "  3. дождаться явного подтверждения,",
    "  4. только потом update_gym_exercises.",
    "Откатить полностью можно через Supabase PITR; вернуть один подход — записать заново тулом.",
    "",
    "Автоматически пересчитываются `workouts.total_tonnage` и `calories_estimated` (если есть вес тела).",
    "",
    "Кейсы:",
    "— «во 2-м подходе жима 65, а не 70»,",
    "— «убери последнее упражнение, я его не делал»,",
    "— «переименуй \"жим штанги\" в \"жим лёжа\"».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      workout_id: { type: "string" },
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            sets: {
              type: "array",
              items: {
                type: "object",
                properties: { weight: { type: "number" }, reps: { type: "integer" } },
                required: ["weight", "reps"],
              },
            },
          },
          required: ["name", "sets"],
        },
      },
    },
    required: ["workout_id", "exercises"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = String(args.workout_id);
    const r = await fetchOwnedActiveWorkout(id, ctx.userId);
    if ("error" in r) return { ok: false, error: r.error ?? "Ошибка" };
    const w = r.workout;
    if (w.type !== "gym") {
      return { ok: false, error: `Тренировка id=${id} не gym (type=${w.type})` };
    }

    const rawExercises = Array.isArray(args.exercises) ? args.exercises : [];
    const rows = rawExercises
      .map((e) => {
        if (!e || typeof e !== "object") return null;
        const obj = e as Record<string, unknown>;
        const name = typeof obj.name === "string" ? obj.name.trim() : "";
        const sets = parseSets(obj.sets);
        if (!name || sets.length === 0) return null;
        return { name, sets, tonnage: exerciseTonnage(sets) };
      })
      .filter((x): x is { name: string; sets: GymSet[]; tonnage: number } => x != null)
      .map((r, order_index) => ({ ...r, order_index }));

    if (rows.length === 0) {
      return { ok: false, error: "Пустой список упражнений — используй delete_workout если хочешь убрать тренировку целиком." };
    }

    // 1. удаляем старые упражнения этой тренировки
    const { error: delErr } = await supabase
      .from("gym_exercises")
      .delete()
      .eq("workout_id", id);
    if (delErr) return { ok: false, error: `Не удалось удалить старые упражнения: ${delErr.message}` };

    // 2. вставляем новые
    const inserts = rows.map((r) => ({
      workout_id: id,
      exercise_name: r.name,
      order_index: r.order_index,
      sets: r.sets,
      tonnage: Math.round(r.tonnage * 10) / 10,
    }));
    const { error: insErr } = await supabase.from("gym_exercises").insert(inserts);
    if (insErr) return { ok: false, error: `Не удалось вставить новые упражнения: ${insErr.message}` };

    // 3. пересчитываем агрегаты
    const summaries = rows.map((r) => ({ sets: r.sets }));
    const total = totalTonnage(summaries);
    let calories: number | null = null;
    let bw: number | null = w.body_weight ?? null;
    if (!bw) {
      const prof = await loadUserProfile(ctx.userId);
      if (!("error" in prof)) bw = prof.data?.weight ?? null;
    }
    if (bw && bw > 0) {
      const est = estimateGymCalories({
        bodyWeightKg: bw,
        exercises: summaries,
        durationMinOverride: null,
      });
      if (est) calories = est.calories;
    }

    const { error: wErr } = await supabase
      .from("workouts")
      .update({
        total_tonnage: Math.round(total * 10) / 10,
        calories_estimated: calories,
      })
      .eq("id", id);
    if (wErr) return { ok: false, error: `Не удалось обновить тренировку: ${wErr.message}` };

    return {
      ok: true,
      data: {
        updated: true,
        workout_id: id,
        new_total_tonnage: Math.round(total * 10) / 10,
        new_calories_estimated: calories,
        exercises_count: rows.length,
      },
    };
  },
};

// ───────────────────────────── UPDATE swim series ───────────────────────────

export const updateSwimSeriesTool: AgentTool = {
  name: "update_swim_series",
  description: [
    "ПОЛНАЯ замена серий плавательной тренировки. Старые `swim_series` удаляются, вставляются новые.",
    "",
    "ВАЖНО: перед апдейтом — get_workout_details(id), покажи diff, получи подтверждение.",
    "Автоматически пересчитывается `workouts.total_distance` = sum(distance).",
    "",
    "Кейсы:",
    "— «вторая серия была 8×50, не 8×100»,",
    "— «забыл добавить разминку — 200 метров вначале»,",
    "— «удали последнюю серию».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      workout_id: { type: "string" },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            distance: { type: "number" },
            description: { type: "string" },
          },
          required: ["distance", "description"],
        },
      },
    },
    required: ["workout_id", "series"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = String(args.workout_id);
    const r = await fetchOwnedActiveWorkout(id, ctx.userId);
    if ("error" in r) return { ok: false, error: r.error ?? "Ошибка" };
    const w = r.workout;
    if (w.type !== "swim") {
      return { ok: false, error: `Тренировка id=${id} не swim (type=${w.type})` };
    }

    const rawSeries = Array.isArray(args.series) ? args.series : [];
    const rows = rawSeries
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const o = s as Record<string, unknown>;
        const distance = Number(o.distance);
        const description = typeof o.description === "string" ? o.description.trim() : "";
        if (!Number.isFinite(distance) || distance <= 0) return null;
        return { distance, description };
      })
      .filter((x): x is { distance: number; description: string } => x != null)
      .map((s, order_index) => ({ ...s, order_index }));

    if (rows.length === 0) {
      return { ok: false, error: "Пустой список серий — используй delete_workout если хочешь убрать тренировку целиком." };
    }

    const { error: delErr } = await supabase
      .from("swim_series")
      .delete()
      .eq("workout_id", id);
    if (delErr) return { ok: false, error: `Не удалось удалить старые серии: ${delErr.message}` };

    const inserts = rows.map((r) => ({
      workout_id: id,
      order_index: r.order_index,
      distance: r.distance,
      description: r.description,
    }));
    const { error: insErr } = await supabase.from("swim_series").insert(inserts);
    if (insErr) return { ok: false, error: `Не удалось вставить серии: ${insErr.message}` };

    const totalDistance = rows.reduce((a, r) => a + r.distance, 0);
    const { error: wErr } = await supabase
      .from("workouts")
      .update({ total_distance: totalDistance })
      .eq("id", id);
    if (wErr) return { ok: false, error: `Не удалось обновить тренировку: ${wErr.message}` };

    return {
      ok: true,
      data: {
        updated: true,
        workout_id: id,
        new_total_distance: totalDistance,
        series_count: rows.length,
      },
    };
  },
};
