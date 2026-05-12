"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Waves,
  CalendarDays,
  Flame,
} from "lucide-react";
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
  fetchPeriodData,
  monthBounds,
  yearBounds,
  type PeriodData,
  type PeriodScope,
} from "@/lib/db/calendarData";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";
import {
  isoLocalDate,
  periodTotals,
  tonnageByWeekday,
  uniqueExerciseNames,
  exerciseDynamics,
  WEEKDAY_RU_LONG,
} from "@/lib/features/workouts/analytics";
import { PeriodSwitcher } from "@/components/calendar/period-switcher";
import { MonthGrid } from "@/components/calendar/month-grid";
import { DayDetail } from "@/components/calendar/day-detail";
import { ExerciseSelector } from "@/components/calendar/exercise-selector";
import { LineChart, type ChartSeries } from "@/components/charts/line-chart";

const EMPTY_DATA: PeriodData = {
  workouts: [],
  gymExercises: [],
  swimSeries: [],
};

const WEEKDAY_COLORS: Record<number, string> = {
  1: "var(--chart-1)",
  2: "var(--chart-2)",
  3: "var(--chart-3)",
  4: "var(--chart-4)",
  5: "var(--chart-5)",
  6: "var(--gym)",
  0: "var(--swim)",
};

function periodLabel(
  scope: PeriodScope,
  year: number,
  monthIdx0: number
): string {
  if (scope === "month") {
    return new Date(year, monthIdx0, 1)
      .toLocaleDateString("ru", { month: "long", year: "numeric" });
  }
  if (scope === "year") return String(year);
  return "Всё время";
}

export function WorkoutCalendarHome() {
  useRegisterPageChatContext(
    "Календарь",
    "Главный экран: календарь тренировок, сводка выбранного периода и переход к дням."
  );

  const today = new Date();
  const [scope, setScope] = useState<PeriodScope>("month");
  const [year, setYear] = useState(today.getFullYear());
  const [monthIdx0, setMonthIdx0] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(isoLocalDate(today));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PeriodData>(EMPTY_DATA);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);

  const [tonnageExercise, setTonnageExercise] = useState<string | null>(null);
  const [weightExercise, setWeightExercise] = useState<string | null>(null);

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
    const res = await fetchPeriodData(user.userId, scope, {
      year,
      monthIdx0,
    });
    if ("error" in res) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setData(res.data);
    setLoading(false);
  }, [scope, year, monthIdx0]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => periodTotals(data), [data]);

  const weekdaySeries = useMemo<ChartSeries[]>(() => {
    const series = tonnageByWeekday(data.workouts);
    return series.map((s) => ({
      id: `wd-${s.weekday}`,
      label: WEEKDAY_RU_LONG[s.weekday],
      color: WEEKDAY_COLORS[s.weekday] ?? "var(--chart-1)",
      points: s.points,
    }));
  }, [data.workouts]);

  const exerciseNames = useMemo(
    () => uniqueExerciseNames(data.gymExercises),
    [data.gymExercises]
  );

  useEffect(() => {
    if (exerciseNames.length === 0) {
      if (tonnageExercise !== null) setTonnageExercise(null);
      if (weightExercise !== null) setWeightExercise(null);
      return;
    }
    if (!tonnageExercise || !exerciseNames.includes(tonnageExercise)) {
      setTonnageExercise(exerciseNames[0]);
    }
    if (!weightExercise || !exerciseNames.includes(weightExercise)) {
      setWeightExercise(exerciseNames[0]);
    }
  }, [exerciseNames, tonnageExercise, weightExercise]);

  const tonnageDyn = useMemo(() => {
    if (!tonnageExercise) return null;
    return exerciseDynamics(tonnageExercise, data.gymExercises, data.workouts);
  }, [tonnageExercise, data.gymExercises, data.workouts]);

  const weightDyn = useMemo(() => {
    if (!weightExercise) return null;
    return exerciseDynamics(weightExercise, data.gymExercises, data.workouts);
  }, [weightExercise, data.gymExercises, data.workouts]);

  function shiftMonth(delta: number) {
    let m = monthIdx0 + delta;
    let y = year;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    setMonthIdx0(m);
    setYear(y);
  }

  function shiftYear(delta: number) {
    setYear(year + delta);
  }

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

  const noData = !loading && totals.workouts === 0;

  const tonnageSeries: ChartSeries[] = tonnageDyn
    ? [
        {
          id: "ex-tonnage",
          label: tonnageExercise ?? "",
          color: "var(--gym)",
          points: tonnageDyn.tonnage,
        },
      ]
    : [];

  const weightSeries: ChartSeries[] = weightDyn
    ? [
        {
          id: "ex-weight",
          label: weightExercise ?? "",
          color: "var(--primary)",
          points: weightDyn.weight,
        },
      ]
    : [];

  const periodTitle = periodLabel(scope, year, monthIdx0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5 text-primary drop-shadow-[0_0_8px_var(--glow-primary)]" />
          <h2 className="text-xl font-semibold text-glow-sm">Спортивный календарь</h2>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodSwitcher scope={scope} onChange={setScope} />
        {scope === "year" && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => shiftYear(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[3rem] text-center text-sm font-medium tabular-nums">
              {year}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => shiftYear(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        {scope === "all" && (
          <span className="text-xs text-muted-foreground">Все тренировки</span>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold tabular-nums">
              {loading ? "…" : totals.workouts.toLocaleString("ru")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">тренировок</p>
            <p className="text-[10px] text-muted-foreground">
              {totals.gymWorkouts} зал · {totals.swimWorkouts} плав
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold tabular-nums">
              {loading ? "…" : Math.round(totals.totalTonnage).toLocaleString("ru")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">кг тоннаж</p>
            <p className="text-[10px] text-muted-foreground capitalize">
              {periodTitle}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-2xl font-bold tabular-nums">
              {loading ? "…" : totals.totalDistance.toLocaleString("ru")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">м метраж</p>
            <p className="text-[10px] text-muted-foreground capitalize">
              {periodTitle}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="flex items-baseline gap-1">
              <Flame className="size-4 text-primary drop-shadow-[0_0_8px_var(--glow-primary)] animate-pulse" />
              <p className="text-2xl font-bold tabular-nums">
                {loading ? "…" : totals.totalCalories.toLocaleString("ru")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">ккал тренировок</p>
            <p className="text-[10px] text-muted-foreground capitalize">
              {periodTitle}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick-add buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/gym"
          className={cn(
            buttonVariants({ size: "lg", variant: "default" }),
            "h-auto py-4 flex-col gap-1 relative overflow-hidden group"
          )}
        >
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          <Dumbbell className="size-5 drop-shadow-[0_0_6px_var(--glow-primary)]" />
          <span>Добавить</span>
          <span className="text-xs opacity-80 font-normal">силовую</span>
        </Link>
        <Link
          href="/swim"
          className={cn(
            buttonVariants({ size: "lg", variant: "outline" }),
            "h-auto py-4 flex-col gap-1 relative overflow-hidden group"
          )}
        >
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-glow-primary/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          <Waves className="size-5 text-swim drop-shadow-[0_0_6px_var(--swim)]" />
          <span>Добавить</span>
          <span className="text-xs opacity-70 font-normal">плавание</span>
        </Link>
      </div>

      {/* Calendar grid: only when scope = month */}
      {scope === "month" && (
        <>
          <MonthGrid
            year={year}
            monthIdx0={monthIdx0}
            workouts={data.workouts}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            onPrev={() => shiftMonth(-1)}
            onNext={() => shiftMonth(1)}
          />
          <DayDetail
            date={selectedDate}
            workouts={data.workouts}
            gymExercises={data.gymExercises}
            swimSeries={data.swimSeries}
          />
        </>
      )}

      {/* Charts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Тоннаж по дням недели</CardTitle>
          <CardDescription>
            Только силовые. Каждый день недели — отдельная серия (динамика общего тоннажа тренировки).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            series={weekdaySeries}
            unit="кг"
            emptyMessage={
              loading
                ? "Загрузка…"
                : "За период не было силовых тренировок"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Динамика тоннажа упражнения</CardTitle>
          <CardDescription>
            Сумма (вес × повторы) на каждой тренировке периода.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ExerciseSelector
            options={exerciseNames}
            value={tonnageExercise}
            onChange={setTonnageExercise}
          />
          <LineChart
            series={tonnageSeries}
            unit="кг"
            emptyMessage={
              loading
                ? "Загрузка…"
                : exerciseNames.length === 0
                  ? "Нет силовых тренировок за период"
                  : "Нет данных по упражнению"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Рабочий вес упражнения</CardTitle>
          <CardDescription>
            Максимальный рабочий вес среди подходов (reps ≥ 1) на каждой тренировке.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ExerciseSelector
            options={exerciseNames}
            value={weightExercise}
            onChange={setWeightExercise}
          />
          <LineChart
            series={weightSeries}
            unit="кг"
            emptyMessage={
              loading
                ? "Загрузка…"
                : exerciseNames.length === 0
                  ? "Нет силовых тренировок за период"
                  : "Нет данных по упражнению"
            }
          />
        </CardContent>
      </Card>

      {/* Empty state with UUID hint */}
      {noData && resolvedUserId && (
        <Card>
          <CardHeader>
            <CardTitle>Нет данных за период</CardTitle>
            <CardDescription>
              В Supabase нет тренировок для этого профиля за «{periodTitle}».
              Сохраните тренировку или выполните офлайн-импорт.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
              <p className="text-xs font-medium text-foreground mb-1">
                Ваш UUID в приложении:
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
                  Не удалось скопировать — выделите UUID вручную.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Period quick-jump */}
      {scope !== "all" && (
        <div className="text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const t = new Date();
              setYear(t.getFullYear());
              setMonthIdx0(t.getMonth());
              if (scope === "month") setSelectedDate(isoLocalDate(t));
            }}
          >
            К текущему {scope === "month" ? "месяцу" : "году"}
          </Button>
        </div>
      )}

      {/* Helper bounds info */}
      {scope === "year" && (
        <p className="text-center text-xs text-muted-foreground">
          {yearBounds(year).start} — {yearBounds(year).end}
        </p>
      )}
      {scope === "month" && (
        <p className="text-center text-xs text-muted-foreground">
          {monthBounds(year, monthIdx0).start} — {monthBounds(year, monthIdx0).end}
        </p>
      )}
    </div>
  );
}
