"use client";

import Link from "next/link";
import { ChevronRight, Dumbbell, Waves, Flame } from "lucide-react";
import type { WorkoutRow } from "@/lib/db/listWorkouts";
import type {
  GymExerciseRow,
  SwimSeriesRow,
} from "@/lib/db/calendarData";
import {
  WEEKDAY_RU_LONG,
  weekdayIdx,
  dateFromIso,
  gymByWorkout,
  swimByWorkout,
} from "@/lib/features/workouts/analytics";

interface DayDetailProps {
  date: string;
  workouts: WorkoutRow[];
  gymExercises: GymExerciseRow[];
  swimSeries: SwimSeriesRow[];
}

function formatLong(iso: string) {
  return dateFromIso(iso).toLocaleDateString("ru", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function DayDetail({
  date,
  workouts,
  gymExercises,
  swimSeries,
}: DayDetailProps) {
  const day = workouts.filter((w) => w.date === date);
  const gymMap = gymByWorkout(gymExercises);
  const swimMap = swimByWorkout(swimSeries);
  const wd = WEEKDAY_RU_LONG[weekdayIdx(date)];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold capitalize">{formatLong(date)}</h3>
        <span className="text-xs text-muted-foreground capitalize">{wd}</span>
      </div>

      {day.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          В этот день тренировок не было.
        </p>
      )}

      <div className="space-y-3">
        {day.map((w) => {
          const editHref =
            w.type === "gym" ? `/gym?edit=${w.id}` : `/swim?edit=${w.id}`;

          if (w.type === "gym") {
            const rows = gymMap.get(w.id) ?? [];
            return (
              <Link
                key={w.id}
                href={editHref}
                className="block rounded-lg border border-border bg-background/40 p-3 transition-colors hover:bg-accent/50 active:scale-[0.99]"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md bg-gym/15 text-gym">
                    <Dumbbell className="size-3.5" />
                  </div>
                  <span className="text-sm font-medium">Силовая</span>
                  <div className="ml-auto flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                    {w.total_tonnage != null && (
                      <span>
                        {Math.round(w.total_tonnage).toLocaleString("ru")} кг
                      </span>
                    )}
                    {w.calories_estimated != null && (
                      <span className="inline-flex items-center gap-0.5 text-primary">
                        <Flame className="size-3" />
                        {Math.round(w.calories_estimated).toLocaleString("ru")}{" "}
                        ккал
                      </span>
                    )}
                    <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                  </div>
                </div>
                {w.body_weight != null && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Вес тела: {w.body_weight} кг
                  </p>
                )}
                <ul className="space-y-1.5 text-xs">
                  {rows.map((ex) => (
                    <li
                      key={ex.id}
                      className="flex flex-wrap items-baseline gap-x-2"
                    >
                      <span className="font-medium text-foreground">
                        {ex.exercise_name}
                      </span>
                      <span className="text-muted-foreground">
                        {ex.sets
                          .map((s) => `${s.weight}×${s.reps}`)
                          .join(" · ")}
                      </span>
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {Math.round(ex.tonnage).toLocaleString("ru")} кг
                      </span>
                    </li>
                  ))}
                </ul>
                {w.notes && (
                  <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    {w.notes}
                  </p>
                )}
              </Link>
            );
          }
          if (w.type === "swim") {
            const rows = swimMap.get(w.id) ?? [];
            return (
              <Link
                key={w.id}
                href={editHref}
                className="block rounded-lg border border-border bg-background/40 p-3 transition-colors hover:bg-accent/50 active:scale-[0.99]"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md bg-swim/15 text-swim">
                    <Waves className="size-3.5" />
                  </div>
                  <span className="text-sm font-medium">Плавание</span>
                  <div className="ml-auto flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                    {w.total_distance != null && (
                      <span>{w.total_distance.toLocaleString("ru")} м</span>
                    )}
                    {w.calories_estimated != null && (
                      <span className="inline-flex items-center gap-0.5 text-primary">
                        <Flame className="size-3" />
                        {Math.round(w.calories_estimated).toLocaleString("ru")}{" "}
                        ккал
                      </span>
                    )}
                    <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                  </div>
                </div>
                <ul className="space-y-1.5 text-xs">
                  {rows.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-baseline gap-x-2"
                    >
                      <span className="font-medium tabular-nums text-foreground">
                        {s.distance} м
                      </span>
                      <span className="text-muted-foreground">
                        {s.description}
                      </span>
                    </li>
                  ))}
                </ul>
                {w.notes && (
                  <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    {w.notes}
                  </p>
                )}
              </Link>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
