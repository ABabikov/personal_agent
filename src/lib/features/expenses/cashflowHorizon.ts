import type { ExpenseTransactionRow } from "@/lib/db/expensesData";

export type CashflowMonthBucket = {
  /** YYYY-MM */
  ym: string;
  label: string;
  tooltip: string;
  income: number;
  expense: number;
  /** Переводы с дебета (без внесения наличных) */
  transfer: number;
  /**
   * Операционный ₽ на конец месяца.
   * Сейчас = якорь; прошлое = оценка назад от якоря; прогноз = вперёд.
   */
  balance: number | null;
  liquidNet: number;
  /** Прошлое, восстановленное по оборотам (не прямой замер) */
  balanceEstimated: boolean;
  isForecast: boolean;
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

/** Внесение наличных на счёт — не отток ликвидa (просто смена формы). */
export function isCashInTransfer(
  t: Pick<ExpenseTransactionRow, "description" | "merchant">
): boolean {
  const h = `${t.description ?? ""} ${t.merchant ?? ""}`.toLowerCase();
  return (
    h.includes("внесение средств") ||
    h.includes("внесение наличных") ||
    h.includes("cashin") ||
    h.includes("через устройство")
  );
}

/**
 * Отток с дебета: transfer не с кредитки и не cash-in.
 */
export function isDebitSideTransfer(
  t: Pick<
    ExpenseTransactionRow,
    "kind" | "account_id" | "description" | "merchant"
  >,
  creditIds: Set<string>
): boolean {
  return (
    t.kind === "transfer" &&
    !creditIds.has(t.account_id) &&
    !isCashInTransfer(t)
  );
}

/** @deprecated */
export function isCardPaydownTransfer(
  t: Pick<
    ExpenseTransactionRow,
    "kind" | "account_id" | "description" | "merchant"
  >,
  creditIds: Set<string>
): boolean {
  return isDebitSideTransfer(t, creditIds);
}

type MonthAcc = {
  income: number;
  expense: number;
  transfer: number;
  /** Доход только на не-кредитных счетах */
  debitIncome: number;
  debitExpense: number;
};

/**
 * Окно: monthsBack + текущий + monthsForward.
 *
 * Баланс:
 * — сейчас = anchorBalance (факт операционного ₽);
 * — прошлое = оценка назад от якоря: доход − расход (все счета;
 *   переводы не двигают оценку — деньги ниоткуда больше не берутся);
 * — прогноз = вперёд от якоря: доход − расход_с_дебета − переводы_с_дебета.
 */
export function buildCashflowHorizon(
  transactions: ExpenseTransactionRow[],
  options: {
    now?: Date;
    monthsBack?: number;
    monthsForward?: number;
    startBalance?: number;
    anchorBalance?: number;
    creditAccountIds?: Iterable<string>;
  } = {}
): CashflowMonthBucket[] {
  const now = options.now ?? new Date();
  const monthsBack = options.monthsBack ?? 12;
  const monthsForward = options.monthsForward ?? 6;
  const creditIds = new Set(options.creditAccountIds ?? []);
  const anchor =
    options.anchorBalance != null && Number.isFinite(options.anchorBalance)
      ? options.anchorBalance
      : 125_000;

  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const first = addMonths(current, -monthsBack);
  const last = addMonths(current, monthsForward);
  const currentYm = ymKey(current);
  const todayIso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const months: string[] = [];
  for (let d = first; d <= last; d = addMonths(d, 1)) {
    months.push(ymKey(d));
  }

  const map = new Map<string, MonthAcc>();
  for (const ym of months) {
    map.set(ym, {
      income: 0,
      expense: 0,
      transfer: 0,
      debitIncome: 0,
      debitExpense: 0,
    });
  }

  const windowStart = `${months[0]}-01T00:00:00`;
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const lastDay = new Date(ly, lm, 0).getDate();
  const windowEnd = `${months[months.length - 1]}-${pad2(lastDay)}T23:59:59`;

  for (const t of transactions) {
    if (t.occurred_at < windowStart || t.occurred_at > windowEnd) continue;
    const ym = t.occurred_at.slice(0, 7);
    const cur = map.get(ym);
    if (!cur) continue;
    const day = t.occurred_at.slice(0, 10);
    if (t.pending && (ym < currentYm || day < todayIso)) continue;

    const onCredit = creditIds.has(t.account_id);
    if (t.kind === "income") {
      cur.income += t.amount;
      if (!onCredit) cur.debitIncome += t.amount;
    } else if (t.kind === "expense") {
      cur.expense += t.amount;
      if (!onCredit) cur.debitExpense += t.amount;
    } else if (isDebitSideTransfer(t, creditIds)) {
      cur.transfer += t.amount;
    }
  }

  /** Нетто месяца для кривой баланса. */
  function liquidNetFor(ym: string, isForecast: boolean): number {
    const cur = map.get(ym)!;
    if (isForecast) {
      // в прогнозе доходы уже на Банк; гашения — отдельным transfer
      return cur.income - cur.debitExpense - cur.transfer;
    }
    // история: только доход − расход (переводы = смена формы, не источник)
    return cur.income - cur.expense;
  }

  const currentIdx = months.indexOf(currentYm);
  const nets = months.map((ym, i) =>
    liquidNetFor(ym, i > currentIdx)
  );

  // Сейчас = якорь; назад — оценка; вперёд — прогноз
  const balances: (number | null)[] = months.map(() => null);
  balances[currentIdx] = anchor;

  for (let i = currentIdx - 1; i >= 0; i--) {
    // end[i] = end[i+1] - net[i+1]
    balances[i] = (balances[i + 1] as number) - nets[i + 1];
  }
  for (let i = currentIdx + 1; i < months.length; i++) {
    balances[i] = (balances[i - 1] as number) + nets[i];
  }

  return months.map((ym, i) => {
    const cur = map.get(ym)!;
    const isCurrent = ym === currentYm;
    const isForecast = ym > currentYm;
    return {
      ym,
      label: monthLabel(ym).replace(".", ""),
      tooltip: monthTooltip(ym),
      income: cur.income,
      expense: cur.expense,
      transfer: cur.transfer,
      balance: balances[i],
      liquidNet: nets[i],
      balanceEstimated: !isCurrent && !isForecast,
      isCurrent,
      isForecast,
    };
  });
}

export function buildWeeklyBalance(
  transactions: ExpenseTransactionRow[],
  options: {
    fromIso: string;
    toIso: string;
    startBalance?: number;
    creditAccountIds?: Iterable<string>;
  }
): {
  weekStart: string;
  balance: number;
  income: number;
  expense: number;
  transfer: number;
}[] {
  const startBalance = options.startBalance ?? 0;
  const creditIds = new Set(options.creditAccountIds ?? []);
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
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  const weeks = new Map<
    string,
    { income: number; expense: number; transfer: number; debitExpense: number }
  >();
  for (const t of txs) {
    const w = weekStartIso(t.occurred_at);
    const cur = weeks.get(w) ?? {
      income: 0,
      expense: 0,
      transfer: 0,
      debitExpense: 0,
    };
    if (t.kind === "income") cur.income += t.amount;
    else if (t.kind === "expense") {
      cur.expense += t.amount;
      if (!creditIds.has(t.account_id)) cur.debitExpense += t.amount;
    } else if (isDebitSideTransfer(t, creditIds)) {
      cur.transfer += t.amount;
    }
    weeks.set(w, cur);
  }

  const keys = [...weeks.keys()].sort();
  let bal = startBalance;
  return keys.map((weekStart) => {
    const cur = weeks.get(weekStart)!;
    bal += cur.income - cur.debitExpense - cur.transfer;
    return {
      weekStart,
      balance: bal,
      income: cur.income,
      expense: cur.expense,
      transfer: cur.transfer,
    };
  });
}
