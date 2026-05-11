"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkoutRow } from "@/lib/db/listWorkouts";
import { isoLocalDate, workoutsByDate } from "@/lib/features/workouts/analytics";

const WEEKDAY_HEADERS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

interface MonthGridProps {
  year: number;
  monthIdx0: number;
  workouts: WorkoutRow[];
  selectedDate: string | null;
  onSelect: (iso: string) => void;
  onPrev: () => void;
  onNext: () => void;
}

type CellInfo = {
  iso: string | null;
  day: number | null;
  inMonth: boolean;
  hasGym: boolean;
  hasSwim: boolean;
};

function buildGrid(year: number, monthIdx0: number, byDate: Map<string, WorkoutRow[]>): CellInfo[] {
  const first = new Date(year, monthIdx0, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIdx0 + 1, 0).getDate();
  const prevMonthDays = new Date(year, monthIdx0, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const cells: CellInfo[] = [];
  for (let i = 0; i < totalCells; i++) {
    const offset = i - firstWeekday;
    if (offset < 0) {
      const day = prevMonthDays + offset + 1;
      const d = new Date(year, monthIdx0 - 1, day);
      const iso = isoLocalDate(d);
      const list = byDate.get(iso) ?? [];
      cells.push({
        iso,
        day,
        inMonth: false,
        hasGym: list.some((w) => w.type === "gym"),
        hasSwim: list.some((w) => w.type === "swim"),
      });
    } else if (offset >= daysInMonth) {
      const day = offset - daysInMonth + 1;
      const d = new Date(year, monthIdx0 + 1, day);
      const iso = isoLocalDate(d);
      const list = byDate.get(iso) ?? [];
      cells.push({
        iso,
        day,
        inMonth: false,
        hasGym: list.some((w) => w.type === "gym"),
        hasSwim: list.some((w) => w.type === "swim"),
      });
    } else {
      const day = offset + 1;
      const d = new Date(year, monthIdx0, day);
      const iso = isoLocalDate(d);
      const list = byDate.get(iso) ?? [];
      cells.push({
        iso,
        day,
        inMonth: true,
        hasGym: list.some((w) => w.type === "gym"),
        hasSwim: list.some((w) => w.type === "swim"),
      });
    }
  }
  return cells;
}

export function MonthGrid({
  year,
  monthIdx0,
  workouts,
  selectedDate,
  onSelect,
  onPrev,
  onNext,
}: MonthGridProps) {
  const byDate = workoutsByDate(workouts);
  const cells = buildGrid(year, monthIdx0, byDate);
  const today = isoLocalDate(new Date());

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Предыдущий месяц">
          <ChevronLeft className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold capitalize">
          {MONTH_NAMES[monthIdx0]} {year}
        </h3>
        <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Следующий месяц">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {WEEKDAY_HEADERS.map((wd) => (
          <div key={wd} className="py-1">
            {wd}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.iso) return <div key={i} />;
          const isSelected = selectedDate === c.iso;
          const isToday = c.iso === today;
          const hasAny = c.hasGym || c.hasSwim;
          return (
            <button
              key={c.iso + "_" + i}
              type="button"
              onClick={() => onSelect(c.iso!)}
              className={cn(
                "relative aspect-square rounded-md text-xs font-medium transition-colors",
                c.inMonth ? "text-foreground" : "text-muted-foreground/40",
                isSelected
                  ? "bg-primary text-primary-foreground ring-2 ring-primary"
                  : hasAny
                    ? "bg-accent/40 hover:bg-accent"
                    : "hover:bg-muted",
                isToday && !isSelected && "ring-1 ring-primary/60"
              )}
            >
              <span className="absolute inset-x-0 top-1 text-center tabular-nums">
                {c.day}
              </span>
              {hasAny && (
                <span className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-0.5">
                  {c.hasGym && (
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: "var(--gym)" }}
                    />
                  )}
                  {c.hasSwim && (
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: "var(--swim)" }}
                    />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ background: "var(--gym)" }} />
          силовая
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ background: "var(--swim)" }} />
          плавание
        </span>
      </div>
    </div>
  );
}
