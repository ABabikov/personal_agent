/**
 * Парсинг экспортов Google Sheets (CSV): силовые блоки и плавание.
 * Формат описан в docs/features/workout-tracker/plan.md
 */

import type { GymSet } from "../../../types/database";

export type SheetKeyGym = "pn" | "sr" | "pt";
export type SheetKeySwim = "vt" | "cht" | "sb";

export type ParsedGymWorkout = {
  date: string; // ISO YYYY-MM-DD
  bodyWeight: number | null;
  exercises: { name: string; sets: GymSet[]; tonnage: number }[];
  totalTonnage: number | null;
};

export type ParsedSwimSeries = { distance: number; description: string };
export type ParsedSwimWorkout = {
  date: string;
  series: ParsedSwimSeries[];
  totalDistance: number | null;
  durationMinutes: number | null;
};

/** Разбор одной строки CSV с кавычками */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && inQuotes && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseRows(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  return lines.map(splitCsvLine);
}

/** DD.MM.YYYY или D.M.YYYY */
function parseEuDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** MM/DD/YYYY (как в экспорте 04/20/2026) */
function parseUsDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDateCell(cell: string): string | null {
  const t = cell.trim();
  if (!t) return null;
  const eu = parseEuDate(t);
  if (eu) return eu;
  return parseUsDate(t);
}

/** Число: запятая как десятичный разделитель, пробелы внутри */
export function parseFlexibleNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!s || s === "-" || s === "—") return null;
  const m = s.match(/^(\d+\.?\d*)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseNumericCells(cells: string[], from = 1, max = 6): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = from; i < Math.min(cells.length, from + max); i++) {
    const n = parseFlexibleNumber(cells[i] ?? "");
    out.push(n);
  }
  return out;
}

function zipSets(weights: (number | null)[], reps: (number | null)[]): GymSet[] {
  const sets: GymSet[] = [];
  const n = Math.max(weights.length, reps.length);
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? null;
    const r = reps[i] ?? null;
    if (w == null || r == null) continue;
    if (w <= 0 && r <= 0) continue;
    if (r <= 0) continue;
    if (w < 0) continue;
    sets.push({ weight: w, reps: r });
  }
  return sets;
}

function exerciseTonnageLocal(sets: GymSet[]): number {
  return sets.reduce((s, x) => s + x.weight * x.reps, 0);
}

function isSetHeaderRow(cells: string[]): boolean {
  return (
    cells[1]?.trim() === "1" &&
    cells[2]?.trim() === "2" &&
    cells[3]?.trim() === "3"
  );
}

function isNoiseOrTotalRow(cells: string[]): boolean {
  const c0 = cells[0]?.trim().toLowerCase();
  if (c0 === "итог" || c0 === "время") return true;
  const nonEmpty = cells.filter((c) => c.trim() !== "");
  if (nonEmpty.length === 0) return true;
  if (!cells[0]?.trim() && nonEmpty.every((c) => /^\d+\.?\d*$/.test(c.trim()))) {
    const nums = nonEmpty.map((c) => parseFloat(c.replace(",", ".")));
    if (nums.some((n) => n > 50000)) return true;
  }
  return false;
}

function looksLikeExerciseName(cell: string): boolean {
  const t = cell.trim();
  if (!t) return false;
  if (parseDateCell(t)) return false;
  if (/^\d+\.?\d*$/.test(t.replace(",", ".").replace(/\s/g, ""))) return false;
  return /[а-яА-Яa-zA-Z]/.test(t);
}

/**
 * Парсит один CSV силового дня (пн / ср / пт).
 */
export function parseGymCsv(text: string): ParsedGymWorkout[] {
  const rows = parseRows(text);
  const workouts: ParsedGymWorkout[] = [];
  let i = 0;

  while (i < rows.length) {
    const dateIso = parseDateCell(rows[i]?.[0] ?? "");
    if (!dateIso) {
      i++;
      continue;
    }
    i++;
    if (i >= rows.length) break;

    const bodyRow = rows[i] ?? [];
    let bodyWeight: number | null = parseFlexibleNumber(bodyRow[0] ?? "");
    if (!isSetHeaderRow(bodyRow) && bodyWeight == null) {
      bodyWeight = null;
    }
    i++;

    const exercises: { name: string; sets: GymSet[]; tonnage: number }[] = [];

    while (i < rows.length) {
      const cells = rows[i];
      const nextDate = parseDateCell(cells?.[0] ?? "");
      if (nextDate) break;

      if (isNoiseOrTotalRow(cells)) {
        i++;
        continue;
      }

      const c0 = cells[0]?.trim() ?? "";
      if (isSetHeaderRow(cells)) {
        i++;
        continue;
      }

      if (looksLikeExerciseName(c0)) {
        const weights = parseNumericCells(cells, 1, 6);
        i++;
        if (i >= rows.length) break;
        const repCells = rows[i];
        if (parseDateCell(repCells?.[0] ?? "")) {
          i--;
          break;
        }
        const reps = parseNumericCells(repCells, 1, 6);
        i++;
        const sets = zipSets(weights, reps);
        if (sets.length > 0) {
          const tonnage = exerciseTonnageLocal(sets);
          exercises.push({ name: c0, sets, tonnage });
        }
        continue;
      }

      i++;
    }

    if (exercises.length > 0) {
      const totalTonnage = exercises.reduce((s, e) => s + e.tonnage, 0);
      workouts.push({
        date: dateIso,
        bodyWeight,
        exercises,
        totalTonnage: totalTonnage > 0 ? Math.round(totalTonnage * 10) / 10 : null,
      });
    }
  }

  workouts.sort((a, b) => a.date.localeCompare(b.date));
  return workouts;
}

function parseIntStrict(s: string): number | null {
  const m = s.trim().match(/^(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Парсит CSV плавания (вт / чт / сб): блок по дате, серии «описание» + строка «,метры».
 */
export function parseSwimCsv(text: string): ParsedSwimWorkout[] {
  const rows = parseRows(text);
  const workouts: ParsedSwimWorkout[] = [];
  let i = 0;

  while (i < rows.length) {
    const dateIso = parseDateCell(rows[i]?.[0] ?? "");
    if (!dateIso) {
      i++;
      continue;
    }
    i++;

    const series: ParsedSwimSeries[] = [];
    let durationMinutes: number | null = null;
    let pendingDesc: string | null = null;

    while (i < rows.length) {
      const cells = rows[i];
      const nextDate = parseDateCell(cells?.[0] ?? "");
      if (nextDate) break;

      const a0 = cells[0]?.trim() ?? "";
      const a1 = cells[1]?.trim() ?? "";

      if (a0.toLowerCase() === "итог") {
        const td = parseIntStrict(a1);
        if (td != null && td > 0) {
          /* итог — контроль дистанции, не дублируем как серию */
        }
        i++;
        continue;
      }
      if (a0.toLowerCase() === "время") {
        const tm = parseFlexibleNumber(a1);
        if (tm != null) durationMinutes = Math.round(tm);
        i++;
        continue;
      }

      if (!a0 && a1) {
        const dist = parseIntStrict(a1);
        if (dist != null && dist > 0 && pendingDesc) {
          series.push({ distance: dist, description: pendingDesc });
          pendingDesc = null;
        }
        i++;
        continue;
      }

      if (a0 && !parseDateCell(a0)) {
        const distInline = parseIntStrict(a1);
        if (distInline != null && distInline > 0) {
          series.push({ distance: distInline, description: a0 });
          pendingDesc = null;
        } else {
          pendingDesc = a0;
        }
        i++;
        continue;
      }

      i++;
    }

    if (series.length > 0) {
      const totalDistance = series.reduce((s, x) => s + x.distance, 0);
      workouts.push({
        date: dateIso,
        series,
        totalDistance,
        durationMinutes,
      });
    }
  }

  workouts.sort((a, b) => a.date.localeCompare(b.date));
  return workouts;
}

export function lastByDate<T extends { date: string }>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[items.length - 1]!;
}
