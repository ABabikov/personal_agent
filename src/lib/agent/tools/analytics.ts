/**
 * Аналитика: периодные суммы, динамика упражнения, тоннаж по дням недели, список упражнений.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import { fetchPeriodData, type PeriodScope } from "@/lib/db/calendarData";
import {
  exerciseDynamics,
  periodTotals,
  tonnageByWeekday,
  uniqueExerciseNames,
} from "@/lib/features/workouts/analytics";

function parseScopeArgs(args: Record<string, unknown>): {
  scope: PeriodScope;
  year?: number;
  monthIdx0?: number;
} {
  const scope = (args.scope === "year" || args.scope === "all" ? args.scope : "month") as PeriodScope;
  const year = typeof args.year === "number" ? args.year : undefined;
  const month = typeof args.month === "number" ? args.month : undefined; // 1..12 (human)
  const monthIdx0 = month != null ? Math.max(0, Math.min(11, month - 1)) : undefined;
  return { scope, year, monthIdx0 };
}

export const getPeriodStatsTool: AgentTool = {
  name: "get_period_stats",
  description: [
    "Сводная статистика за период: число тренировок (всего / зал / плав), суммарный тоннаж (кг),",
    "суммарный метраж (м), суммарные калории (ккал).",
    "",
    "Параметр scope:",
    "— 'month' (по умолчанию) + year + month(1..12): конкретный месяц,",
    "— 'year' + year: за год,",
    "— 'all': вся история.",
    "Если year/month не переданы — берётся текущий месяц/год.",
    "",
    "Кейсы: «итоги мая», «сколько я наплавал в этом году», «всего за всё время».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["month", "year", "all"], default: "month" },
      year: { type: "integer", description: "Если не задан — текущий" },
      month: { type: "integer", minimum: 1, maximum: 12, description: "1=Январь, 12=Декабрь" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const { scope, year, monthIdx0 } = parseScopeArgs(args);
    const r = await fetchPeriodData(ctx.userId, scope, { year, monthIdx0 });
    if ("error" in r) return { ok: false, error: r.error };
    const totals = periodTotals(r.data);
    return {
      ok: true,
      data: {
        scope,
        year: year ?? null,
        month: monthIdx0 != null ? monthIdx0 + 1 : null,
        ...totals,
      },
    };
  },
};

export const listExercisesTool: AgentTool = {
  name: "list_exercises",
  description: [
    "Список уникальных названий упражнений (зал) за период, отсортированный по частоте — самые",
    "частые сверху. Полезно, когда пользователь спрашивает «какие упражнения я делал», и для подбора",
    "имени для get_exercise_dynamics.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["month", "year", "all"], default: "all" },
      year: { type: "integer" },
      month: { type: "integer", minimum: 1, maximum: 12 },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const { scope, year, monthIdx0 } = parseScopeArgs({ scope: args.scope ?? "all", ...args });
    const r = await fetchPeriodData(ctx.userId, scope, { year, monthIdx0 });
    if ("error" in r) return { ok: false, error: r.error };
    const names = uniqueExerciseNames(r.data.gymExercises);
    return { ok: true, data: { exercises: names, count: names.length, scope } };
  },
};

export const getExerciseDynamicsTool: AgentTool = {
  name: "get_exercise_dynamics",
  description: [
    "Динамика конкретного упражнения по тренировкам периода:",
    "— tonnage: сумма (weight×reps) по подходам этого упражнения в каждой тренировке,",
    "— weight:  максимальный рабочий вес (среди подходов с reps≥1) на каждой тренировке.",
    "Каждая точка — {date, value}.",
    "",
    "Кейсы: «как растёт мой жим лёжа», «динамика приседаний за последний год».",
    "Имя упражнения должно совпадать с тем, как оно записано (используй list_exercises чтобы найти).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      exercise_name: { type: "string", description: "Точное имя упражнения (case-sensitive)" },
      scope: { type: "string", enum: ["month", "year", "all"], default: "all" },
      year: { type: "integer" },
      month: { type: "integer", minimum: 1, maximum: 12 },
    },
    required: ["exercise_name"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const name = String(args.exercise_name);
    const { scope, year, monthIdx0 } = parseScopeArgs({ scope: args.scope ?? "all", ...args });
    const r = await fetchPeriodData(ctx.userId, scope, { year, monthIdx0 });
    if ("error" in r) return { ok: false, error: r.error };
    const dyn = exerciseDynamics(name, r.data.gymExercises, r.data.workouts);
    return {
      ok: true,
      data: {
        exercise_name: name,
        scope,
        points: dyn.tonnage.length,
        tonnage: dyn.tonnage,
        weight: dyn.weight,
      },
    };
  },
};

export const getTonnageByWeekdayTool: AgentTool = {
  name: "get_tonnage_by_weekday",
  description: [
    "Тоннаж силовых тренировок, сгруппированный по дням недели (понедельник / среда / пятница и т. п.).",
    "Возвращает по серии на каждый день недели: weekday (0=вс..6=сб), label, points[{date, value}].",
    "Кейсы: «как меняется мой пнёвый тоннаж», сравнение тренировок разных дней цикла.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["month", "year", "all"], default: "all" },
      year: { type: "integer" },
      month: { type: "integer", minimum: 1, maximum: 12 },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const { scope, year, monthIdx0 } = parseScopeArgs({ scope: args.scope ?? "all", ...args });
    const r = await fetchPeriodData(ctx.userId, scope, { year, monthIdx0 });
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: { scope, series: tonnageByWeekday(r.data.workouts) } };
  },
};
