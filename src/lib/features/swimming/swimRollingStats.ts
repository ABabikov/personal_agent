import { fetchWorkoutsInDateRange } from "@/lib/db/listWorkouts";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Последние 28 дней включительно (как «4 недели» в карточке плана). */
export function rolling28DayRangeFrom(ref: Date = new Date()) {
  const endStr = `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`;
  const start = new Date(ref);
  start.setDate(start.getDate() - 27);
  const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return { startStr, endStr };
}

export async function swimMetersRolling28Days(
  userId: string,
  ref: Date = new Date()
): Promise<
  { data: { totalM: number; avgWeeklyM: number } } | { error: string }
> {
  const { startStr, endStr } = rolling28DayRangeFrom(ref);
  const res = await fetchWorkoutsInDateRange(userId, startStr, endStr);
  if ("error" in res) return res;
  let swimM = 0;
  for (const w of res.data) {
    if (w.type === "swim" && w.total_distance != null) {
      swimM += w.total_distance;
    }
  }
  return { data: { totalM: swimM, avgWeeklyM: Math.round(swimM / 4) } };
}
