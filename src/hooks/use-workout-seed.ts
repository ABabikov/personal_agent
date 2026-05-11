"use client";

import { useEffect, useState } from "react";
import type { WorkoutSeedPayload } from "@/lib/features/workouts/workoutSeedTypes";

export type { GymDayKey, SwimDayKey } from "@/lib/features/workouts/workoutSeedTypes";

export function useWorkoutSeed() {
  const [seed, setSeed] = useState<WorkoutSeedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/workout-seed.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<WorkoutSeedPayload>;
      })
      .then((json) => {
        if (!cancelled) setSeed(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { seed, error, loading };
}
