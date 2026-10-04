export function moscowToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function moscowMonthYear(iso: string): { month: string; year: string } {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return {
    month: new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(date),
    year: String(year),
  };
}

export type DateRange = { start: string | null; end: string | null };

/** Ближайшая дата события, если оно идёт в окне и не тянется из прошлого сезона. */
export function eventFallsInWindow(ranges: DateRange[], today: string, until: string): string | null {
  const earliestStart = addIsoDays(today, -14);
  let best: string | null = null;
  for (const range of ranges) {
    const start = range.start;
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const end = range.end && /^\d{4}-\d{2}-\d{2}$/.test(range.end) ? range.end : start;
    if (end < today || start > until) continue;
    if (start < earliestStart) continue;
    const shown = start < today ? today : start;
    if (!best || shown < best) best = shown;
  }
  return best;
}

export function mentionsOnlyPastYears(text: string, year: number): boolean {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (years.length === 0) return false;
  return years.every((value) => value < year);
}

export function dateInsideWindow(value: string | null, today: string, until: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const min = addIsoDays(today, -1);
  if (value < min || value > until) return null;
  return value;
}
