import { supabase } from "@/lib/db/supabase";
import type { ParsedGymWorkout } from "@/lib/features/workouts/csvImport";
import { exerciseTonnage } from "@/lib/features/workouts/tonnage";
import type { GymSet } from "@/types/database";

export type GymPresetSlot = 1 | 2 | 3;

export type GymPresetExercise = {
  name: string;
  sets: GymSet[];
};

export type GymPresetRow = {
  user_id: string;
  slot: number;
  label: string;
  exercises: GymPresetExercise[];
  updated_at: string;
};

function normalizeExercises(raw: unknown): GymPresetExercise[] {
  if (!Array.isArray(raw)) return [];
  const out: GymPresetExercise[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = "name" in item && typeof (item as { name?: unknown }).name === "string"
      ? (item as { name: string }).name.trim()
      : "";
    const setsRaw = "sets" in item ? (item as { sets?: unknown }).sets : undefined;
    if (!name || !Array.isArray(setsRaw)) continue;
    const sets: GymSet[] = [];
    for (const s of setsRaw) {
      if (!s || typeof s !== "object") continue;
      const w = Number((s as { weight?: unknown }).weight);
      const r = Number((s as { reps?: unknown }).reps);
      if (!Number.isFinite(w) || !Number.isFinite(r)) continue;
      sets.push({ weight: w, reps: Math.trunc(r) });
    }
    if (sets.length === 0) continue;
    out.push({ name, sets });
  }
  return out;
}

/** Пресеты из БД по слотам; пустой слот = null */
export async function loadGymPresets(
  userId: string
): Promise<
  { data: Record<GymPresetSlot, GymPresetRow | null> } | { error: string }
> {
  const { data, error } = await supabase
    .from("gym_presets")
    .select("user_id, slot, label, exercises, updated_at")
    .eq("user_id", userId);

  if (error) return { error: error.message };

  const empty: Record<GymPresetSlot, GymPresetRow | null> = {
    1: null,
    2: null,
    3: null,
  };

  for (const row of data ?? []) {
    const slot = Number(row.slot);
    if (slot !== 1 && slot !== 2 && slot !== 3) continue;
    const exercises = normalizeExercises(row.exercises);
    empty[slot] = {
      user_id: row.user_id,
      slot,
      label: typeof row.label === "string" ? row.label : "",
      exercises,
      updated_at: row.updated_at,
    };
  }

  return { data: empty };
}

export function gymPresetToParsedWorkout(
  exercises: GymPresetExercise[],
  bodyWeight: number | null = null
): ParsedGymWorkout | null {
  if (exercises.length === 0) return null;
  let total = 0;
  const mapped = exercises.map((ex) => {
    const tonnage = exerciseTonnage(ex.sets);
    total += tonnage;
    return {
      name: ex.name,
      sets: ex.sets,
      tonnage,
    };
  });
  return {
    date: "",
    bodyWeight,
    exercises: mapped,
    totalTonnage: total,
  };
}

export async function upsertGymPreset(
  userId: string,
  slot: GymPresetSlot,
  payload: { label: string; exercises: GymPresetExercise[] }
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase.from("gym_presets").upsert(
    {
      user_id: userId,
      slot,
      label: payload.label.trim(),
      exercises: payload.exercises.map((ex) => ({
        name: ex.name,
        sets: ex.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
      })),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,slot" }
  );

  if (error) return { error: error.message };
  return { ok: true };
}
