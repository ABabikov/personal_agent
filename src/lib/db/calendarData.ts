import { supabase } from "@/lib/db/supabase";
import type { WorkoutRow } from "@/lib/db/listWorkouts";
import type { GymSet } from "@/types/database";

export type GymExerciseRow = {
  id: string;
  workout_id: string;
  exercise_name: string;
  order_index: number;
  sets: GymSet[];
  tonnage: number;
};

export type SwimSeriesRow = {
  id: string;
  workout_id: string;
  order_index: number;
  distance: number;
  description: string;
};

export type PeriodData = {
  workouts: WorkoutRow[];
  gymExercises: GymExerciseRow[];
  swimSeries: SwimSeriesRow[];
};

export type PeriodScope = "month" | "year" | "all";

/** Первое и последнее число месяца в формате YYYY-MM-DD */
export function monthBounds(year: number, monthIdx0: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(monthIdx0 + 1)}-01`;
  const lastDay = new Date(year, monthIdx0 + 1, 0).getDate();
  const end = `${year}-${pad(monthIdx0 + 1)}-${pad(lastDay)}`;
  return { start, end };
}

/** Январь — декабрь указанного года */
export function yearBounds(year: number) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/**
 * Загружает workouts за период + связанные gym_exercises / swim_series.
 * Для scope = "all" фильтра по дате нет.
 */
export async function fetchPeriodData(
  userId: string,
  scope: PeriodScope,
  options: { year?: number; monthIdx0?: number } = {}
): Promise<{ data: PeriodData } | { error: string }> {
  let query = supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "completed");

  if (scope === "month") {
    const year = options.year ?? new Date().getFullYear();
    const monthIdx0 = options.monthIdx0 ?? new Date().getMonth();
    const { start, end } = monthBounds(year, monthIdx0);
    query = query.gte("date", start).lte("date", end);
  } else if (scope === "year") {
    const year = options.year ?? new Date().getFullYear();
    const { start, end } = yearBounds(year);
    query = query.gte("date", start).lte("date", end);
  }

  const { data: workouts, error: wErr } = await query
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  if (wErr) return { error: wErr.message };
  const rows = (workouts ?? []) as WorkoutRow[];
  if (rows.length === 0) {
    return { data: { workouts: [], gymExercises: [], swimSeries: [] } };
  }

  const workoutIds = rows.map((w) => w.id);

  const [exRes, srRes] = await Promise.all([
    supabase
      .from("gym_exercises")
      .select("id, workout_id, exercise_name, order_index, sets, tonnage")
      .in("workout_id", workoutIds)
      .order("workout_id", { ascending: true })
      .order("order_index", { ascending: true }),
    supabase
      .from("swim_series")
      .select("id, workout_id, order_index, distance, description")
      .in("workout_id", workoutIds)
      .order("workout_id", { ascending: true })
      .order("order_index", { ascending: true }),
  ]);

  if (exRes.error) return { error: exRes.error.message };
  if (srRes.error) return { error: srRes.error.message };

  const gymExercises: GymExerciseRow[] = (exRes.data ?? []).map((r) => ({
    id: r.id,
    workout_id: r.workout_id,
    exercise_name: r.exercise_name,
    order_index: r.order_index,
    sets: r.sets as GymSet[],
    tonnage: Number(r.tonnage),
  }));

  const swimSeries: SwimSeriesRow[] = (srRes.data ?? []).map((r) => ({
    id: r.id,
    workout_id: r.workout_id,
    order_index: r.order_index,
    distance: r.distance,
    description: r.description,
  }));

  return { data: { workouts: rows, gymExercises, swimSeries } };
}
