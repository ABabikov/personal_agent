import { enrichWorkoutByDeviceSessionId } from "@/lib/integrations/huawei/enrichWorkout";
import {
  createDeviceLink,
  getLinkedWorkoutIds,
  listWorkoutsForDate,
  sessionHasLink,
} from "@/lib/integrations/huawei/storage";
import {
  candidateJournalDates,
  getHuaweiUserTimeZone,
  sessionDateInZone,
} from "@/lib/integrations/huawei/timezone";
import { getSupabaseServer } from "@/lib/db/supabase-server";
import type { Database } from "@/types/database";

type WorkoutInsert = Database["public"]["Tables"]["workouts"]["Insert"];
type Mapped = "gym" | "swim" | "other";

type Candidate = {
  id: string;
  date: string;
  duration_minutes: number | null;
  total_tonnage: number | null;
};

async function loadCandidatesForDates(
  userId: string,
  dates: string[],
  type: "gym" | "swim"
): Promise<Candidate[]> {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const date of dates) {
    const rows = await listWorkoutsForDate(userId, date, type);
    for (const w of rows) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      out.push({
        id: w.id,
        date: w.date,
        duration_minutes:
          "duration_minutes" in w
            ? ((w as { duration_minutes?: number | null }).duration_minutes ??
              null)
            : null,
        total_tonnage:
          w.total_tonnage != null ? Number(w.total_tonnage) : null,
      });
    }
  }
  return out;
}

function pickBestCandidate(
  free: Candidate[],
  sessionDurationMin: number | null,
  preferredDate: string
): { workoutId: string; confidence: number } | null {
  if (free.length === 0) return null;
  if (free.length === 1) {
    const exact = free[0].date === preferredDate;
    return { workoutId: free[0].id, confidence: exact ? 0.9 : 0.75 };
  }

  const onPreferred = free.filter((c) => c.date === preferredDate);
  const pool = onPreferred.length > 0 ? onPreferred : free;

  if (pool.length === 1) {
    return {
      workoutId: pool[0].id,
      confidence: onPreferred.length ? 0.88 : 0.7,
    };
  }

  if (sessionDurationMin != null && sessionDurationMin > 0) {
    const ranked = [...pool].sort((a, b) => {
      const da =
        a.duration_minutes != null
          ? Math.abs(a.duration_minutes - sessionDurationMin)
          : 9999;
      const db =
        b.duration_minutes != null
          ? Math.abs(b.duration_minutes - sessionDurationMin)
          : 9999;
      return da - db;
    });
    const best = ranked[0];
    const second = ranked[1];
    const bestDelta =
      best.duration_minutes != null
        ? Math.abs(best.duration_minutes - sessionDurationMin)
        : null;
    const secondDelta =
      second?.duration_minutes != null
        ? Math.abs(second.duration_minutes - sessionDurationMin)
        : null;

    if (
      bestDelta != null &&
      bestDelta <= 25 &&
      (secondDelta == null || secondDelta - bestDelta >= 10)
    ) {
      return { workoutId: best.id, confidence: 0.8 };
    }
  }

  // Gym seed duplicates same day: pick higher tonnage
  const withTonnage = pool.filter(
    (c) => c.total_tonnage != null && c.total_tonnage > 0
  );
  if (withTonnage.length >= 1) {
    const ranked = [...withTonnage].sort(
      (a, b) => (b.total_tonnage ?? 0) - (a.total_tonnage ?? 0)
    );
    if (
      ranked.length === 1 ||
      (ranked[0].total_tonnage ?? 0) > (ranked[1].total_tonnage ?? 0)
    ) {
      return { workoutId: ranked[0].id, confidence: 0.72 };
    }
  }

  return null;
}

/**
 * Auto-link device session → journal workout.
 * Exact day (user TZ) first, then ±1 day; among several — by duration if clear.
 */
export async function autoLinkSession(
  userId: string,
  deviceSessionId: string,
  activityTypeMapped: Mapped,
  startedAt: string,
  durationSeconds?: number | null
): Promise<boolean> {
  if (activityTypeMapped === "other") return false;
  if (await sessionHasLink(deviceSessionId)) return false;

  const tz = getHuaweiUserTimeZone();
  const preferredDate = sessionDateInZone(startedAt, tz);
  const dates = candidateJournalDates(startedAt, tz);
  const candidates = await loadCandidatesForDates(
    userId,
    dates,
    activityTypeMapped
  );
  if (candidates.length === 0) return false;

  const linkedIds = await getLinkedWorkoutIds(candidates.map((c) => c.id));
  const free = candidates.filter((c) => !linkedIds.has(c.id));
  const sessionMin =
    durationSeconds != null && durationSeconds > 0
      ? Math.round(durationSeconds / 60)
      : null;

  const pick = pickBestCandidate(free, sessionMin, preferredDate);
  if (!pick) return false;

  await createDeviceLink(
    pick.workoutId,
    deviceSessionId,
    "auto",
    pick.confidence
  );
  try {
    await enrichWorkoutByDeviceSessionId(pick.workoutId, deviceSessionId);
  } catch {
    /* duration_minutes may be missing until migration 014 */
  }
  return true;
}

export async function autoLinkSessionsForUser(
  userId: string,
  deviceSessionIds?: string[]
): Promise<number> {
  const sb = getSupabaseServer();
  let query = sb
    .from("device_activity_sessions")
    .select("id, started_at, activity_type_mapped, duration_seconds")
    .eq("user_id", userId)
    .eq("source", "huawei")
    .in("activity_type_mapped", ["gym", "swim"]);

  if (deviceSessionIds && deviceSessionIds.length > 0) {
    query = query.in("id", deviceSessionIds);
  }

  const { data: sessions, error } = await query;
  if (error) throw new Error(error.message);

  const sessionList = sessions ?? [];
  if (sessionList.length === 0) return 0;

  const { data: existingLinks, error: linkErr } = await sb
    .from("workout_device_links")
    .select("device_session_id")
    .in(
      "device_session_id",
      sessionList.map((s) => s.id)
    );
  if (linkErr) throw new Error(linkErr.message);
  const alreadyLinked = new Set(
    (existingLinks ?? []).map((l) => l.device_session_id)
  );

  // Oldest first so earlier sessions claim their day before later ones
  const ordered = [...sessionList].sort((a, b) =>
    a.started_at.localeCompare(b.started_at)
  );

  let linked = 0;
  for (const s of ordered) {
    if (alreadyLinked.has(s.id)) continue;
    if (!s.activity_type_mapped || s.activity_type_mapped === "other") continue;
    const ok = await autoLinkSession(
      userId,
      s.id,
      s.activity_type_mapped,
      s.started_at,
      s.duration_seconds
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
  try {
    await enrichWorkoutByDeviceSessionId(workoutId, deviceSessionId);
  } catch {
    /* optional */
  }
}

export type MaterializeResult = {
  created: number;
  linked: number;
  skipped: number;
  errors: string[];
};

/**
 * Для непривязанных gym/swim сессий без кандидата в журнале (±1 день)
 * создаёт пустую completed-тренировку и линкует — чтобы данные часов были в календаре.
 */
export async function materializeOrphanDeviceSessions(
  userId: string
): Promise<MaterializeResult> {
  const sb = getSupabaseServer();
  const tz = getHuaweiUserTimeZone();
  const result: MaterializeResult = {
    created: 0,
    linked: 0,
    skipped: 0,
    errors: [],
  };

  const { data: sessions, error } = await sb
    .from("device_activity_sessions")
    .select(
      "id, started_at, activity_type_mapped, duration_seconds, calories_device, activity_type_raw"
    )
    .eq("user_id", userId)
    .eq("source", "huawei")
    .in("activity_type_mapped", ["gym", "swim"])
    .order("started_at", { ascending: true });

  if (error) throw new Error(error.message);

  const { data: links } = await sb
    .from("workout_device_links")
    .select("device_session_id");
  const linked = new Set((links ?? []).map((l) => l.device_session_id));

  for (const s of sessions ?? []) {
    if (linked.has(s.id)) {
      result.skipped++;
      continue;
    }
    if (s.activity_type_mapped !== "gym" && s.activity_type_mapped !== "swim") {
      result.skipped++;
      continue;
    }

    const dates = candidateJournalDates(s.started_at, tz);
    const existing = await loadCandidatesForDates(
      userId,
      dates,
      s.activity_type_mapped
    );
    const linkedIds = await getLinkedWorkoutIds(existing.map((c) => c.id));
    const free = existing.filter((c) => !linkedIds.has(c.id));
    if (free.length > 0) {
      // Still has a journal candidate — leave for auto/manual link
      result.skipped++;
      continue;
    }

    const date = sessionDateInZone(s.started_at, tz);
    const durationMin =
      s.duration_seconds != null && s.duration_seconds > 0
        ? Math.max(1, Math.round(s.duration_seconds / 60))
        : null;

    const note = [
      "__huawei:materialized__",
      s.activity_type_raw ? `Huawei type ${s.activity_type_raw}` : null,
      s.calories_device != null
        ? `~${Math.round(Number(s.calories_device))} ккал (часы)`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const insertRow: WorkoutInsert = {
      user_id: userId,
      date,
      type: s.activity_type_mapped,
      status: "completed",
      notes: note,
      body_weight: null,
      total_tonnage: s.activity_type_mapped === "gym" ? 0 : null,
      total_distance: s.activity_type_mapped === "swim" ? 0 : null,
      calories_estimated: null,
      ...(durationMin != null ? { duration_minutes: durationMin } : {}),
    };

    const { data: workout, error: wErr } = await sb
      .from("workouts")
      .insert(insertRow)
      .select("id")
      .single();

    if (wErr || !workout) {
      // Retry without duration_minutes if column missing
      if (wErr?.message.includes("duration_minutes")) {
        const { duration_minutes: _dm, ...withoutDuration } = insertRow;
        const retry = await sb
          .from("workouts")
          .insert(withoutDuration)
          .select("id")
          .single();
        if (retry.error || !retry.data) {
          result.errors.push(`${s.id}: ${retry.error?.message ?? wErr.message}`);
          continue;
        }
        result.created++;
        try {
          await createDeviceLink(retry.data.id, s.id, "auto", 0.6);
          result.linked++;
          linked.add(s.id);
        } catch (e) {
          result.errors.push(
            `${s.id}: created but link failed: ${e instanceof Error ? e.message : e}`
          );
        }
        continue;
      }
      result.errors.push(`${s.id}: ${wErr?.message ?? "insert failed"}`);
      continue;
    }

    result.created++;
    try {
      await createDeviceLink(workout.id, s.id, "auto", 0.6);
      result.linked++;
      linked.add(s.id);
      try {
        await enrichWorkoutByDeviceSessionId(workout.id, s.id);
      } catch {
        /* optional */
      }
    } catch (e) {
      result.errors.push(
        `${s.id}: created but link failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  return result;
}

/**
 * Outdoor / other (sportType 218 и т.п.) → запись в журнале как gym-заглушка
 * с пометкой outdoor, чтобы пульс/ккал были в календаре.
 * В статистике тоннажа не участвуют (total_tonnage = 0).
 */
export async function materializeOutdoorDeviceSessions(
  userId: string
): Promise<MaterializeResult> {
  const sb = getSupabaseServer();
  const tz = getHuaweiUserTimeZone();
  const result: MaterializeResult = {
    created: 0,
    linked: 0,
    skipped: 0,
    errors: [],
  };

  const { data: sessions, error } = await sb
    .from("device_activity_sessions")
    .select(
      "id, started_at, activity_type_mapped, duration_seconds, calories_device, activity_type_raw"
    )
    .eq("user_id", userId)
    .eq("source", "huawei")
    .eq("activity_type_mapped", "other")
    .order("started_at", { ascending: true });

  if (error) throw new Error(error.message);

  const sessionList = sessions ?? [];
  if (sessionList.length === 0) return result;

  const { data: links } = await sb
    .from("workout_device_links")
    .select("device_session_id")
    .in(
      "device_session_id",
      sessionList.map((s) => s.id)
    );
  const linked = new Set((links ?? []).map((l) => l.device_session_id));

  for (const s of sessionList) {
    if (linked.has(s.id)) {
      result.skipped++;
      continue;
    }

    const date = sessionDateInZone(s.started_at, tz);
    const durationMin =
      s.duration_seconds != null && s.duration_seconds > 0
        ? Math.max(1, Math.round(s.duration_seconds / 60))
        : null;

    const note = [
      "__huawei:outdoor__",
      s.activity_type_raw
        ? `Outdoor Huawei ${s.activity_type_raw}`
        : "Outdoor (GPS)",
      s.calories_device != null
        ? `~${Math.round(Number(s.calories_device))} ккал (часы)`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const insertRow: WorkoutInsert = {
      user_id: userId,
      date,
      type: "gym",
      status: "completed",
      notes: note,
      body_weight: null,
      total_tonnage: 0,
      total_distance: null,
      calories_estimated: null,
      ...(durationMin != null ? { duration_minutes: durationMin } : {}),
    };

    const { data: workout, error: wErr } = await sb
      .from("workouts")
      .insert(insertRow)
      .select("id")
      .single();

    if (wErr || !workout) {
      if (wErr?.message.includes("duration_minutes")) {
        const { duration_minutes: _dm, ...withoutDuration } = insertRow;
        const retry = await sb
          .from("workouts")
          .insert(withoutDuration)
          .select("id")
          .single();
        if (retry.error || !retry.data) {
          result.errors.push(
            `${s.id}: ${retry.error?.message ?? wErr.message}`
          );
          continue;
        }
        result.created++;
        try {
          await createDeviceLink(retry.data.id, s.id, "auto", 0.55);
          result.linked++;
        } catch (e) {
          result.errors.push(
            `${s.id}: ${e instanceof Error ? e.message : e}`
          );
        }
        continue;
      }
      result.errors.push(`${s.id}: ${wErr?.message ?? "insert failed"}`);
      continue;
    }

    result.created++;
    try {
      await createDeviceLink(workout.id, s.id, "auto", 0.55);
      result.linked++;
      try {
        await enrichWorkoutByDeviceSessionId(workout.id, s.id);
      } catch {
        /* optional */
      }
    } catch (e) {
      result.errors.push(`${s.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return result;
}
