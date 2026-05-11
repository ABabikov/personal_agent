"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dumbbell, Waves, CalendarDays } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import {
  mondaySundayYYYYMMDD,
  aggregateWeekStats,
  fetchWorkoutsInDateRange,
  fetchRecentWorkouts,
  type WorkoutRow,
} from "@/lib/db/listWorkouts";

function formatWorkoutDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("ru", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function workoutSummaryLine(w: WorkoutRow): string {
  if (w.type === "gym" && w.total_tonnage != null) {
    return `${w.total_tonnage.toLocaleString("ru")} кг`;
  }
  if (w.type === "swim" && w.total_distance != null) {
    return `${w.total_distance.toLocaleString("ru")} м`;
  }
  return "";
}

export function WorkoutCalendarHome() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekStats, setWeekStats] = useState({ count: 0, tonnage: 0, distance: 0 });
  const [history, setHistory] = useState<WorkoutRow[]>([]);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setResolvedUserId(null);
      setError(user.error);
      setLoading(false);
      return;
    }
    setResolvedUserId(user.userId);
    const { start, end } = mondaySundayYYYYMMDD();
    const [weekRes, listRes] = await Promise.all([
      fetchWorkoutsInDateRange(user.userId, start, end),
      fetchRecentWorkouts(user.userId),
    ]);
    if ("error" in weekRes) {
      setError(weekRes.error);
      setLoading(false);
      return;
    }
    if ("error" in listRes) {
      setError(listRes.error);
      setLoading(false);
      return;
    }
    setWeekStats(aggregateWeekStats(weekRes.data));
    setHistory(listRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (pathname === "/") void load();
  }, [pathname, load]);

  async function copyUserId() {
    if (!resolvedUserId) return;
    try {
      await navigator.clipboard.writeText(resolvedUserId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setClipboardFailed(true);
      setTimeout(() => setClipboardFailed(false), 4000);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5" />
          <h2 className="text-xl font-semibold">Спортивный календарь</h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Загрузка…" : "Обновить"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold">
              {loading ? "…" : weekStats.count.toLocaleString("ru")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">тренировок</p>
            <p className="text-xs text-muted-foreground">на этой неделе</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold">
              {loading ? "…" : weekStats.tonnage.toLocaleString("ru")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">кг тоннаж</p>
            <p className="text-xs text-muted-foreground">за неделю</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold">
              {loading ? "…" : weekStats.distance.toLocaleString("ru")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">м метраж</p>
            <p className="text-xs text-muted-foreground">за неделю</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/gym"
          className={cn(
            buttonVariants({ size: "lg", variant: "default" }),
            "h-auto py-4 flex-col gap-1"
          )}
        >
          <Dumbbell className="size-5" />
          <span>Добавить</span>
          <span className="text-xs opacity-80 font-normal">силовую</span>
        </Link>
        <Link
          href="/swim"
          className={cn(
            buttonVariants({ size: "lg", variant: "outline" }),
            "h-auto py-4 flex-col gap-1"
          )}
        >
          <Waves className="size-5" />
          <span>Добавить</span>
          <span className="text-xs opacity-70 font-normal">плавание</span>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>История тренировок</CardTitle>
          <CardDescription>
            Здесь отображаются сохранённые в облаке тренировки (до 50 последних по
            дате).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <p className="text-sm text-muted-foreground text-center py-6">Загрузка…</p>
          )}
          {!loading && history.length === 0 && !error && (
            <div className="space-y-4 py-4 text-center text-sm text-muted-foreground">
              <p>
                В Supabase нет тренировок для{" "}
                <strong className="text-foreground">этого</strong> профиля браузера
                (см. UUID ниже).
              </p>
              <p>
                Сохраните тренировку на страницах «Зал» или «Плавание», либо выполните в корне
                проекта офлайн-импорт из CSV в БД:{" "}
                <code className="rounded bg-muted px-1 text-xs text-foreground">
                  npm run seed:supabase
                </code>{" "}
                — с тем же UUID в{" "}
                <code className="rounded bg-muted px-1 text-xs text-foreground">
                  WORKOUT_IMPORT_USER_ID
                </code>{" "}
                /{" "}
                <code className="rounded bg-muted px-1 text-xs text-foreground">
                  NEXT_PUBLIC_WORKOUT_USER_ID
                </code>
                .
              </p>
              {resolvedUserId && (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-left">
                  <p className="text-xs font-medium text-foreground mb-1">
                    Ваш UUID в приложении (должен совпадать с импортом и строкой в БД):
                  </p>
                  <p className="font-mono text-xs break-all text-foreground select-all">
                    {resolvedUserId}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => void copyUserId()}
                  >
                    {copied ? "Скопировано ✓" : "Скопировать UUID"}
                  </Button>
                  {clipboardFailed && (
                    <p className="mt-2 text-xs text-destructive">
                      Не удалось скопировать — выделите UUID выше вручную.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {!loading && history.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {history.map((w) => {
                const summary = workoutSummaryLine(w);
                return (
                  <li
                    key={w.id}
                    className="flex items-center gap-3 px-3 py-3 text-sm bg-card"
                  >
                    {w.type === "gym" ? (
                      <Dumbbell className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Waves className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {w.type === "gym" ? "Силовая" : "Плавание"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatWorkoutDate(w.date)}
                        {summary ? ` · ${summary}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
