import type { GymSet } from "@/types/database";

/** Calculate tonnage for a single exercise */
export function exerciseTonnage(sets: GymSet[]): number {
  return sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
}

/** Calculate total tonnage for all exercises */
export function totalTonnage(exercises: { sets: GymSet[] }[]): number {
  return exercises.reduce((sum, ex) => sum + exerciseTonnage(ex.sets), 0);
}
