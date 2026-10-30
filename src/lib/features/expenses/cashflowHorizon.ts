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
  /**
   * Отток ликвидa: переводы со счетов не-кредитки (гашения / внутрибанк с дебета).
   * Строки на счёте «Карта» не считаем — иначе двойной учёт.
   */
  transfer: number;
  /**
   * Операционный ₽-баланс на конец месяца.
   * `null` для прошлого: абсолют из выписки не восстановить (траты на карте,
   * внутрибанк без открытия) — кривая начинается с текущего месяца.
   */
  balance: number | null;
  /** Нетто месяца по ликвидy: доход − дебет-расход − переводы с дебета */
  liquidNet: number;
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

/**
 * Отток операционного ликвидa: transfer со счёта дебета/кошелька.
 * Не берём строки кредитки (встречная сторона того же перевода).
 */
export function isDebitSideTransfer(
  t: Pick<ExpenseTransactionRow, "kind" | "account_id">,
  creditIds: Set<string>
): boolean {
  return t.kind === "transfer" && !creditIds.has(t.account_id);
}

/** @deprecated use isDebitSideTransfer */
export function isCardPaydownTransfer(
  t: Pick<
    ExpenseTransactionRow,
    "kind" | "account_id" | "description" | "merchant"
  >,
  creditIds: Set<string>
): boolean {
  return isDebitSideTransfer(t, creditIds);
}

/**
 * Окно: `monthsBack` + текущий + `monthsForward`.
 * Столбцы доход/расход — по всем месяцам.
 *
 * Кривая баланса — только с текущего месяца:
 *   текущий = `anchorBalance` (факт операционного ₽-кэша «сейчас», без USD/пассива);
 *   дальше = накопление прогноза (доход − дебет-расход − переводы с дебета).
 * Прошлое: `balance = null` (не выдумываем 1–3 млн из неполных данных).
 */
export function buildCashflowHorizon(
  transactions: ExpenseTransactionRow[],
  options: {
    now?: Date;
    monthsBack?: number;
    monthsForward?: number;
    /** @deprecated не используется для абсолюта прошлого */
    startBalance?: number;
    /** Операционный ликвид «сейчас», ₽ (пассив/USD не включать). По умолчанию 125000. */
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
    const day = t.occurred_at.slice(0, 10);
    // устаревший HOLD в прошлом / прошедших днях текущего — пропускаем
    if (t.pending && (ym < currentYm || day < todayIso)) continue;
    if (t.kind === "income") cur.income += t.amount;
    else if (t.kind === "expense") {
      cur.expense += t.amount;
      if (!creditIds.has(t.account_id)) cur.debitExpense += t.amount;
    } else if (isDebitSideTransfer(t, creditIds)) {
      cur.transfer += t.amount;
    }
  }

  const out: CashflowMonthBucket[] = [];
  let forwardBal: number | null = null;

  for (const ym of months) {
    const cur = map.get(ym)!;
    const liquidNet = cur.income - cur.debitExpense - cur.transfer;
    const isCurrent = ym === currentYm;
    const isForecast = ym > currentYm;

    let balance: number | null = null;
    if (isCurrent) {
      // факт «сейчас» — не восстанавливаем из истории
      forwardBal = anchor;
      balance = forwardBal;
    } else if (isForecast && forwardBal != null) {
      // прогноз: от якоря дальше по плановым потокам месяца
      forwardBal += liquidNet;
      balance = forwardBal;
    }
    // прошлое: balance остаётся null

    out.push({
      ym,
      label: monthLabel(ym).replace(".", ""),
      tooltip: monthTooltip(ym),
      income: cur.income,
      expense: cur.expense,
      transfer: cur.transfer,
      balance,
      liquidNet,
      isCurrent,
      isForecast,
    });
  }

  return out;
}

/** Недельные точки баланса (отладка). Без якоря — только дельты. */
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
