import { supabase } from "@/lib/db/supabase";
import type { Database } from "@/types/database";

export type WorkoutRow = Database["public"]["Tables"]["workouts"]["Row"];

/** Понедельник–воскресенье текущей календарной недели (локальное время). */
export function mondaySundayYYYYMMDD(ref: Date = new Date()) {
  const d = new Date(ref);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (x: Date) =>
    `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return { start: ymd(monday), end: ymd(sunday) };
}

export function aggregateWeekStats(rows: WorkoutRow[]) {
  let tonnage = 0;
  let distance = 0;
  for (const w of rows) {
    if (w.type === "gym" && w.total_tonnage != null) tonnage += w.total_tonnage;
    if (w.type === "swim" && w.total_distance != null) distance += w.total_distance;
  }
  return {
    count: rows.length,
    tonnage: Math.round(tonnage * 10) / 10,
    distance,
  };
}

export async function fetchWorkoutsInDateRange(
  userId: string,
  start: string,
  end: string
): Promise<{ data: WorkoutRow[] } | { error: string }> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };
  return { data: data ?? [] };
}

export async function fetchRecentWorkouts(
  userId: string,
  limit = 50
): Promise<{ data: WorkoutRow[] } | { error: string }> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { error: error.message };
  return { data: data ?? [] };
}
