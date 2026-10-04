import { supabase } from "@/lib/db/supabase";
import { resolveNearbyCity } from "@/lib/features/nearby/cities";
import { DEFAULT_INTEREST_LABELS, normalizeInterestLabel } from "@/lib/features/nearby/defaults";
import type {
  NearbyEventView,
  NearbyFeed,
  NearbyInterestView,
  NearbySettingsView,
  ScoredNearbyEvent,
} from "@/lib/features/nearby/types";
import type { Database, NearbyEventSource } from "@/types/database";

type SettingsRow = Database["public"]["Tables"]["nearby_settings"]["Row"];
type InterestRow = Database["public"]["Tables"]["nearby_interests"]["Row"];
type EventRow = Database["public"]["Tables"]["nearby_events"]["Row"];

const STALE_MS = 12 * 60 * 60 * 1000;

export async function loadNearby(userId: string): Promise<{ feed: NearbyFeed } | { error: string }> {
  const ensured = await ensureNearby(userId);
  if (ensured) return { error: ensured };

  const [settingsRes, interestsRes, eventsRes] = await Promise.all([
    supabase.from("nearby_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("nearby_interests").select("*").eq("user_id", userId).order("created_at"),
    supabase
      .from("nearby_events")
      .select("*")
      .eq("user_id", userId)
      .eq("hidden", false)
      .order("score", { ascending: false }),
  ]);

  const failed = settingsRes.error ?? interestsRes.error ?? eventsRes.error;
  if (failed) return { error: humanDbError(failed.message) };
  if (!settingsRes.data) return { error: "Не удалось прочитать настройки ленты." };

  return {
    feed: {
      settings: toSettings(settingsRes.data),
      interests: (interestsRes.data ?? []).map(toInterest),
      events: sortEvents((eventsRes.data ?? []).map(toEvent)),
      stale: isStale(settingsRes.data.refreshed_at),
    },
  };
}

export async function saveNearbyCity(
  userId: string,
  slug: string | null,
  label: string | null
): Promise<{ settings: NearbySettingsView } | { error: string }> {
  const city = resolveNearbyCity(slug, label);
  if ("error" in city) return city;
  const ensured = await ensureNearby(userId);
  if (ensured) return { error: ensured };
  const { data, error } = await supabase
    .from("nearby_settings")
    .update({
      city_slug: city.slug,
      city_label: city.label,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) return { error: humanDbError(error.message) };
  return { settings: toSettings(data) };
}

export async function addNearbyInterest(
  userId: string,
  rawLabel: string
): Promise<{ id: string; label: string } | { error: string }> {
  const label = normalizeInterestLabel(rawLabel);
  if (label.length < 2 || label.length > 48) return { error: "Интерес: от 2 до 48 символов." };
  const { count, error: countError } = await supabase
    .from("nearby_interests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) return { error: humanDbError(countError.message) };
  if ((count ?? 0) >= 8) return { error: "Не больше 8 интересов." };
  const { data, error } = await supabase
    .from("nearby_interests")
    .insert({ user_id: userId, label, enabled: true })
    .select("id, label")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Такой интерес уже есть." };
    return { error: humanDbError(error.message) };
  }
  return { id: data.id, label: data.label };
}

export async function setNearbyInterestEnabled(
  userId: string,
  interestId: string,
  enabled: boolean
): Promise<{ error: string } | { ok: true }> {
  const { error } = await supabase
    .from("nearby_interests")
    .update({ enabled })
    .eq("user_id", userId)
    .eq("id", interestId);
  if (error) return { error: humanDbError(error.message) };
  return { ok: true };
}

export async function deleteNearbyInterest(
  userId: string,
  interestId: string
): Promise<{ error: string } | { ok: true }> {
  const { error } = await supabase.from("nearby_interests").delete().eq("user_id", userId).eq("id", interestId);
  if (error) return { error: humanDbError(error.message) };
  return { ok: true };
}

export async function replaceNearbyInterests(
  userId: string,
  rawLabels: string[]
): Promise<{ labels: string[] } | { error: string }> {
  const labels: string[] = [];
  for (const raw of rawLabels) {
    const label = normalizeInterestLabel(raw);
    if (label.length < 2 || label.length > 48) return { error: `Интерес «${raw}»: от 2 до 48 символов.` };
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length < 1 || labels.length > 8) return { error: "Нужно от 1 до 8 интересов." };
  const ensured = await ensureNearby(userId);
  if (ensured) return { error: ensured };
  const { error: deleteError } = await supabase.from("nearby_interests").delete().eq("user_id", userId);
  if (deleteError) return { error: humanDbError(deleteError.message) };
  const { error } = await supabase.from("nearby_interests").insert(
    labels.map((label) => ({ user_id: userId, label, enabled: true }))
  );
  if (error) return { error: humanDbError(error.message) };
  return { labels };
}

export async function hideNearbyEvent(
  userId: string,
  eventId: string
): Promise<{ error: string } | { ok: true }> {
  const { error } = await supabase
    .from("nearby_events")
    .update({ hidden: true })
    .eq("user_id", userId)
    .eq("id", eventId);
  if (error) return { error: humanDbError(error.message) };
  return { ok: true };
}

export async function replaceVisibleNearbyEvents(
  userId: string,
  picks: ScoredNearbyEvent[],
  digest: string
): Promise<{ error: string } | { ok: true }> {
  const hiddenRes = await supabase
    .from("nearby_events")
    .select("external_key")
    .eq("user_id", userId)
    .eq("hidden", true);
  if (hiddenRes.error) return { error: humanDbError(hiddenRes.error.message) };
  const hidden = new Set((hiddenRes.data ?? []).map((row) => row.external_key));

  const { error: deleteError } = await supabase
    .from("nearby_events")
    .delete()
    .eq("user_id", userId)
    .eq("hidden", false);
  if (deleteError) return { error: humanDbError(deleteError.message) };

  const now = new Date().toISOString();
  const rows = picks
    .filter((pick) => !hidden.has(pick.candidate.key))
    .map((pick) => ({
      user_id: userId,
      external_key: pick.candidate.key,
      source: pick.candidate.source satisfies NearbyEventSource,
      title: pick.title || pick.candidate.title,
      url: pick.candidate.url,
      starts_on: pick.startsOn,
      place: pick.place ?? pick.candidate.place,
      snippet: pick.candidate.snippet || null,
      why: pick.why,
      score: pick.score,
      interest_label: pick.candidate.interestLabel,
      hidden: false,
      fetched_at: now,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("nearby_events").insert(rows);
    if (error) return { error: humanDbError(error.message) };
  }

  const { error: settingsError } = await supabase
    .from("nearby_settings")
    .update({
      last_digest: digest,
      refreshed_at: now,
      updated_at: now,
    })
    .eq("user_id", userId);
  if (settingsError) return { error: humanDbError(settingsError.message) };
  return { ok: true };
}

async function ensureNearby(userId: string): Promise<string | null> {
  const existing = await supabase.from("nearby_settings").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing.error) return humanDbError(existing.error.message);
  if (existing.data) return null;

  const settingsIns = await supabase.from("nearby_settings").insert({ user_id: userId });
  if (settingsIns.error && settingsIns.error.code !== "23505") return humanDbError(settingsIns.error.message);

  const interestIns = await supabase.from("nearby_interests").insert(
    DEFAULT_INTEREST_LABELS.map((label) => ({ user_id: userId, label, enabled: true }))
  );
  if (interestIns.error && interestIns.error.code !== "23505") return humanDbError(interestIns.error.message);
  return null;
}

function toSettings(row: SettingsRow): NearbySettingsView {
  return {
    citySlug: row.city_slug,
    cityLabel: row.city_label,
    horizonDays: row.horizon_days,
    lastDigest: row.last_digest,
    refreshedAt: row.refreshed_at,
  };
}

function toInterest(row: InterestRow): NearbyInterestView {
  return { id: row.id, label: row.label, enabled: row.enabled };
}

function toEvent(row: EventRow): NearbyEventView {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
    startsOn: row.starts_on,
    place: row.place,
    why: row.why,
    score: Number(row.score),
    interestLabel: row.interest_label,
  };
}

function sortEvents(events: NearbyEventView[]): NearbyEventView[] {
  return [...events].sort((a, b) => {
    if (a.startsOn && b.startsOn && a.startsOn !== b.startsOn) return a.startsOn < b.startsOn ? -1 : 1;
    if (a.startsOn && !b.startsOn) return -1;
    if (!a.startsOn && b.startsOn) return 1;
    return b.score - a.score;
  });
}

function isStale(refreshedAt: string | null): boolean {
  if (!refreshedAt) return true;
  return Date.now() - new Date(refreshedAt).getTime() > STALE_MS;
}

export function humanDbError(message: string): string {
  if (/nearby_|does not exist|schema cache/i.test(message)) {
    return "Таблицы ленты ещё нет в базе. Примени миграцию supabase/migrations/021_nearby_events.sql.";
  }
  return message;
}
