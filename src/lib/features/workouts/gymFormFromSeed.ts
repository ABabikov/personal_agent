import type { ParsedGymWorkout } from "./csvImport";
import { progressGymSets } from "./gymProgression";
import type { GymSet } from "@/types/database";

export type SetInput = { weight: string; reps: string };
export type ExerciseInput = { id: string; name: string; sets: SetInput[] };

function newId() {
  return Math.random().toString(36).slice(2);
}

function formatWeight(w: number): string {
  if (Number.isInteger(w)) return String(w);
  const rounded = Math.round(w * 10) / 10;
  return String(rounded);
}

function setsToInputs(sets: GymSet[]): SetInput[] {
  return sets.map((s) => ({
    weight: formatWeight(s.weight),
    reps: String(s.reps),
  }));
}

export function gymWorkoutToExerciseInputs(
  workout: ParsedGymWorkout,
  applyProgression: boolean
): ExerciseInput[] {
  return workout.exercises.map((ex) => {
    const nextSets = applyProgression ? progressGymSets(ex.sets) : ex.sets;
    return {
      id: newId(),
      name: ex.name,
      sets: setsToInputs(nextSets),
    };
  });
}
