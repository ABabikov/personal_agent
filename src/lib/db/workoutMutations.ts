import { supabase } from "@/lib/db/supabase";
import { exerciseTonnage, totalTonnage } from "@/lib/features/workouts/tonnage";
import { estimateGymCalories } from "@/lib/features/workouts/calories";
import type { ParsedGymWorkout, ParsedSwimWorkout } from "@/lib/features/workouts/csvImport";
import type { GymSet } from "@/types/database";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import type { GymExerciseForm, SwimSeriesForm } from "@/lib/db/saveWorkout";
import type { WorkoutStatus } from "@/lib/features/workouts/workoutStatus";

export type LoadedGymWorkout = {
  workoutId: string;
  status: WorkoutStatus;
  parsed: ParsedGymWorkout;
  notes: string;
};

export type LoadedSwimWorkout = {
  workoutId: string;
  status: WorkoutStatus;
  parsed: ParsedSwimWorkout;
  notes: string;
};

function parseBodyWeight(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function assertWorkoutOwned(
  userId: string,
  workoutId: string,
  expectedType: "gym" | "swim"
): Promise<{ ok: true; status: WorkoutStatus } | { error: string }> {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, type, status")
    .eq("id", workoutId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Тренировка не найдена или уже удалена." };
  if (data.type !== expectedType) {
    return {
      error:
        expectedType === "gym"
          ? "Эта запись — плавание. Откройте её на странице плавания."
          : "Эта запись — силовая. Откройте её в зале.",
    };
  }
  const status = data.status as WorkoutStatus;
  if (status !== "active" && status !== "completed") {
    return { error: "Неизвестный статус тренировки." };
  }
  return { ok: true, status };
}

export async function fetchGymWorkoutById(
  userId: string,
  workoutId: string
): Promise<{ data: LoadedGymWorkout } | { error: string }> {
  const check = await assertWorkoutOwned(userId, workoutId, "gym");
  if ("error" in check) return check;

  const { data: w, error: wErr } = await supabase
    .from("workouts")
    .select("id, date, body_weight, total_tonnage, notes, status")
    .eq("id", workoutId)
    .single();

  if (wErr || !w) return { error: wErr?.message ?? "Не удалось загрузить тренировку." };

  const { data: exRows, error: eErr } = await supabase
    .from("gym_exercises")
    .select("exercise_name, order_index, sets, tonnage")
    .eq("workout_id", workoutId)
    .order("order_index", { ascending: true });

  if (eErr) return { error: eErr.message };
  if (!exRows?.length && check.status !== "active") {
    return { error: "У тренировки нет упражнений." };
  }

  const exercises = (exRows ?? []).map((r) => ({
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

  return {
    data: {
      workoutId: w.id,
      status: check.status,
      parsed,
      notes: w.notes?.trim() ?? "",
    },
  };
}

export async function fetchActiveGymWorkout(
  userId: string
): Promise<{ data: LoadedGymWorkout | null } | { error: string }> {
  const { data: head, error: hErr } = await supabase
    .from("workouts")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "gym")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (hErr) return { error: hErr.message };
  if (!head) return { data: null };
  return fetchGymWorkoutById(userId, head.id);
}

export async function fetchSwimWorkoutById(
  userId: string,
  workoutId: string
): Promise<{ data: LoadedSwimWorkout } | { error: string }> {
  const check = await assertWorkoutOwned(userId, workoutId, "swim");
  if ("error" in check) return check;

  const { data: w, error: wErr } = await supabase
    .from("workouts")
    .select("id, date, total_distance, notes, status")
    .eq("id", workoutId)
    .single();

  if (wErr || !w) return { error: wErr?.message ?? "Не удалось загрузить тренировку." };

  const { data: sRows, error: sErr } = await supabase
    .from("swim_series")
    .select("distance, description, order_index")
    .eq("workout_id", workoutId)
    .order("order_index", { ascending: true });

  if (sErr) return { error: sErr.message };
  if (!sRows?.length && check.status !== "active") {
    return { error: "У тренировки нет серий." };
  }

  const series = (sRows ?? []).map((r) => ({
    distance: r.distance as number,
    description: r.description ?? "",
  }));

  const totalDistance =
    w.total_distance != null
      ? Number(w.total_distance)
      : series.reduce((a, x) => a + x.distance, 0);

  const parsed: ParsedSwimWorkout = {
    date: w.date,
    series,
    totalDistance,
    durationMinutes: null,
  };

  return {
    data: {
      workoutId: w.id,
      status: check.status,
      parsed,
      notes: w.notes?.trim() ?? "",
    },
  };
}

export async function fetchActiveSwimWorkout(
  userId: string
): Promise<{ data: LoadedSwimWorkout | null } | { error: string }> {
  const { data: head, error: hErr } = await supabase
    .from("workouts")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "swim")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (hErr) return { error: hErr.message };
  if (!head) return { data: null };
  return fetchSwimWorkoutById(userId, head.id);
}

export async function completeWorkout(
  workoutId: string
): Promise<{ ok: true } | { error: string }> {
  const user = await getWorkoutUserId();
  if ("error" in user) return user;

  const { data: row, error: fetchErr } = await supabase
    .from("workouts")
    .select("id, status")
    .eq("id", workoutId)
    .eq("user_id", user.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: "Тренировка не найдена." };
  if (row.status === "completed") return { ok: true };

  const { error } = await supabase
    .from("workouts")
    .update({ status: "completed" })
    .eq("id", workoutId)
    .eq("user_id", user.userId)
    .eq("status", "active");

  if (error) return { error: error.message };
  return { ok: true };
}

export async function softDeleteWorkout(
  workoutId: string
): Promise<{ ok: true } | { error: string }> {
  const user = await getWorkoutUserId();
  if ("error" in user) return user;

  const { data: row, error: fetchErr } = await supabase
    .from("workouts")
    .select("id")
    .eq("id", workoutId)
    .eq("user_id", user.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: "Тренировка не найдена или уже удалена." };

  const { error: linkErr } = await supabase
    .from("workout_device_links")
    .delete()
    .eq("workout_id", workoutId);

  if (linkErr) return { error: linkErr.message };

  const { error: delErr } = await supabase
    .from("workouts")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_reason: "user",
    })
    .eq("id", workoutId)
    .eq("user_id", user.userId);

  if (delErr) return { error: delErr.message };
  return { ok: true };
}

export async function updateGymWorkoutToSupabase(params: {
  workoutId: string;
  date: string;
  bodyWeightStr: string;
  exercises: GymExerciseForm[];
  notes: string;
  profileWeightKg?: number | null;
  durationMinOverride?: number | null;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getWorkoutUserId();
  if ("error" in user) return user;

  const check = await assertWorkoutOwned(user.userId, params.workoutId, "gym");
  if ("error" in check) return check;

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
    return {
      error:
        "Добавь хотя бы одно упражнение с названием и подходами (вес × повторы).",
    };
  }

  const summaries = rows.map((r) => ({ sets: r.sets }));
  const total = totalTonnage(summaries);
  const body_weight = parseBodyWeight(params.bodyWeightStr);
  const notesTrim = params.notes.trim();

  const effectiveWeight = body_weight ?? params.profileWeightKg ?? null;
  let caloriesEstimated: number | null = null;
  if (effectiveWeight && effectiveWeight > 0) {
    const est = estimateGymCalories({
      bodyWeightKg: effectiveWeight,
      exercises: summaries,
      durationMinOverride: params.durationMinOverride ?? null,
    });
    if (est) caloriesEstimated = est.calories;
  }

  const { error: wErr } = await supabase
    .from("workouts")
    .update({
      date: params.date,
      body_weight,
      total_tonnage: Math.round(total * 10) / 10,
      total_distance: null,
      calories_estimated: caloriesEstimated,
      notes: notesTrim || null,
    })
    .eq("id", params.workoutId)
    .eq("user_id", user.userId);

  if (wErr) return { error: wErr.message };

  const { error: delErr } = await supabase
    .from("gym_exercises")
    .delete()
    .eq("workout_id", params.workoutId);

  if (delErr) return { error: delErr.message };

  const gymRows = rows.map((r) => ({
    workout_id: params.workoutId,
    exercise_name: r.exercise_name,
    order_index: r.order_index,
    sets: r.sets,
    tonnage: Math.round(r.tonnage * 10) / 10,
  }));

  const { error: gErr } = await supabase.from("gym_exercises").insert(gymRows);
  if (gErr) return { error: gErr.message };

  return { ok: true };
}

export async function updateSwimWorkoutToSupabase(params: {
  workoutId: string;
  date: string;
  series: SwimSeriesForm[];
  notes: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await getWorkoutUserId();
  if ("error" in user) return user;

  const check = await assertWorkoutOwned(user.userId, params.workoutId, "swim");
  if ("error" in check) return check;

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

  const { error: wErr } = await supabase
    .from("workouts")
    .update({
      date: params.date,
      total_distance,
      notes: notesTrim || null,
    })
    .eq("id", params.workoutId)
    .eq("user_id", user.userId);

  if (wErr) return { error: wErr.message };

  const { error: delErr } = await supabase
    .from("swim_series")
    .delete()
    .eq("workout_id", params.workoutId);

  if (delErr) return { error: delErr.message };

  const swimRows = rows.map((r) => ({
    workout_id: params.workoutId,
    order_index: r.order_index,
    distance: r.distance,
    description: r.description,
  }));

  const { error: sErr } = await supabase.from("swim_series").insert(swimRows);
  if (sErr) return { error: sErr.message };

  return { ok: true };
}

/** Создать или обновить активный черновик силовой (status = active). */
export async function upsertActiveGymWorkout(params: {
  workoutId?: string;
  date: string;
  bodyWeightStr: string;
  exercises: GymExerciseForm[];
  notes: string;
  profileWeightKg?: number | null;
  durationMinOverride?: number | null;
}): Promise<{ ok: true; workoutId: string } | { error: string }> {
  if (params.workoutId) {
    const updated = await updateGymWorkoutToSupabase({
      workoutId: params.workoutId,
      date: params.date,
      bodyWeightStr: params.bodyWeightStr,
      exercises: params.exercises,
      notes: params.notes,
      profileWeightKg: params.profileWeightKg,
      durationMinOverride: params.durationMinOverride,
    });
    if ("error" in updated) return updated;
    return { ok: true, workoutId: params.workoutId };
  }

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
    return {
      error:
        "Добавь хотя бы одно упражнение с названием и подходами (вес × повторы).",
    };
  }

  const summaries = rows.map((r) => ({ sets: r.sets }));
  const total = totalTonnage(summaries);
  const body_weight = parseBodyWeight(params.bodyWeightStr);
  const notesTrim = params.notes.trim();

  const effectiveWeight = body_weight ?? params.profileWeightKg ?? null;
  let caloriesEstimated: number | null = null;
  if (effectiveWeight && effectiveWeight > 0) {
    const est = estimateGymCalories({
      bodyWeightKg: effectiveWeight,
      exercises: summaries,
      durationMinOverride: params.durationMinOverride ?? null,
    });
    if (est) caloriesEstimated = est.calories;
  }

  const { data: workout, error: wErr } = await supabase
    .from("workouts")
    .insert({
      user_id: user.userId,
      date: params.date,
      type: "gym",
      body_weight,
      total_tonnage: Math.round(total * 10) / 10,
      total_distance: null,
      calories_estimated: caloriesEstimated,
      notes: notesTrim || null,
      status: "active",
    })
    .select("id")
    .single();

  if (wErr || !workout) {
    return { error: wErr?.message ?? "Не удалось сохранить черновик." };
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

  return { ok: true, workoutId: workout.id };
}

/** Создать или обновить активный черновик плавания (status = active). */
export async function upsertActiveSwimWorkout(params: {
  workoutId?: string;
  date: string;
  series: SwimSeriesForm[];
  notes: string;
}): Promise<{ ok: true; workoutId: string } | { error: string }> {
  if (params.workoutId) {
    const updated = await updateSwimWorkoutToSupabase({
      workoutId: params.workoutId,
      date: params.date,
      series: params.series,
      notes: params.notes,
    });
    if ("error" in updated) return updated;
    return { ok: true, workoutId: params.workoutId };
  }

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
      status: "active",
    })
    .select("id")
    .single();

  if (wErr || !workout) {
    return { error: wErr?.message ?? "Не удалось сохранить черновик." };
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

  return { ok: true, workoutId: workout.id };
}
