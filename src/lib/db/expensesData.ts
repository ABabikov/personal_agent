/**
 * Data layer для страницы /expenses.
 * Загружает счета, категории, транзакции пользователя за период (или всё время)
 * и считает агрегаты, которые нужны для KPI/чартов/таблицы.
 */
import { supabase } from "@/lib/db/supabase";
import type { ExpenseKind } from "@/types/database";

export type ExpensePeriodScope = "month" | "year" | "all";

export type ExpenseAccountRow = {
  id: string;
  name: string;
  currency: string;
  is_archived: boolean;
};

export type ExpenseCategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: ExpenseKind;
  is_archived: boolean;
};

export type ExpenseTransactionRow = {
  id: string;
  occurred_at: string;
  account_id: string;
  category_id: string | null;
  kind: ExpenseKind;
  amount: number;
  currency: string;
  description: string | null;
  merchant: string | null;
  source: string;
  pending: boolean;
};

export type ExpensesData = {
  accounts: ExpenseAccountRow[];
  categories: ExpenseCategoryRow[];
  transactions: ExpenseTransactionRow[];
};

const EMPTY: ExpensesData = { accounts: [], categories: [], transactions: [] };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthIsoBounds(year: number, monthIdx0: number) {
  const start = `${year}-${pad2(monthIdx0 + 1)}-01T00:00:00`;
  const lastDay = new Date(year, monthIdx0 + 1, 0).getDate();
  const end = `${year}-${pad2(monthIdx0 + 1)}-${pad2(lastDay)}T23:59:59`;
  return { start, end };
}

export function yearIsoBounds(year: number) {
  return { start: `${year}-01-01T00:00:00`, end: `${year}-12-31T23:59:59` };
}

export async function fetchExpensesPeriod(
  userId: string,
  scope: ExpensePeriodScope,
  options: { year?: number; monthIdx0?: number } = {}
): Promise<{ data: ExpensesData } | { error: string }> {
  const [aRes, cRes] = await Promise.all([
    supabase
      .from("expense_accounts")
      .select("id, name, currency, is_archived")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("id, parent_id, name, kind, is_archived")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
  ]);
  if (aRes.error) return { error: aRes.error.message };
  if (cRes.error) return { error: cRes.error.message };

  let txQuery = supabase
    .from("expense_transactions")
    .select(
      "id, occurred_at, account_id, category_id, kind, amount, currency, description, merchant, source, pending"
    )
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (scope === "month") {
    const year = options.year ?? new Date().getFullYear();
    const monthIdx0 = options.monthIdx0 ?? new Date().getMonth();
    const { start, end } = monthIsoBounds(year, monthIdx0);
    txQuery = txQuery.gte("occurred_at", start).lte("occurred_at", end);
  } else if (scope === "year") {
    const year = options.year ?? new Date().getFullYear();
    const { start, end } = yearIsoBounds(year);
    txQuery = txQuery.gte("occurred_at", start).lte("occurred_at", end);
  }

  // Postgrest по умолчанию режет 1000 строк — выставляем явный потолок.
  const { data: txData, error: txErr } = await txQuery
    .order("occurred_at", { ascending: false })
    .limit(20000);
  if (txErr) return { error: txErr.message };

  const accounts = (aRes.data ?? []) as ExpenseAccountRow[];
  const categories = (cRes.data ?? []) as ExpenseCategoryRow[];
  const transactions = (txData ?? []).map((r) => ({
    ...r,
    amount: Number(r.amount),
  })) as ExpenseTransactionRow[];

  return { data: { accounts, categories, transactions } };
}

/** Счета и категории без транзакций (лёгкий запрос для справочников). */
export async function fetchExpenseAccountsAndCategories(
  userId: string
): Promise<{ data: Pick<ExpensesData, "accounts" | "categories"> } | { error: string }> {
  const [aRes, cRes] = await Promise.all([
    supabase
      .from("expense_accounts")
      .select("id, name, currency, is_archived")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("id, parent_id, name, kind, is_archived")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
  ]);
  if (aRes.error) return { error: aRes.error.message };
  if (cRes.error) return { error: cRes.error.message };
  return {
    data: {
      accounts: (aRes.data ?? []) as ExpenseAccountRow[],
      categories: (cRes.data ?? []) as ExpenseCategoryRow[],
    },
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Транзакции за интервал дат [startIsoDate; endIsoDate], формат YYYY-MM-DD. */
export async function fetchExpensesBetween(
  userId: string,
  startIsoDate: string,
  endIsoDate: string
): Promise<{ data: ExpensesData } | { error: string }> {
  if (!ISO_DATE.test(startIsoDate) || !ISO_DATE.test(endIsoDate)) {
    return { error: "Даты должны быть в формате YYYY-MM-DD." };
  }
  if (startIsoDate > endIsoDate) {
    return { error: "start_date не может быть позже end_date." };
  }
  const start = `${startIsoDate}T00:00:00`;
  const end = `${endIsoDate}T23:59:59`;

  const [aRes, cRes] = await Promise.all([
    supabase
      .from("expense_accounts")
      .select("id, name, currency, is_archived")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("id, parent_id, name, kind, is_archived")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
  ]);
  if (aRes.error) return { error: aRes.error.message };
  if (cRes.error) return { error: cRes.error.message };

  const { data: txData, error: txErr } = await supabase
    .from("expense_transactions")
    .select(
      "id, occurred_at, account_id, category_id, kind, amount, currency, description, merchant, source, pending"
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("occurred_at", start)
    .lte("occurred_at", end)
    .order("occurred_at", { ascending: false })
    .limit(20000);
  if (txErr) return { error: txErr.message };

  const accounts = (aRes.data ?? []) as ExpenseAccountRow[];
  const categories = (cRes.data ?? []) as ExpenseCategoryRow[];
  const transactions = (txData ?? []).map((r) => ({
    ...r,
    amount: Number(r.amount),
  })) as ExpenseTransactionRow[];

  return { data: { accounts, categories, transactions } };
}

// ============================================================================
// Aggregations
// ============================================================================

export type ExpensesTotals = {
  expense: number;
  income: number;
  withdrawal: number;
  net: number;
  count: number;
};

export function totals(transactions: ExpenseTransactionRow[]): ExpensesTotals {
  let expense = 0;
  let income = 0;
  let withdrawal = 0;
  for (const t of transactions) {
    if (t.kind === "expense") expense += t.amount;
    else if (t.kind === "income") income += t.amount;
    else if (t.kind === "withdrawal") withdrawal += t.amount;
  }
  return {
    expense,
    income,
    withdrawal,
    net: income - expense,
    count: transactions.length,
  };
}

export type CategoryAggregate = {
  /** id parent-категории, для группировки на пайчарте */
  parentCategoryId: string;
  parentCategoryName: string;
  amount: number;
  share: number;
  txCount: number;
};

/** Группирует расходы по верхнеуровневой категории (по `parent_id` → если null, то по самой категории). */
export function expensesByParentCategory(
  transactions: ExpenseTransactionRow[],
  categories: ExpenseCategoryRow[]
): CategoryAggregate[] {
  const byId = new Map<string, ExpenseCategoryRow>();
  for (const c of categories) byId.set(c.id, c);

  const parentOf = (cat: ExpenseCategoryRow): ExpenseCategoryRow => {
    if (cat.parent_id == null) return cat;
    const p = byId.get(cat.parent_id);
    return p ?? cat;
  };

  const acc = new Map<string, CategoryAggregate>();
  let total = 0;

  for (const t of transactions) {
    if (t.kind !== "expense") continue;
    if (!t.category_id) continue;
    const cat = byId.get(t.category_id);
    if (!cat) continue;
    const parent = parentOf(cat);
    const cur = acc.get(parent.id) ?? {
      parentCategoryId: parent.id,
      parentCategoryName: parent.name,
      amount: 0,
      share: 0,
      txCount: 0,
    };
    cur.amount += t.amount;
    cur.txCount += 1;
    total += t.amount;
    acc.set(parent.id, cur);
  }

  const list = Array.from(acc.values());
  for (const a of list) a.share = total > 0 ? a.amount / total : 0;
  list.sort((a, b) => b.amount - a.amount);
  return list;
}

export type MonthlyBucket = {
  /** "YYYY-MM" */
  ym: string;
  expense: number;
  income: number;
};

export function monthlyBuckets(
  transactions: ExpenseTransactionRow[]
): MonthlyBucket[] {
  const map = new Map<string, MonthlyBucket>();
  for (const t of transactions) {
    if (t.kind !== "expense" && t.kind !== "income") continue;
    const ym = t.occurred_at.slice(0, 7);
    const cur = map.get(ym) ?? { ym, expense: 0, income: 0 };
    if (t.kind === "expense") cur.expense += t.amount;
    else cur.income += t.amount;
    map.set(ym, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym));
}

/**
 * Топ описаний/мерчантов по сумме расхода. Используем merchant если задан,
 * иначе description, иначе "(без описания)".
 */
export type MerchantAggregate = {
  key: string;
  amount: number;
  txCount: number;
};

export function topMerchants(
  transactions: ExpenseTransactionRow[],
  limit = 10
): MerchantAggregate[] {
  const map = new Map<string, MerchantAggregate>();
  for (const t of transactions) {
    if (t.kind !== "expense") continue;
    const key =
      (t.merchant && t.merchant.trim()) ||
      (t.description && t.description.trim()) ||
      "(без описания)";
    const cur = map.get(key) ?? { key, amount: 0, txCount: 0 };
    cur.amount += t.amount;
    cur.txCount += 1;
    map.set(key, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function formatRub(n: number): string {
  return `${Math.round(n).toLocaleString("ru")} ₽`;
}

export function formatRubFractional(n: number): string {
  return `${(Math.round(n * 100) / 100).toLocaleString("ru", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

export function formatYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("ru", {
    month: "short",
    year: "2-digit",
  });
}
