import { NextResponse } from "next/server";
import { listUnlinkedSessions, listWorkoutsForDate } from "@/lib/integrations/huawei/storage";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";
import { huaweiActivityLabel } from "@/lib/integrations/huawei/activityLabels";
import {
  getHuaweiUserTimeZone,
  sessionDateInZone,
} from "@/lib/integrations/huawei/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = resolveIntegrationUserId(url.searchParams.get("userId"));
  if (!userId) {
    return NextResponse.json({ error: "Нужен userId" }, { status: 400 });
  }

  const tz = getHuaweiUserTimeZone();
  const sessions = await listUnlinkedSessions(userId, 40);
  const enriched = await Promise.all(
    sessions.map(async (s) => {
      const date = sessionDateInZone(s.started_at, tz);
      const mapped = s.activity_type_mapped;
      const workouts =
        mapped === "gym" || mapped === "swim"
          ? await listWorkoutsForDate(userId, date, mapped)
          : [];
      return {
        session: {
          id: s.id,
          startedAt: s.started_at,
          activityTypeRaw: s.activity_type_raw,
          activityTypeMapped: s.activity_type_mapped,
          activityLabel: huaweiActivityLabel(s.activity_type_raw),
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

  const needsJournal = enriched.filter(
    (i) =>
      i.session.activityTypeMapped === "gym" ||
      i.session.activityTypeMapped === "swim"
  );
  const outdoor = enriched.filter(
    (i) => i.session.activityTypeMapped === "other"
  );

  return NextResponse.json({
    items: enriched,
    needsJournal,
    outdoor,
  });
}
