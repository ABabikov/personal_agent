import type { ParsedSwimWorkout } from "./csvImport";

export type SwimSeriesInput = {
  id: string;
  distance: string;
  description: string;
};

function newId() {
  return Math.random().toString(36).slice(2);
}

export function swimWorkoutToSeriesInputs(
  workout: ParsedSwimWorkout
): SwimSeriesInput[] {
  return workout.series.map((s) => ({
    id: newId(),
    distance: String(s.distance),
    description: s.description,
  }));
}
