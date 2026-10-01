"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WeekSummary } from "@/lib/features/nutrition/week";

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

function rangeLabel(from: string, to: string): string {
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${months[start.getMonth()]}`;
  }
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]}`;
}

export function NutritionWeekCard({
  week,
  targetKcal,
  selectedDate,
  today,
  onSelect,
}: {
  week: WeekSummary;
  targetKcal: number | null;
  selectedDate: string;
  today: string;
  onSelect: (date: string) => void;
}) {
  const scale = Math.max(
    targetKcal ?? 0,
    ...week.days.map((day) => day.kcal),
    ...week.days.map((day) => day.spentKcal ?? 0),
    1
  );
  const thisWeek = today >= week.from && today <= week.to;
  const weightDelta =
    week.weightStartKg != null && week.weightEndKg != null
      ? Math.round((week.weightEndKg - week.weightStartKg) * 10) / 10
      : null;

  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{thisWeek ? "Эта неделя" : "Неделя"}</CardTitle>
        <p className="text-[11px] text-muted-foreground">{rangeLabel(week.from, week.to)}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-primary" />
            съедено
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-300" />
            обмен
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-orange-500" />
            тренировка
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {week.days.map((day) => {
            const over = targetKcal != null && day.kcal > targetKcal && day.kcal > 0;
            const eatenHeight = day.kcal > 0 ? Math.max(8, Math.min(100, Math.round((day.kcal / scale) * 100))) : 0;
            const bmrHeight =
              day.spentKcal != null && week.bmr != null
                ? Math.max(4, Math.min(100, Math.round((week.bmr / scale) * 100)))
                : 0;
            const workoutHeight =
              day.spentKcal != null && day.workoutKcal > 0
                ? Math.max(4, Math.min(100 - bmrHeight, Math.round((day.workoutKcal / scale) * 100)))
                : 0;
            const selected = day.date === selectedDate;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => onSelect(day.date)}
                className={`rounded-md px-0.5 py-1 text-center ${selected ? "bg-primary/15 ring-1 ring-primary" : ""}`}
              >
                <div className="text-[10px] text-muted-foreground">{day.label}</div>
                <div className="flex h-16 items-end justify-center gap-0.5">
                  <div className="flex h-full w-1.5 items-end rounded-full bg-muted">
                    <div
                      className={`w-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
                      style={{ height: `${eatenHeight}%` }}
                    />
                  </div>
                  <div className="flex h-full w-1.5 flex-col justify-end overflow-hidden rounded-full bg-muted">
                    {workoutHeight > 0 ? (
                      <div className="w-full bg-orange-500" style={{ height: `${workoutHeight}%` }} />
                    ) : null}
                    {bmrHeight > 0 ? (
                      <div className="w-full bg-amber-300" style={{ height: `${bmrHeight}%` }} />
                    ) : null}
                  </div>
                </div>
                <div className={`text-[10px] tabular-nums leading-tight ${over ? "text-destructive" : ""}`}>
                  {day.kcal > 0 ? Math.round(day.kcal) : "—"}
                </div>
                <div className="text-[9px] tabular-nums leading-tight text-amber-300">
                  {day.spentKcal != null ? Math.round(day.spentKcal) : ""}
                </div>
              </button>
            );
          })}
        </div>
        {week.average ? (
          <p className="text-xs">
            Среднее по {week.completeDays} {week.completeDays % 10 === 1 && week.completeDays % 100 !== 11 ? "полному дню" : "полным дням"}:{" "}
            {fmt(week.average.kcal)} ккал · Б {fmt(week.average.proteinG)} · Ж {fmt(week.average.fatG)} · У{" "}
            {fmt(week.average.carbsG)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Полных дней пока нет, среднее не считаю.</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Полный день — два приёма и больше. Пустые и незаконченные в среднее не входят.
          {targetKcal != null ? ` Норма дня ${Math.round(targetKcal)} ккал.` : ""}
        </p>
        {week.weightStartKg != null ? (
          <p className="text-xs">
            Вес{" "}
            {week.weightEndKg != null
              ? `${fmt(week.weightStartKg)} → ${fmt(week.weightEndKg)} кг${weightDelta != null ? ` (${weightDelta > 0 ? "+" : ""}${fmt(weightDelta)})` : ""}`
              : `${fmt(week.weightStartKg)} кг`}
          </p>
        ) : null}
        {week.bmr != null && week.spentKcal != null ? (
          <p className="text-xs">
            Ориентир расхода за {week.countedDays} {daysWord(week.countedDays)}: {Math.round(week.spentKcal)} ккал.
            Базовый обмен {week.bmr} × {week.countedDays}
            {week.workoutKcal > 0 ? ` + тренировки ${week.workoutKcal}` : ", тренировок нет"}.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Ориентир расхода не посчитать: в профиле нет данных для базового обмена.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Расход — обмен покоя плюс калории зала и плавания из журнала. В норму еды не входит.
        </p>
      </CardContent>
    </Card>
  );
}
