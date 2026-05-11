/**
 * Calorie calculation: BMR, TDEE, workout energy expenditure
 */

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
