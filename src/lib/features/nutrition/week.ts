import { isoLocalDate } from "@/lib/features/workouts/analytics";
import { addMacros, emptyMacros, type MacroTotals } from "@/lib/features/nutrition/targets";

/** День входит в среднее, если в нём хотя бы два разных приёма. */
export const COMPLETE_DAY_MIN_SLOTS = 2;

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

export type WeekEntry = {
  eatenOn: string;
  slot: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type WeekDayStat = {
  date: string;
  label: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  slots: number;
  complete: boolean;
  weightKg: number | null;
};

export type WeekSummary = {
  from: string;
  to: string;
  days: WeekDayStat[];
  total: MacroTotals;
  completeDays: number;
  /** Среднее только по полным дням. Пусто, если таких дней нет. */
  average: MacroTotals | null;
  weightStartKg: number | null;
  weightEndKg: number | null;
};

export function weekDates(anchorIso: string): string[] {
  const anchor = new Date(`${anchorIso}T12:00:00`);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return isoLocalDate(day);
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function summarizeWeek(input: {
  anchorIso: string;
  entries: WeekEntry[];
  weights: { date: string; kg: number }[];
}): WeekSummary {
  const dates = weekDates(input.anchorIso);
  const weightByDate = new Map(input.weights.map((row) => [row.date, row.kg]));
  const days: WeekDayStat[] = dates.map((date) => {
    const rows = input.entries.filter((entry) => entry.eatenOn === date);
    const slots = new Set(rows.map((entry) => entry.slot));
    const eaten = rows.reduce(
      (sum, entry) =>
        addMacros(sum, {
          kcal: entry.kcal,
          proteinG: entry.proteinG,
          fatG: entry.fatG,
          carbsG: entry.carbsG,
        }),
      emptyMacros()
    );
    return {
      date,
      label: WEEKDAY_SHORT[new Date(`${date}T12:00:00`).getDay()],
      kcal: eaten.kcal,
      proteinG: eaten.proteinG,
      fatG: eaten.fatG,
      carbsG: eaten.carbsG,
      slots: slots.size,
      complete: slots.size >= COMPLETE_DAY_MIN_SLOTS,
      weightKg: weightByDate.get(date) ?? null,
    };
  });
  const complete = days.filter((day) => day.complete);
  const total = days.reduce(
    (sum, day) => addMacros(sum, { kcal: day.kcal, proteinG: day.proteinG, fatG: day.fatG, carbsG: day.carbsG }),
    emptyMacros()
  );
  const average =
    complete.length === 0
      ? null
      : {
          kcal: Math.round(complete.reduce((sum, day) => sum + day.kcal, 0) / complete.length),
          proteinG: round1(complete.reduce((sum, day) => sum + day.proteinG, 0) / complete.length),
          fatG: round1(complete.reduce((sum, day) => sum + day.fatG, 0) / complete.length),
          carbsG: round1(complete.reduce((sum, day) => sum + day.carbsG, 0) / complete.length),
        };
  const weighed = days.filter((day) => day.weightKg != null);
  return {
    from: dates[0],
    to: dates[6],
    days,
    total,
    completeDays: complete.length,
    average,
    weightStartKg: weighed[0]?.weightKg ?? null,
    weightEndKg: weighed.length > 1 ? (weighed[weighed.length - 1].weightKg ?? null) : null,
  };
}
