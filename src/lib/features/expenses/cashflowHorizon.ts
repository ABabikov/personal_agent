import type { ExpenseTransactionRow } from "@/lib/db/expensesData";

export type CashflowMonthBucket = {
  /** YYYY-MM */
  ym: string;
  /** Короткий ярлык оси, напр. «окт» */
  label: string;
  /** Полная подпись тултипа */
  tooltip: string;
  income: number;
  expense: number;
  /** Переводы/гашения — отток с дебета */
  transfer: number;
  /** Накопительный баланс на конец месяца */
  balance: number;
  /** Месяц строго после текущего календарного */
  isForecast: boolean;
  /** Текущий календарный месяц */
  isCurrent: boolean;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ru", { month: "short" });
}

function monthTooltip(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ru", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Окно: `monthsBack` полных месяцев назад + текущий + `monthsForward` вперёд.
 * Столбцы: все доходы/расходы.
 * Баланс (ликвид): доход − расход с дебета − переводы; карта в баланс не входит.
 * HOLD/прогноз с текущего дня — «вперёд».
 */
export function buildCashflowHorizon(
  transactions: ExpenseTransactionRow[],
  options: {
    now?: Date;
    monthsBack?: number;
    monthsForward?: number;
    startBalance?: number;
    /** Счета кредитки — их expense не уменьшает кривую баланса */
    creditAccountIds?: Iterable<string>;
  } = {}
): CashflowMonthBucket[] {
  const now = options.now ?? new Date();
  const monthsBack = options.monthsBack ?? 12;
  const monthsForward = options.monthsForward ?? 6;
  const startBalance = options.startBalance ?? 0;
  const creditIds = new Set(options.creditAccountIds ?? []);

  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const first = addMonths(current, -monthsBack);
  const last = addMonths(current, monthsForward);
  const currentYm = ymKey(current);
  const todayIso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const months: string[] = [];
  for (let d = first; d <= last; d = addMonths(d, 1)) {
    months.push(ymKey(d));
  }

  const map = new Map<
    string,
    { income: number; expense: number; transfer: number; debitExpense: number }
  >();
  for (const ym of months)
    map.set(ym, { income: 0, expense: 0, transfer: 0, debitExpense: 0 });

  const windowStart = `${months[0]}-01T00:00:00`;
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const lastDay = new Date(ly, lm, 0).getDate();
  const windowEnd = `${months[months.length - 1]}-${pad2(lastDay)}T23:59:59`;

  for (const t of transactions) {
    if (t.occurred_at < windowStart || t.occurred_at > windowEnd) continue;
    const ym = t.occurred_at.slice(0, 7);
    const cur = map.get(ym);
    if (!cur) continue;
    // прошлые месяцы и прошедшие дни текущего — только факт (без устаревшего HOLD)
    const day = t.occurred_at.slice(0, 10);
    if (t.pending && (ym < currentYm || day < todayIso)) continue;
    if (t.kind === "income") cur.income += t.amount;
    else if (t.kind === "expense") {
      cur.expense += t.amount;
      if (!creditIds.has(t.account_id)) cur.debitExpense += t.amount;
    } else if (t.kind === "transfer") cur.transfer += t.amount;
    // withdrawal не трогаем — смена формы денег
  }

  let bal = startBalance;
  const out: CashflowMonthBucket[] = [];
  for (const ym of months) {
    const cur = map.get(ym)!;
    bal += cur.income - cur.debitExpense - cur.transfer;
    out.push({
      ym,
      label: monthLabel(ym).replace(".", ""),
      tooltip: monthTooltip(ym),
      income: cur.income,
      expense: cur.expense,
      transfer: cur.transfer,
      balance: bal,
      isCurrent: ym === currentYm,
      isForecast: ym > currentYm,
    });
  }
  return out;
}

/** Недельные точки баланса по транзакциям (для ответа / отладки). */
export function buildWeeklyBalance(
  transactions: ExpenseTransactionRow[],
  options: { fromIso: string; toIso: string; startBalance?: number }
): { weekStart: string; balance: number; income: number; expense: number; transfer: number }[] {
  const startBalance = options.startBalance ?? 0;
  const txs = transactions
    .filter(
      (t) =>
        t.occurred_at >= options.fromIso &&
        t.occurred_at <= options.toIso &&
        (t.kind === "income" || t.kind === "expense" || t.kind === "transfer")
    )
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  function weekStartIso(iso: string): string {
    const d = new Date(iso.slice(0, 10) + "T12:00:00");
    const day = (d.getDay() + 6) % 7; // пн=0
    d.setDate(d.getDate() - day);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  const weeks = new Map<
    string,
    { income: number; expense: number; transfer: number }
  >();
  for (const t of txs) {
    const w = weekStartIso(t.occurred_at);
    const cur = weeks.get(w) ?? { income: 0, expense: 0, transfer: 0 };
    if (t.kind === "income") cur.income += t.amount;
    else if (t.kind === "expense") cur.expense += t.amount;
    else cur.transfer += t.amount;
    weeks.set(w, cur);
  }

  const keys = [...weeks.keys()].sort();
  let bal = startBalance;
  return keys.map((weekStart) => {
    const cur = weeks.get(weekStart)!;
    bal += cur.income - cur.expense - cur.transfer;
    return { weekStart, balance: bal, ...cur };
  });
}
