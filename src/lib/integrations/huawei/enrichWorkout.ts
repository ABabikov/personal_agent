import { getSupabaseServer } from "@/lib/db/supabase-server";
import type { Database } from "@/types/database";

type SessionRow = Database["public"]["Tables"]["device_activity_sessions"]["Row"];
type WorkoutUpdate = Database["public"]["Tables"]["workouts"]["Update"];

/**
 * Fills gaps on a journal workout from a linked device session — never overwrites MET calories.
 */
export async function enrichWorkoutFromDeviceSession(
  workoutId: string,
  session: Pick<
    SessionRow,
    "duration_seconds" | "calories_device" | "avg_heart_rate"
  >
): Promise<void> {
  const sb = getSupabaseServer();
  const { data: workout, error } = await sb
    .from("workouts")
    .select("id, duration_minutes, notes")
    .eq("id", workoutId)
    .maybeSingle();

  if (error) {
    if (error.message.includes("duration_minutes")) {
      return;
    }
    throw new Error(error.message);
  }
  if (!workout) return;

  const patch: WorkoutUpdate = {};

  if (
    workout.duration_minutes == null &&
    session.duration_seconds != null &&
    session.duration_seconds > 0
  ) {
    patch.duration_minutes = Math.max(1, Math.round(session.duration_seconds / 60));
  }

  if (Object.keys(patch).length === 0) return;

  const { error: upErr } = await sb.from("workouts").update(patch).eq("id", workoutId);
  if (upErr) {
    if (upErr.message.includes("duration_minutes")) return;
    throw new Error(upErr.message);
  }
}

export async function enrichWorkoutByDeviceSessionId(
  workoutId: string,
  deviceSessionId: string
): Promise<void> {
  const sb = getSupabaseServer();
  const { data: session, error } = await sb
    .from("device_activity_sessions")
    .select("duration_seconds, calories_device, avg_heart_rate")
    .eq("id", deviceSessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!session) return;

  await enrichWorkoutFromDeviceSession(workoutId, session);
}
