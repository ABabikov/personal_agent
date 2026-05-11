/**
 * Tools для записи тренировок (зал/плавание) и подсказок по прогрессии.
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import {
  saveGymWorkoutToSupabase,
  saveSwimWorkoutToSupabase,
  type GymExerciseForm,
  type SwimSeriesForm,
} from "@/lib/db/saveWorkout";
import { loadUserProfile } from "@/lib/db/profile";
import { progressGymSets } from "@/lib/features/workouts/gymProgression";
import {
  estimateGymCalories,
  GYM_INTENSITY_LABEL_RU,
} from "@/lib/features/workouts/calories";
import type { GymSet } from "@/types/database";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseSets(raw: unknown): GymSet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const obj = s as Record<string, unknown>;
      const weight = Number(obj.weight);
      const reps = Number(obj.reps);
      if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
      return { weight, reps };
    })
    .filter((x): x is GymSet => x != null);
}

export const saveGymWorkoutTool: AgentTool = {
  name: "save_gym_workout",
  description: [
    "Сохраняет силовую тренировку в БД. Тренировка = список упражнений, у каждого — массив подходов (вес кг × повторы).",
    "Калории посчитаются автоматически (MET + EPOC 7% + авто-длительность 4.5 мин/подход или явный duration_min).",
    "",
    "ВАЖНО (UX): сначала покажи пользователю предполагаемое содержание тренировки и попроси",
    "подтверждение, прежде чем вызывать этот тул. Это запись в БД — её потом нужно вручную править.",
    "",
    "Кейсы:",
    "— пользователь продиктовал тренировку голосом / текстом,",
    "— скопировать «как было» (get_last_gym_workout → дополнить → save_gym_workout),",
    "— занести задним числом (укажи date).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD, по умолчанию сегодня" },
      body_weight: { type: "number", description: "Вес тела в день тренировки (кг)" },
      notes: { type: "string" },
      duration_min: {
        type: "number",
        description: "Опционально: длительность в минутах. Если не задана — оценка авто.",
      },
      exercises: {
        type: "array",
        description: "Упражнения по порядку, минимум 1.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            sets: {
              type: "array",
              description: "Подходы (только валидные: weight>0, reps>0)",
              items: {
                type: "object",
                properties: {
                  weight: { type: "number" },
                  reps: { type: "integer" },
                },
                required: ["weight", "reps"],
              },
            },
          },
          required: ["name", "sets"],
        },
      },
    },
    required: ["exercises"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const date = typeof args.date === "string" && args.date ? args.date : todayLocal();
    const bodyWeight =
      typeof args.body_weight === "number" && args.body_weight > 0 ? args.body_weight : null;
    const notes = typeof args.notes === "string" ? args.notes : "";
    const duration = typeof args.duration_min === "number" ? args.duration_min : null;

    const rawExercises = Array.isArray(args.exercises) ? args.exercises : [];
    const exercises: GymExerciseForm[] = rawExercises
      .map((e) => {
        if (!e || typeof e !== "object") return null;
        const obj = e as Record<string, unknown>;
        const name = typeof obj.name === "string" ? obj.name.trim() : "";
        const sets = parseSets(obj.sets);
        if (!name || sets.length === 0) return null;
        return { name, sets };
      })
      .filter((x): x is GymExerciseForm => x != null);

    if (exercises.length === 0) {
      return { ok: false, error: "Нужно хотя бы одно упражнение с валидными подходами." };
    }

    let profileWeightKg: number | null = null;
    if (bodyWeight == null) {
      const prof = await loadUserProfile(ctx.userId);
      if (!("error" in prof)) profileWeightKg = prof.data?.weight ?? null;
    }

    const r = await saveGymWorkoutToSupabase({
      date,
      bodyWeightStr: bodyWeight != null ? String(bodyWeight) : "",
      exercises,
      notes,
      profileWeightKg,
      durationMinOverride: duration,
    });
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: { saved: true, date, exercises: exercises.length } };
  },
};

export const saveSwimWorkoutTool: AgentTool = {
  name: "save_swim_workout",
  description: [
    "Сохраняет тренировку плавания: набор серий, каждая = дистанция (м) + текстовое описание стиля/режима.",
    "ВАЖНО: подтверждай намерение у пользователя перед записью.",
    "",
    "Кейсы: «запиши, что я сегодня плавал 200 кроль разминка, 8×100 кролем по 1.40, 200 заминка».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD, по умолчанию сегодня" },
      notes: { type: "string" },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            distance: { type: "number", description: "Дистанция серии в метрах" },
            description: {
              type: "string",
              description: "Стиль/режим/комментарий: '4×50 кроль через 1.10', 'разминка спина' и т. п.",
            },
          },
          required: ["distance", "description"],
        },
      },
    },
    required: ["series"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    void ctx;
    const date = typeof args.date === "string" && args.date ? args.date : todayLocal();
    const notes = typeof args.notes === "string" ? args.notes : "";

    const rawSeries = Array.isArray(args.series) ? args.series : [];
    const series: SwimSeriesForm[] = rawSeries
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const obj = s as Record<string, unknown>;
        const distance = Number(obj.distance);
        const description = typeof obj.description === "string" ? obj.description.trim() : "";
        if (!Number.isFinite(distance) || distance <= 0) return null;
        return { distance, description };
      })
      .filter((x): x is SwimSeriesForm => x != null);

    if (series.length === 0) {
      return { ok: false, error: "Нужна хотя бы одна серия с дистанцией > 0." };
    }

    const r = await saveSwimWorkoutToSupabase({ date, series, notes });
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, data: { saved: true, date, series: series.length } };
  },
};

export const suggestNextGymSetsTool: AgentTool = {
  name: "suggest_next_gym_sets",
  description: [
    "Подсказка по прогрессии: на основе массива подходов возвращает целевые подходы для следующей тренировки.",
    "Правило: +1 повтор ко всем подходам; если максимум повторов ≥ 18 — поднять вес и сбросить повторы до 12.",
    "Шаг веса: ≤12 кг → +1, ≤30 → +1.5, иначе +2.5. Округление до 0.5 кг.",
    "",
    "Кейсы: «как мне работать в следующий раз?», «что взять для приседаний?».",
    "Часто вызывается после get_last_gym_workout: передаёшь подходы оттуда → получаешь следующую цель.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      sets: {
        type: "array",
        items: {
          type: "object",
          properties: { weight: { type: "number" }, reps: { type: "integer" } },
          required: ["weight", "reps"],
        },
      },
    },
    required: ["sets"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const sets = parseSets(args.sets);
    if (sets.length === 0) return { ok: false, error: "Пустой массив sets" };
    return { ok: true, data: { next: progressGymSets(sets) } };
  },
};

export const estimateGymCaloriesTool: AgentTool = {
  name: "estimate_gym_calories",
  description: [
    "What-if оценка калорий для гипотетической силовой (без записи в БД).",
    "На входе массив упражнений с подходами и вес тела. Возвращает калории (с EPOC),",
    "длительность (авто или override), категорию интенсивности, плотность работы, тоннаж.",
    "Если body_weight не передан — пробует достать из профиля.",
    "",
    "Кейсы: «сколько примерно я сожгу, если сделаю N×… ?», превью перед save_gym_workout.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      body_weight: { type: "number" },
      duration_min: { type: "number" },
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
          required: ["sets"],
        },
      },
    },
    required: ["exercises"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    let bodyWeight = typeof args.body_weight === "number" ? args.body_weight : null;
    if (bodyWeight == null) {
      const prof = await loadUserProfile(ctx.userId);
      if (!("error" in prof)) bodyWeight = prof.data?.weight ?? null;
    }
    if (!bodyWeight || bodyWeight <= 0) {
      return {
        ok: false,
        error: "Не знаю вес тела (нет в профиле и не передан в body_weight).",
      };
    }
    const rawExercises = Array.isArray(args.exercises) ? args.exercises : [];
    const exercises = rawExercises.map((e) => ({
      sets: parseSets((e as Record<string, unknown>)?.sets),
    }));
    const duration = typeof args.duration_min === "number" ? args.duration_min : null;
    const est = estimateGymCalories({
      bodyWeightKg: bodyWeight,
      exercises,
      durationMinOverride: duration,
    });
    if (!est) {
      return { ok: false, error: "Не удалось оценить: проверь подходы (нужны weight>0, reps>0)." };
    }
    return {
      ok: true,
      data: {
        ...est,
        intensity_ru: GYM_INTENSITY_LABEL_RU[est.intensity],
        bodyWeightKg: bodyWeight,
      },
    };
  },
};
