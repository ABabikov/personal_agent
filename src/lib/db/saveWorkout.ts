import { supabase } from "@/lib/db/supabase";
import { exerciseTonnage, totalTonnage } from "@/lib/features/workouts/tonnage";
import type { GymSet } from "@/types/database";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";

export type GymExerciseForm = {
  name: string;
  sets: GymSet[];
};

export type SwimSeriesForm = {
  distance: number;
  description: string;
};

function parseBodyWeight(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function saveGymWorkoutToSupabase(params: {
  date: string;
  bodyWeightStr: string;
  exercises: GymExerciseForm[];
  notes: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getWorkoutUserId();
  if ("error" in user) return user;

  const rows = params.exercises
    .map((ex) => {
      const name = ex.name.trim();
      const sets = ex.sets.filter((s) => s.weight > 0 && s.reps > 0);
      if (!name || sets.length === 0) return null;
      return {
        exercise_name: name,
        sets,
        tonnage: exerciseTonnage(sets),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r, order_index) => ({ ...r, order_index }));

  if (rows.length === 0) {
    return { error: "Добавь хотя бы одно упражнение с названием и подходами (вес × повторы)." };
  }

  const summaries = rows.map((r) => ({ sets: r.sets }));
  const total = totalTonnage(summaries);
  const body_weight = parseBodyWeight(params.bodyWeightStr);
  const notesTrim = params.notes.trim();

  const { data: workout, error: wErr } = await supabase
    .from("workouts")
    .insert({
      user_id: user.userId,
      date: params.date,
      type: "gym",
      body_weight,
      total_tonnage: Math.round(total * 10) / 10,
      total_distance: null,
      calories_estimated: null,
      notes: notesTrim || null,
    })
    .select("id")
    .single();

  if (wErr || !workout) {
    return { error: wErr?.message ?? "Не удалось сохранить тренировку." };
  }

  const gymRows = rows.map((r) => ({
    workout_id: workout.id,
    exercise_name: r.exercise_name,
    order_index: r.order_index,
    sets: r.sets,
    tonnage: Math.round(r.tonnage * 10) / 10,
  }));

  const { error: gErr } = await supabase.from("gym_exercises").insert(gymRows);

  if (gErr) {
    await supabase.from("workouts").delete().eq("id", workout.id);
    return { error: gErr.message };
  }

  return { ok: true };
}

export async function saveSwimWorkoutToSupabase(params: {
  date: string;
  series: SwimSeriesForm[];
  notes: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getWorkoutUserId();
  if ("error" in user) return user;

  const rows = params.series
    .map((s) => ({
      distance: s.distance,
      description: s.description.trim(),
    }))
    .filter((r) => r.distance > 0)
    .map((r, order_index) => ({ ...r, order_index }));

  if (rows.length === 0) {
    return { error: "Добавь хотя бы одну серию с дистанцией больше 0 м." };
  }

  const total_distance = rows.reduce((sum, r) => sum + r.distance, 0);
  const notesTrim = params.notes.trim();

  const { data: workout, error: wErr } = await supabase
    .from("workouts")
    .insert({
      user_id: user.userId,
      date: params.date,
      type: "swim",
      body_weight: null,
      total_tonnage: null,
      total_distance,
      calories_estimated: null,
      notes: notesTrim || null,
    })
    .select("id")
    .single();

  if (wErr || !workout) {
    return { error: wErr?.message ?? "Не удалось сохранить тренировку." };
  }

  const swimRows = rows.map((r) => ({
    workout_id: workout.id,
    order_index: r.order_index,
    distance: r.distance,
    description: r.description,
  }));

  const { error: sErr } = await supabase.from("swim_series").insert(swimRows);

  if (sErr) {
    await supabase.from("workouts").delete().eq("id", workout.id);
    return { error: sErr.message };
  }

  return { ok: true };
}
