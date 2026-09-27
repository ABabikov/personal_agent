"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WeekSummary } from "@/lib/features/nutrition/week";

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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
  const scale =
    targetKcal != null && targetKcal > 0
      ? targetKcal
      : Math.max(...week.days.map((day) => day.kcal), 1);
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
        <div className="grid grid-cols-7 gap-1">
          {week.days.map((day) => {
            const over = targetKcal != null && day.kcal > targetKcal && day.kcal > 0;
            const height = day.kcal > 0 ? Math.max(8, Math.min(100, Math.round((day.kcal / scale) * 100))) : 0;
            const selected = day.date === selectedDate;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => onSelect(day.date)}
                className={`rounded-md px-0.5 py-1 text-center ${selected ? "bg-primary/15 ring-1 ring-primary" : ""}`}
              >
                <div className="text-[10px] text-muted-foreground">{day.label}</div>
                <div className="mx-auto flex h-10 w-2 items-end rounded-full bg-muted">
                  <div
                    className={`w-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <div className={`text-[10px] tabular-nums ${over ? "text-destructive" : ""}`}>
                  {day.kcal > 0 ? Math.round(day.kcal) : "—"}
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
      </CardContent>
    </Card>
  );
}
