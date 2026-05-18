import { supabase } from "@/lib/db/supabase";
import type { ParsedGymWorkout, ParsedSwimWorkout } from "@/lib/features/workouts/csvImport";
import type { WeekdayIdx } from "@/lib/features/workouts/analytics";
import { weekdayIdx } from "@/lib/features/workouts/analytics";
import type { GymSet } from "@/types/database";

export type LastGymFromDb = {
  sourceWorkoutId: string;
  parsed: ParsedGymWorkout;
};

export type LastSwimFromDb = {
  sourceWorkoutId: string;
  parsed: ParsedSwimWorkout;
};

async function gymHeadRowToLastGym(
  w: {
    id: string;
    date: string;
    body_weight: unknown;
    total_tonnage: unknown;
  }
): Promise<{ data: LastGymFromDb } | { error: string }> {
  const { data: exRows, error: eErr } = await supabase
    .from("gym_exercises")
    .select("exercise_name, order_index, sets, tonnage")
    .eq("workout_id", w.id)
    .order("order_index", { ascending: true });

  if (eErr) return { error: eErr.message };
  if (!exRows?.length) return { error: "Нет упражнений" };

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
    .is("deleted_at", null)
    .eq("status", "completed")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (wErr) return { error: wErr.message };
  const w = rows?.[0];
  if (!w) return { data: null };

  const built = await gymHeadRowToLastGym(w);
  if ("error" in built) return { data: null };
  return built;
}

/**
 * Последняя силовая в указанный день недели (локальный календарь, 0=вс..6=сб),
 * по убыванию даты. Без fallback на другие дни.
 */
export async function fetchLastGymWorkoutForWeekdayFromDb(
  userId: string,
  weekday: WeekdayIdx
): Promise<{ data: LastGymFromDb | null } | { error: string }> {
  const { data: rows, error: wErr } = await supabase
    .from("workouts")
    .select("id, date, body_weight, total_tonnage")
    .eq("user_id", userId)
    .eq("type", "gym")
    .is("deleted_at", null)
    .eq("status", "completed")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (wErr) return { error: wErr.message };
  const w = (rows ?? []).find((row) => weekdayIdx(row.date) === weekday);
  if (!w) return { data: null };

  const built = await gymHeadRowToLastGym(w);
  if ("error" in built) return { data: null };
  return built;
}

/**
 * Шаблон автозаполнения силовой для даты `YYYY-MM-DD`: сначала последняя тренировка
 * в тот же день недели, иначе — просто последняя силовая (как раньше).
 */
export async function fetchGymAutofillTemplateFromDb(
  userId: string,
  dateIso: string
): Promise<{ data: LastGymFromDb | null } | { error: string }> {
  const wd = weekdayIdx(dateIso);
  const forDay = await fetchLastGymWorkoutForWeekdayFromDb(userId, wd);
  if ("error" in forDay) return forDay;
  if (forDay.data) return forDay;
  return fetchLastGymWorkoutFromDb(userId);
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
    .is("deleted_at", null)
    .eq("status", "completed")
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

export type SwimHistoryListItem = {
  workoutId: string;
  parsed: ParsedSwimWorkout;
};

/**
 * Последние плавания с сериями (для выбора из истории).
 */
export async function fetchSwimWorkoutsHistoryFromDb(
  userId: string,
  limit = 30
): Promise<{ data: SwimHistoryListItem[] } | { error: string }> {
  const { data: rows, error: wErr } = await supabase
    .from("workouts")
    .select("id, date, total_distance")
    .eq("user_id", userId)
    .eq("type", "swim")
    .is("deleted_at", null)
    .eq("status", "completed")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (wErr) return { error: wErr.message };
  const heads = rows ?? [];
  if (heads.length === 0) return { data: [] };

  const ids = heads.map((h) => h.id);
  const { data: sRows, error: sErr } = await supabase
    .from("swim_series")
    .select("workout_id, distance, description, order_index")
    .in("workout_id", ids)
    .order("order_index", { ascending: true });

  if (sErr) return { error: sErr.message };

  const byWorkout = new Map<
    string,
    { distance: number; description: string }[]
  >();
  for (const r of sRows ?? []) {
    const wid = r.workout_id as string;
    const list = byWorkout.get(wid) ?? [];
    list.push({
      distance: r.distance as number,
      description: r.description ?? "",
    });
    byWorkout.set(wid, list);
  }

  const out: SwimHistoryListItem[] = [];
  for (const h of heads) {
    const series = byWorkout.get(h.id);
    if (!series?.length) continue;
    const totalDistance =
      h.total_distance != null
        ? Number(h.total_distance)
        : series.reduce((a, x) => a + x.distance, 0);
    out.push({
      workoutId: h.id,
      parsed: {
        date: h.date,
        series,
        totalDistance,
        durationMinutes: null,
      },
    });
  }

  return { data: out };
}
