import { supabase } from "@/lib/db/supabase";
import { huaweiActivityLabel } from "@/lib/integrations/huawei/activityLabels";
import type { WorkoutRow } from "@/lib/db/listWorkouts";

export type DeviceWorkoutEnrichment = {
  caloriesDevice: number | null;
  avgHeartRate: number | null;
  durationMinutes: number | null;
  activityTypeRaw: string | null;
  activityLabel: string | null;
};

export async function fetchDeviceEnrichmentForWorkout(
  workoutId: string
): Promise<DeviceWorkoutEnrichment | null> {
  const map = await fetchDeviceEnrichmentMap([workoutId], []);
  return map.get(workoutId) ?? null;
}

/** Метрики с часов для слинкованных тренировок. */
export async function fetchDeviceEnrichmentMap(
  workoutIds: string[],
  workouts: WorkoutRow[]
): Promise<Map<string, DeviceWorkoutEnrichment>> {
  const map = new Map<string, DeviceWorkoutEnrichment>();
  if (workoutIds.length === 0) return map;

  const workoutById = new Map(workouts.map((w) => [w.id, w] as const));

  const { data: links, error: linkErr } = await supabase
    .from("workout_device_links")
    .select("workout_id, device_session_id")
    .in("workout_id", workoutIds);

  if (linkErr || !links?.length) return map;

  const sessionIds = [...new Set(links.map((l) => l.device_session_id))];
  const { data: sessions, error: sErr } = await supabase
    .from("device_activity_sessions")
    .select(
      "id, calories_device, avg_heart_rate, duration_seconds, activity_type_raw"
    )
    .in("id", sessionIds);

  if (sErr) return map;

  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s] as const));

  for (const link of links) {
    const session = sessionById.get(link.device_session_id);
    if (!session) continue;

    const w = workoutById.get(link.workout_id);
    const durationMinutes =
      w?.duration_minutes != null && w.duration_minutes > 0
        ? w.duration_minutes
        : session.duration_seconds != null && session.duration_seconds > 0
          ? Math.max(1, Math.round(session.duration_seconds / 60))
          : null;

    const raw = session.activity_type_raw;
    map.set(link.workout_id, {
      caloriesDevice:
        session.calories_device != null ? Number(session.calories_device) : null,
      avgHeartRate:
        session.avg_heart_rate != null ? Number(session.avg_heart_rate) : null,
      durationMinutes,
      activityTypeRaw: raw,
      activityLabel: huaweiActivityLabel(raw),
    });
  }

  return map;
}
