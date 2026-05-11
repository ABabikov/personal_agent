import type { GymSet } from "../../../types/database";

const REPS_THRESHOLD = 18;
const REPS_AFTER_BUMP = 12;

/** Шаг увеличения веса (кг), округление до 0.5 */
export function bumpWorkingWeight(weight: number): number {
  const step = weight <= 12 ? 1 : weight <= 30 ? 1.5 : 2.5;
  const next = weight + step;
  return Math.round(next * 2) / 2;
}

/**
 * Простая прогрессия: +1 повтор на каждый рабочий подход;
 * если максимум повторов ≥ порога — поднять вес на всех подходах и выставить 12 повторов.
 */
export function progressGymSets(sets: GymSet[]): GymSet[] {
  if (sets.length === 0) return [];
  const maxReps = Math.max(...sets.map((s) => s.reps));
  if (maxReps >= REPS_THRESHOLD) {
    return sets.map((s) => ({
      weight: bumpWorkingWeight(s.weight),
      reps: REPS_AFTER_BUMP,
    }));
  }
  return sets.map((s) => ({
    weight: s.weight,
    reps: s.reps + 1,
  }));
}
