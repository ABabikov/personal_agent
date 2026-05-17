import {
  createDeviceLink,
  getLinkedWorkoutIds,
  listWorkoutsForDate,
  sessionHasLink,
} from "@/lib/integrations/huawei/storage";
import { getSupabaseServer } from "@/lib/db/supabase-server";

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Auto-link device sessions to workouts on the same calendar day + matching type.
 * Only when exactly one unlinked workout candidate exists.
 */
export async function autoLinkSession(
  userId: string,
  deviceSessionId: string,
  activityTypeMapped: "gym" | "swim" | "other",
  startedAt: string
): Promise<boolean> {
  if (activityTypeMapped === "other") return false;
  if (await sessionHasLink(deviceSessionId)) return false;

  const date = localDateKey(startedAt);
  const candidates = await listWorkoutsForDate(userId, date, activityTypeMapped);
  if (candidates.length !== 1) return false;

  const linkedIds = await getLinkedWorkoutIds(candidates.map((w) => w.id));
  const free = candidates.filter((w) => !linkedIds.has(w.id));
  if (free.length !== 1) return false;

  await createDeviceLink(free[0].id, deviceSessionId, "auto", 0.9);
  return true;
}

export async function autoLinkSessionsForUser(
  userId: string,
  deviceSessionIds?: string[]
): Promise<number> {
  const sb = getSupabaseServer();
  let query = sb
    .from("device_activity_sessions")
    .select("id, started_at, activity_type_mapped")
    .eq("user_id", userId)
    .eq("source", "huawei")
    .in("activity_type_mapped", ["gym", "swim"]);

  if (deviceSessionIds && deviceSessionIds.length > 0) {
    query = query.in("id", deviceSessionIds);
  }

  const { data: sessions, error } = await query;
  if (error) throw new Error(error.message);

  let linked = 0;
  for (const s of sessions ?? []) {
    if (!s.activity_type_mapped || s.activity_type_mapped === "other") continue;
    const ok = await autoLinkSession(
      userId,
      s.id,
      s.activity_type_mapped,
      s.started_at
    );
    if (ok) linked++;
  }
  return linked;
}

export async function manualLinkSession(
  workoutId: string,
  deviceSessionId: string
): Promise<void> {
  if (await sessionHasLink(deviceSessionId)) {
    throw new Error("Сессия уже сопоставлена с тренировкой");
  }
  await createDeviceLink(workoutId, deviceSessionId, "manual", null);
}
