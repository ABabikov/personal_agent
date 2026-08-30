import { getSupabaseServer } from "@/lib/db/supabase-server";
import type { Database } from "@/types/database";

type TokenRow = Database["public"]["Tables"]["integration_oauth_tokens"]["Row"];
type TokenInsert = Database["public"]["Tables"]["integration_oauth_tokens"]["Insert"];
type SessionRow = Database["public"]["Tables"]["device_activity_sessions"]["Row"];
type SessionInsert = Database["public"]["Tables"]["device_activity_sessions"]["Insert"];

export async function getOAuthTokenRow(userId: string): Promise<TokenRow | null> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("integration_oauth_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "huawei")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertOAuthTokens(
  userId: string,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_at: string | null;
    scope: string | null;
  }
): Promise<void> {
  const sb = getSupabaseServer();
  const row: TokenInsert = {
    user_id: userId,
    provider: "huawei",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    scope: tokens.scope,
  };
  const { error } = await sb
    .from("integration_oauth_tokens")
    .upsert(row, { onConflict: "user_id,provider" });
  if (error) throw new Error(error.message);
}

export async function deleteOAuthTokens(userId: string): Promise<void> {
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("integration_oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "huawei");
  if (error) throw new Error(error.message);
}

export async function upsertDeviceSession(
  userId: string,
  row: Omit<SessionInsert, "user_id" | "source">
): Promise<SessionRow> {
  const sb = getSupabaseServer();
  const payload: SessionInsert = {
    ...row,
    user_id: userId,
    source: "huawei",
  };
  const { data, error } = await sb
    .from("device_activity_sessions")
    .upsert(payload, { onConflict: "user_id,source,external_id" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "upsert device session failed");
  return data;
}

export async function listUnlinkedSessions(
  userId: string,
  limit = 30
): Promise<SessionRow[]> {
  const sb = getSupabaseServer();
  const { data: sessions, error: sErr } = await sb
    .from("device_activity_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("source", "huawei")
    .order("started_at", { ascending: false })
    .limit(Math.max(limit * 3, 60));
  if (sErr) throw new Error(sErr.message);

  const sessionList = sessions ?? [];
  if (sessionList.length === 0) return [];

  const { data: links, error: lErr } = await sb
    .from("workout_device_links")
    .select("device_session_id")
    .in(
      "device_session_id",
      sessionList.map((s) => s.id)
    );
  if (lErr) throw new Error(lErr.message);

  const linked = new Set((links ?? []).map((l) => l.device_session_id));
  return sessionList.filter((s) => !linked.has(s.id)).slice(0, limit);
}

export async function listWorkoutsForDate(
  userId: string,
  date: string,
  type?: "gym" | "swim"
): Promise<Database["public"]["Tables"]["workouts"]["Row"][]> {
  const sb = getSupabaseServer();
  let q = sb
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .is("deleted_at", null)
    .eq("status", "completed");
  if (type) q = q.eq("type", type);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getLinkedWorkoutIds(workoutIds: string[]): Promise<Set<string>> {
  if (workoutIds.length === 0) return new Set();
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("workout_device_links")
    .select("workout_id")
    .in("workout_id", workoutIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.workout_id));
}

export async function createDeviceLink(
  workoutId: string,
  deviceSessionId: string,
  matchMethod: "auto" | "manual",
  confidence: number | null
): Promise<void> {
  const sb = getSupabaseServer();
  const { error } = await sb.from("workout_device_links").insert({
    workout_id: workoutId,
    device_session_id: deviceSessionId,
    match_method: matchMethod,
    confidence,
  });
  if (error) throw new Error(error.message);
}

export async function sessionHasLink(deviceSessionId: string): Promise<boolean> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("workout_device_links")
    .select("id")
    .eq("device_session_id", deviceSessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}
