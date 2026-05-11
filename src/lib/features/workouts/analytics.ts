import type { WorkoutRow } from "@/lib/db/listWorkouts";
import type {
  GymExerciseRow,
  SwimSeriesRow,
  PeriodData,
} from "@/lib/db/calendarData";
import type { GymSet } from "@/types/database";

export type WeekdayIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_RU_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;
export const WEEKDAY_RU_LONG = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const;
export const WEEKDAY_LETTER = ["В", "П", "В", "С", "Ч", "П", "С"] as const;

/** Локальный YYYY-MM-DD для Date */
export function isoLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD → JS Date (полдень, чтобы избежать TZ-сдвигов) */
export function dateFromIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function weekdayIdx(iso: string): WeekdayIdx {
  return dateFromIso(iso).getDay() as WeekdayIdx;
}

/** Карта `YYYY-MM-DD` → массив тренировок этого дня */
export function workoutsByDate(workouts: WorkoutRow[]): Map<string, WorkoutRow[]> {
  const map = new Map<string, WorkoutRow[]>();
  for (const w of workouts) {
    const list = map.get(w.date) ?? [];
    list.push(w);
    map.set(w.date, list);
  }
  return map;
}

/** Карта workout_id → детали (упражнения и серии этого id) */
export function gymByWorkout(rows: GymExerciseRow[]): Map<string, GymExerciseRow[]> {
  const map = new Map<string, GymExerciseRow[]>();
  for (const ex of rows) {
    const list = map.get(ex.workout_id) ?? [];
    list.push(ex);
    map.set(ex.workout_id, list);
  }
  return map;
}

export function swimByWorkout(rows: SwimSeriesRow[]): Map<string, SwimSeriesRow[]> {
  const map = new Map<string, SwimSeriesRow[]>();
  for (const s of rows) {
    const list = map.get(s.workout_id) ?? [];
    list.push(s);
    map.set(s.workout_id, list);
  }
  return map;
}

/** Уникальные названия упражнений, отсортированные по убыванию частоты */
export function uniqueExerciseNames(rows: GymExerciseRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.exercise_name, (counts.get(r.exercise_name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0], "ru");
    })
    .map(([name]) => name);
}

export type PeriodTotals = {
  workouts: number;
  gymWorkouts: number;
  swimWorkouts: number;
  totalTonnage: number;
  totalDistance: number;
  totalCalories: number;
};

export function periodTotals(data: PeriodData): PeriodTotals {
  let totalTonnage = 0;
  let totalDistance = 0;
  let totalCalories = 0;
  let gymWorkouts = 0;
  let swimWorkouts = 0;
  for (const w of data.workouts) {
    if (w.type === "gym") {
      gymWorkouts++;
      if (w.total_tonnage != null) totalTonnage += w.total_tonnage;
    } else if (w.type === "swim") {
      swimWorkouts++;
      if (w.total_distance != null) totalDistance += w.total_distance;
    }
    if (w.calories_estimated != null) totalCalories += w.calories_estimated;
  }
  return {
    workouts: data.workouts.length,
    gymWorkouts,
    swimWorkouts,
    totalTonnage: Math.round(totalTonnage * 10) / 10,
    totalDistance,
    totalCalories: Math.round(totalCalories),
  };
}

export type SeriesPoint = { date: string; value: number };
export type WeekdaySeries = { weekday: WeekdayIdx; label: string; points: SeriesPoint[] };

/**
 * Тоннаж тренировки по дням недели (только gym): группировка по weekday →
 * хронологический ряд точек {date, value}.
 */
export function tonnageByWeekday(workouts: WorkoutRow[]): WeekdaySeries[] {
  const buckets = new Map<WeekdayIdx, SeriesPoint[]>();
  for (const w of workouts) {
    if (w.type !== "gym" || w.total_tonnage == null) continue;
    const wd = weekdayIdx(w.date);
    const list = buckets.get(wd) ?? [];
    list.push({ date: w.date, value: w.total_tonnage });
    buckets.set(wd, list);
  }
  const out: WeekdaySeries[] = [];
  for (const [wd, points] of buckets) {
    points.sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      weekday: wd,
      label: WEEKDAY_RU_LONG[wd],
      points,
    });
  }
  out.sort((a, b) => a.weekday - b.weekday);
  return out;
}

/** Максимальный рабочий вес среди подходов с reps ≥ 1 (рабочий вес упражнения) */
export function workingWeight(sets: GymSet[]): number {
  let max = 0;
  for (const s of sets) {
    if (s.reps >= 1 && s.weight > max) max = s.weight;
  }
  return max;
}

export type ExerciseDynamics = {
  /** Тоннаж упражнения на тренировке во времени */
  tonnage: SeriesPoint[];
  /** Рабочий (максимальный) вес упражнения во времени */
  weight: SeriesPoint[];
};

/**
 * Динамика конкретного упражнения по тренировкам периода:
 *   tonnage — сумма weight×reps по подходам;
 *   weight  — максимальный вес среди подходов с reps ≥ 1.
 */
export function exerciseDynamics(
  exerciseName: string,
  exercises: GymExerciseRow[],
  workouts: WorkoutRow[]
): ExerciseDynamics {
  const dateByWorkoutId = new Map<string, string>();
  for (const w of workouts) dateByWorkoutId.set(w.id, w.date);

  const tonnage: SeriesPoint[] = [];
  const weight: SeriesPoint[] = [];

  for (const ex of exercises) {
    if (ex.exercise_name !== exerciseName) continue;
    const date = dateByWorkoutId.get(ex.workout_id);
    if (!date) continue;
    tonnage.push({ date, value: Math.round(ex.tonnage * 10) / 10 });
    const ww = workingWeight(ex.sets);
    if (ww > 0) weight.push({ date, value: ww });
  }

  tonnage.sort((a, b) => a.date.localeCompare(b.date));
  weight.sort((a, b) => a.date.localeCompare(b.date));
  return { tonnage, weight };
}
