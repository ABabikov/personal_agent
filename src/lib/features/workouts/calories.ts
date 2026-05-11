/**
 * Calorie calculation: BMR, TDEE, workout energy expenditure
 */

import type { GymSet } from "@/types/database";

type Gender = "male" | "female";

/** Mifflin-St Jeor BMR formula */
export function calculateBMR(
  weight: number,   // kg
  height: number,   // cm
  age: number,
  gender: Gender
): number {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return gender === "male" ? base + 5 : base - 161;
}

/** Katch-McArdle BMR (requires body fat %) */
export function calculateBMRKatchMcArdle(
  weight: number,      // kg
  bodyFatPct: number   // e.g. 15 for 15%
): number {
  const leanMass = weight * (1 - bodyFatPct / 100);
  return 370 + 21.6 * leanMass;
}

/** TDEE = BMR × activity multiplier */
export function calculateTDEE(bmr: number, activityLevel: number): number {
  return bmr * activityLevel;
}

/** MET values by workout type and intensity */
export const MET_VALUES = {
  gym: {
    light: 3.5,
    moderate: 5.0,
    heavy: 5.8,
    circuit: 7.5,
  },
  swim: {
    light: 5.8,       // freestyle moderate
    moderate: 8.0,     // freestyle vigorous
    heavy: 9.8,        // freestyle intense
    breaststroke: 10.3,
    butterfly: 13.8,
  },
} as const;

/** Calories burned per minute using MET method */
export function caloriesPerMinute(met: number, weightKg: number): number {
  return (met * 3.5 * weightKg) / 200;
}

/** Estimate workout calories from duration and MET */
export function estimateWorkoutCalories(
  met: number,
  weightKg: number,
  durationMinutes: number
): number {
  return Math.round(caloriesPerMinute(met, weightKg) * durationMinutes);
}

/** Activity level presets */
export const ACTIVITY_LEVELS = [
  { value: 1.2, label: "Сидячий (мало движения)" },
  { value: 1.375, label: "Лёгкая активность (1-2 дня/нед)" },
  { value: 1.55, label: "Умеренная (3-5 дней/нед)" },
  { value: 1.725, label: "Высокая (6-7 дней/нед)" },
  { value: 1.9, label: "Атлет (2 тренировки/день)" },
] as const;

// ----- Gym workout calorie estimation -----

export type GymIntensity = "light" | "moderate" | "heavy" | "circuit";

export const GYM_INTENSITY_LABEL_RU: Record<GymIntensity, string> = {
  light: "лёгкая",
  moderate: "гипертрофия",
  heavy: "тяжёлая",
  circuit: "круговая",
};

/**
 * Минут на один рабочий подход — калибровка под фактический темп пользователя:
 * 30–45 мин на пару из 2-х упражнений по ~4 подхода → ~37.5 мин / 8 подходов ≈ 4.5 мин/подход.
 * Сюда входит и работа, и отдых внутри подхода.
 */
export const GYM_MINUTES_PER_SET = 4.5;

/** EPOC надбавка к чистому MET-расчёту (afterburn для силовых) */
export const GYM_EPOC_MULTIPLIER = 1.07;

/** Пороги «плотности работы» (кг тоннажа в минуту, нормализовано к весу тела 80 кг) → MET */
export const GYM_DENSITY_THRESHOLDS = [
  { max: 80, intensity: "light" as const, met: MET_VALUES.gym.light },
  { max: 150, intensity: "moderate" as const, met: MET_VALUES.gym.moderate },
  { max: 250, intensity: "heavy" as const, met: MET_VALUES.gym.heavy },
  { max: Infinity, intensity: "circuit" as const, met: MET_VALUES.gym.circuit },
];

export interface GymCalorieInput {
  /** Кг — приоритет: вес тела на день тренировки, иначе из профиля */
  bodyWeightKg: number;
  /** Подходы каждого упражнения (только валидные: weight>0, reps>0) */
  exercises: { sets: GymSet[] }[];
  /** Опциональная ручная длительность тренировки, мин (перебивает авто-оценку) */
  durationMinOverride?: number | null;
}

export interface GymCalorieEstimate {
  /** Округлённое значение, ккал (с учётом EPOC) */
  calories: number;
  /** Без EPOC, для прозрачности */
  caloriesRaw: number;
  /** Использованная длительность, мин */
  durationMin: number;
  /** Был ли override */
  durationFromOverride: boolean;
  /** Авто-категория интенсивности и соответствующий MET */
  intensity: GymIntensity;
  met: number;
  /** Кг тоннажа в минуту (нормализовано к весу 80 кг) — для отладки/UI */
  density: number;
  /** Альтернативная оценка по тоннажу — для валидации */
  tonnageBasedCalories: number;
  /** Сумма (вес × повт) использованная в расчёте */
  tonnage: number;
  /** Сколько валидных подходов учтено */
  setCount: number;
}

/** Авто-оценка длительности тренировки по количеству валидных подходов */
export function estimateGymDuration(setCount: number): number {
  return setCount * GYM_MINUTES_PER_SET;
}

/** Авто-классификация интенсивности по плотности работы (тоннаж/время) */
export function classifyGymIntensity(
  tonnageKg: number,
  durationMin: number,
  bodyWeightKg: number
): { intensity: GymIntensity; met: number; density: number } {
  const safeDuration = Math.max(1, durationMin);
  const safeWeight = Math.max(1, bodyWeightKg);
  const density = (tonnageKg / safeDuration) * (80 / safeWeight);
  for (const t of GYM_DENSITY_THRESHOLDS) {
    if (density < t.max) {
      return { intensity: t.intensity, met: t.met, density };
    }
  }
  const last = GYM_DENSITY_THRESHOLDS[GYM_DENSITY_THRESHOLDS.length - 1];
  return { intensity: last.intensity, met: last.met, density };
}

/**
 * Оценка калорий на силовую тренировку.
 *
 * Алгоритм:
 *   1. Считаем общий тоннаж (Σ weight × reps по валидным подходам).
 *   2. Длительность: ручной override → иначе авто `setCount × 4.5 мин`.
 *   3. Плотность работы → категория MET (light/moderate/heavy/circuit).
 *   4. kcal_base = (MET × 3.5 × bodyWeightKg / 200) × durationMin
 *   5. kcal = kcal_base × 1.07 (EPOC).
 *   6. Параллельно — kcal_tonnage = 0.09 × tonnage × (W/80) для перекрёстной валидации.
 *
 * Источники формул и калибровки — см. docs/features/workout-tracker/logic.md, раздел «Методика расчёта калорий».
 */
export function estimateGymCalories(input: GymCalorieInput): GymCalorieEstimate | null {
  if (!Number.isFinite(input.bodyWeightKg) || input.bodyWeightKg <= 0) return null;

  const validSets = input.exercises.flatMap((e) =>
    e.sets.filter((s) => s.weight > 0 && s.reps > 0)
  );
  const setCount = validSets.length;
  if (setCount === 0) return null;

  const tonnage = validSets.reduce((sum, s) => sum + s.weight * s.reps, 0);

  const durationFromOverride =
    input.durationMinOverride != null && input.durationMinOverride > 0;
  const durationMin = durationFromOverride
    ? input.durationMinOverride!
    : estimateGymDuration(setCount);

  const { intensity, met, density } = classifyGymIntensity(
    tonnage,
    durationMin,
    input.bodyWeightKg
  );

  const caloriesRaw = caloriesPerMinute(met, input.bodyWeightKg) * durationMin;
  const calories = Math.round(caloriesRaw * GYM_EPOC_MULTIPLIER);

  const tonnageBasedCalories = Math.round(
    0.09 * tonnage * (input.bodyWeightKg / 80)
  );

  return {
    calories,
    caloriesRaw: Math.round(caloriesRaw),
    durationMin: Math.round(durationMin),
    durationFromOverride,
    intensity,
    met,
    density: Math.round(density),
    tonnageBasedCalories,
    tonnage: Math.round(tonnage * 10) / 10,
    setCount,
  };
}
