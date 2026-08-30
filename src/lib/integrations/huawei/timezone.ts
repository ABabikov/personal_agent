/** Календарный день сессии в TZ пользователя (не TZ сервера). */
export function sessionDateInZone(
  iso: string,
  timeZone: string = getHuaweiUserTimeZone()
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function addCalendarDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Candidate journal dates: exact day, then ±1 (для сдвига «записал на соседний день»). */
export function candidateJournalDates(
  startedAtIso: string,
  timeZone?: string
): string[] {
  const exact = sessionDateInZone(startedAtIso, timeZone);
  return [exact, addCalendarDays(exact, -1), addCalendarDays(exact, 1)];
}

export function getHuaweiUserTimeZone(): string {
  return (
    process.env.HUAWEI_USER_TIMEZONE?.trim() ||
    process.env.USER_TIMEZONE?.trim() ||
    "Asia/Novosibirsk"
  );
}
