import type { ParsedSwimWorkout } from "./csvImport";
import type { SwimSeriesInput } from "@/components/workout/swim-series-card";
import { inferBreakdownForSeries } from "@/lib/features/swimming/inferBreakdown";

export type { SwimSeriesInput };

function newId() {
  return Math.random().toString(36).slice(2);
}

export function swimWorkoutToSeriesInputs(
  workout: ParsedSwimWorkout
): SwimSeriesInput[] {
  return workout.series.map((s) => {
    const inferred = inferBreakdownForSeries(s.distance, s.description);
    return {
      id: newId(),
      distance: String(s.distance),
      description: s.description,
      reps: inferred?.reps ?? "",
      perRepM: inferred?.perRepM ?? "",
    };
  });
}
