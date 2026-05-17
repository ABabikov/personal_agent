import { NextResponse } from "next/server";
import { listUnlinkedSessions, listWorkoutsForDate } from "@/lib/integrations/huawei/storage";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = resolveIntegrationUserId(url.searchParams.get("userId"));
  if (!userId) {
    return NextResponse.json({ error: "Нужен userId" }, { status: 400 });
  }

  const sessions = await listUnlinkedSessions(userId, 20);
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const date = localDateKey(s.started_at);
      const workouts = await listWorkoutsForDate(
        userId,
        date,
        s.activity_type_mapped === "gym" || s.activity_type_mapped === "swim"
          ? s.activity_type_mapped
          : undefined
      );
      return {
        session: {
          id: s.id,
          startedAt: s.started_at,
          activityTypeRaw: s.activity_type_raw,
          activityTypeMapped: s.activity_type_mapped,
          caloriesDevice: s.calories_device,
          avgHeartRate: s.avg_heart_rate,
          durationSeconds: s.duration_seconds,
        },
        candidateWorkouts: workouts.map((w) => ({
          id: w.id,
          date: w.date,
          type: w.type,
          caloriesEstimated: w.calories_estimated,
        })),
      };
    })
  );

  return NextResponse.json({ items: enriched });
}
