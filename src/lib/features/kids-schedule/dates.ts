import { APP_TZ, WEEKDAYS } from "./config";

function partsInTz(date: Date, timeZone = APP_TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return bag;
}

const WEEKDAY_FROM_SHORT: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function todayInfo(now = new Date()) {
  const bag = partsInTz(now);
  const weekday = WEEKDAY_FROM_SHORT[bag.weekday] ?? 1;
  const iso = `${bag.year}-${bag.month}-${bag.day}`;
  return { weekday, iso };
}

export function weekdayFromIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return todayInfo(new Date(Date.UTC(y, m - 1, d, 12))).weekday;
}

export function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days, 12));
  return next.toISOString().slice(0, 10);
}

export function weekStartMonday(iso: string) {
  return addDaysIso(iso, -(weekdayFromIso(iso) - 1));
}

export function formatLongDate(iso: string) {
  const weekday = WEEKDAYS[weekdayFromIso(iso) - 1];
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  const monthName = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    timeZone: "UTC",
  }).format(utc);
  return `${weekday.full}, ${d} ${monthName}`;
}

export function hhmm(value: string) {
  return value.slice(0, 5);
}
