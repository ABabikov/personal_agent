import { isoLocalDate } from "@/lib/features/workouts/analytics";
import type { ExpenseTransactionRow } from "@/lib/db/expensesData";

/** Локальная календарная дата операции (YYYY-MM-DD). */
export function expenseTransactionLocalDate(t: ExpenseTransactionRow): string {
  return isoLocalDate(new Date(t.occurred_at));
}

/** Группировка по дню; внутри дня — по времени убыв. */
export function groupExpenseTransactionsByDate(
  transactions: ExpenseTransactionRow[]
): Map<string, ExpenseTransactionRow[]> {
  const map = new Map<string, ExpenseTransactionRow[]>();
  for (const t of transactions) {
    const iso = expenseTransactionLocalDate(t);
    const list = map.get(iso) ?? [];
    list.push(t);
    map.set(iso, list);
  }
  for (const [, list] of map) {
    list.sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );
  }
  return map;
}

/** Краткая сводка по дню для индикатора в ячейке календаря. */
export function dayMoneySummary(transactions: ExpenseTransactionRow[]): {
  hasAny: boolean;
  /** Положительное — перевес расходов над доходами за день */
  netOutflow: number;
} {
  let expense = 0;
  let income = 0;
  for (const t of transactions) {
    if (t.kind === "expense") expense += t.amount;
    else if (t.kind === "income") income += t.amount;
  }
  return {
    hasAny: transactions.length > 0,
    netOutflow: expense - income,
  };
}
