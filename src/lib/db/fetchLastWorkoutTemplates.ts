import { supabase } from "@/lib/db/supabase";
import type { ParsedGymWorkout, ParsedSwimWorkout } from "@/lib/features/workouts/csvImport";
import type { GymSet } from "@/types/database";

export type LastGymFromDb = {
  sourceWorkoutId: string;
  parsed: ParsedGymWorkout;
};

export type LastSwimFromDb = {
  sourceWorkoutId: string;
  parsed: ParsedSwimWorkout;
};

/**
 * Последняя сохранённая силовая (по дате, затем created_at) с подходами из gym_exercises.
 */
export async function fetchLastGymWorkoutFromDb(
  userId: string
): Promise<{ data: LastGymFromDb | null } | { error: string }> {
  const { data: rows, error: wErr } = await supabase
    .from("workouts")
    .select("id, date, body_weight, total_tonnage")
    .eq("user_id", userId)
    .eq("type", "gym")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (wErr) return { error: wErr.message };
  const w = rows?.[0];
  if (!w) return { data: null };

  const { data: exRows, error: eErr } = await supabase
    .from("gym_exercises")
    .select("exercise_name, order_index, sets, tonnage")
    .eq("workout_id", w.id)
    .order("order_index", { ascending: true });

  if (eErr) return { error: eErr.message };
  if (!exRows?.length) return { data: null };

  const exercises = exRows.map((r) => ({
    name: r.exercise_name,
    sets: r.sets as GymSet[],
    tonnage: Number(r.tonnage),
  }));

  const parsed: ParsedGymWorkout = {
    date: w.date,
    bodyWeight: w.body_weight != null ? Number(w.body_weight) : null,
    exercises,
    totalTonnage: w.total_tonnage != null ? Number(w.total_tonnage) : null,
  };

  return { data: { sourceWorkoutId: w.id, parsed } };
}

/**
 * Последнее сохранённое плавание с сериями из swim_series.
 */
export async function fetchLastSwimWorkoutFromDb(
  userId: string
): Promise<{ data: LastSwimFromDb | null } | { error: string }> {
  const { data: rows, error: wErr } = await supabase
    .from("workouts")
    .select("id, date, total_distance")
    .eq("user_id", userId)
    .eq("type", "swim")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (wErr) return { error: wErr.message };
  const w = rows?.[0];
  if (!w) return { data: null };

  const { data: sRows, error: sErr } = await supabase
    .from("swim_series")
    .select("distance, description, order_index")
    .eq("workout_id", w.id)
    .order("order_index", { ascending: true });

  if (sErr) return { error: sErr.message };
  if (!sRows?.length) return { data: null };

  const series = sRows.map((r) => ({
    distance: r.distance,
    description: r.description,
  }));
  const totalDistance =
    w.total_distance != null ? w.total_distance : series.reduce((a, x) => a + x.distance, 0);

  const parsed: ParsedSwimWorkout = {
    date: w.date,
    series,
    totalDistance,
    durationMinutes: null,
  };

  return { data: { sourceWorkoutId: w.id, parsed } };
}
