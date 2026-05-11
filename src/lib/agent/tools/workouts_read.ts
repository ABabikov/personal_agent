/**
 * Tools для чтения тренировок: последняя силовая/плавание, недавние, конкретная тренировка.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import {
  fetchLastGymWorkoutFromDb,
  fetchLastSwimWorkoutFromDb,
} from "@/lib/db/fetchLastWorkoutTemplates";
import {
  fetchRecentWorkouts,
  fetchWorkoutsInDateRange,
  aggregateWeekStats,
  mondaySundayYYYYMMDD,
  type WorkoutRow,
} from "@/lib/db/listWorkouts";
import { supabase } from "@/lib/db/supabase";
import { weekdayIdx, WEEKDAY_RU_LONG } from "@/lib/features/workouts/analytics";
import type { GymSet } from "@/types/database";

export const getLastGymWorkoutTool: AgentTool = {
  name: "get_last_gym_workout",
  description: [
    "Возвращает последнюю по дате силовую тренировку с упражнениями и подходами (вес × повторы).",
    "Полезно когда:",
    "— «как было в прошлый раз?» / «что я делал на последней тренировке?»,",
    "— нужно подготовить шаблон для новой тренировки,",
    "— нужно понять, в каких рабочих весах сейчас атлет.",
    "Возвращает null, если силовых ещё не было.",
  ].join(" "),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const r = await fetchLastGymWorkoutFromDb(ctx.userId);
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: r.data };
  },
};

export const getLastSwimWorkoutTool: AgentTool = {
  name: "get_last_swim_workout",
  description: [
    "Возвращает последнее по дате плавание с сериями (дистанция + текстовое описание стиля/режима).",
    "Полезно когда:",
    "— «как было в плавании последний раз?»,",
    "— нужно скопировать структуру серий,",
    "— нужен общий метраж последнего бассейна.",
    "Возвращает null, если плаваний ещё не было.",
  ].join(" "),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const r = await fetchLastSwimWorkoutFromDb(ctx.userId);
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: r.data };
  },
};

export const getRecentWorkoutsTool: AgentTool = {
  name: "get_recent_workouts",
  description: [
    "Возвращает список последних тренировок (по убыванию даты).",
    "Каждая строка: id, date, type (gym/swim), body_weight, total_tonnage, total_distance, calories_estimated, notes.",
    "Подходит для общего обзора («что было последний месяц?»), без полной детализации подходов.",
    "Чтобы получить подходы конкретной тренировки — вызови get_workout_details(id).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, args.limit)) : 20;
    const r = await fetchRecentWorkouts(ctx.userId, limit);
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: { workouts: r.data, count: r.data.length } };
  },
};

export const getWorkoutsInRangeTool: AgentTool = {
  name: "get_workouts_in_range",
  description: [
    "Тренировки в диапазоне дат [start; end], формат YYYY-MM-DD, включительно с обеих сторон.",
    "Например: get_workouts_in_range({start:'2026-04-01', end:'2026-04-30'}) даст все тренировки апреля.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      start: { type: "string", description: "YYYY-MM-DD" },
      end: { type: "string", description: "YYYY-MM-DD" },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const r = await fetchWorkoutsInDateRange(
      ctx.userId,
      String(args.start),
      String(args.end)
    );
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: { workouts: r.data, count: r.data.length } };
  },
};

export const getCurrentWeekStatsTool: AgentTool = {
  name: "get_current_week_stats",
  description: [
    "Сводка за текущую календарную неделю (Пн–Вс по локальному времени):",
    "число тренировок, суммарный тоннаж (кг), суммарный метраж (м).",
    "Удобно для быстрого отчёта «сколько я уже сделал на этой неделе».",
  ].join(" "),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const { start, end } = mondaySundayYYYYMMDD();
    const r = await fetchWorkoutsInDateRange(ctx.userId, start, end);
    if ("error" in r) return { ok: false, error: r.error };
    const stats = aggregateWeekStats(r.data);
    return { ok: true, data: { weekStart: start, weekEnd: end, ...stats, workouts: r.data } };
  },
};

export const getLastGymWorkoutForWeekdayTool: AgentTool = {
  name: "get_last_gym_workout_for_weekday",
  description: [
    "Последняя силовая тренировка В УКАЗАННЫЙ ДЕНЬ НЕДЕЛИ (0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб).",
    "Возвращает workout + все упражнения с подходами + дату.",
    "",
    "Ключевой кейс: «сгенерируй мне тренировку на следующий [пн/ср/пт]».",
    "Алгоритм:",
    " 1) понять день недели целевой даты (если target_date='2026-05-13' и это среда — weekday=3),",
    " 2) вызвать этот тул с weekday=3 → получить последнюю среду,",
    " 3) для каждого упражнения вызвать suggest_next_gym_sets(sets) → следующая цель,",
    " 4) показать пользователю черновик и попросить подтверждение,",
    " 5) save_gym_workout({date: target_date, exercises: [...]}).",
    "",
    "Возвращает null, если силовых в этот день недели ещё не было.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      weekday: {
        type: "integer",
        minimum: 0,
        maximum: 6,
        description: "0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб",
      },
    },
    required: ["weekday"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const target = Number(args.weekday);
    if (!Number.isInteger(target) || target < 0 || target > 6) {
      return { ok: false, error: "weekday должен быть целым числом 0..6" };
    }
    const { data: workouts, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("type", "gym")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false, error: error.message };
    const match = (workouts ?? []).find(
      (w) => weekdayIdx((w as WorkoutRow).date) === target
    ) as WorkoutRow | undefined;
    if (!match) return { ok: true, data: null };

    const { data: ex, error: eErr } = await supabase
      .from("gym_exercises")
      .select("id, exercise_name, order_index, sets, tonnage")
      .eq("workout_id", match.id)
      .order("order_index", { ascending: true });
    if (eErr) return { ok: false, error: eErr.message };
    return {
      ok: true,
      data: {
        weekday: target,
        weekday_label: WEEKDAY_RU_LONG[target],
        workout: match,
        exercises: (ex ?? []).map((e) => ({
          id: e.id,
          name: e.exercise_name,
          order_index: e.order_index,
          sets: e.sets as GymSet[],
          tonnage: Number(e.tonnage),
        })),
      },
    };
  },
};

export const getWorkoutDetailsTool: AgentTool = {
  name: "get_workout_details",
  description: [
    "Полная карточка тренировки по её id: сам workout + все упражнения с подходами (для gym) или серии (для swim).",
    "Кейсы:",
    "— «расскажи про эту тренировку подробно»,",
    "— разбор «было ли там приседание, и с каким весом».",
    "id берётся из get_recent_workouts / get_workouts_in_range.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "workouts.id (uuid)" } },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = String(args.id);
    const { data: w, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!w) return { ok: false, error: "Тренировка не найдена" };
    const row = w as WorkoutRow;
    if (row.type === "gym") {
      const { data: ex, error: eErr } = await supabase
        .from("gym_exercises")
        .select("id, exercise_name, order_index, sets, tonnage")
        .eq("workout_id", id)
        .order("order_index", { ascending: true });
      if (eErr) return { ok: false, error: eErr.message };
      return {
        ok: true,
        data: {
          workout: row,
          exercises: (ex ?? []).map((e) => ({
            id: e.id,
            name: e.exercise_name,
            order_index: e.order_index,
            sets: e.sets as GymSet[],
            tonnage: Number(e.tonnage),
          })),
        },
      };
    }
    if (row.type === "swim") {
      const { data: sr, error: sErr } = await supabase
        .from("swim_series")
        .select("id, order_index, distance, description")
        .eq("workout_id", id)
        .order("order_index", { ascending: true });
      if (sErr) return { ok: false, error: sErr.message };
      return { ok: true, data: { workout: row, series: sr ?? [] } };
    }
    return { ok: true, data: { workout: row } };
  },
};
