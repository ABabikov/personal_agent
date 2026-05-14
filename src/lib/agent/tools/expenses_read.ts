/**
 * Тулы для раздела «Финансы»: сводки, расходы по категориям, список операций, справочник категорий.
 * Только чтение из БД (запись операций и категорий — через UI).
 */

import type { AgentTool } from "@/lib/agent/tools/types";
import type { ExpenseKind } from "@/types/database";
import {
  fetchExpensesPeriod,
  fetchExpensesBetween,
  fetchExpenseAccountsAndCategories,
  totals,
  expensesByParentCategory,
  topMerchants,
  type ExpensePeriodScope,
  type ExpensesData,
} from "@/lib/db/expensesData";

function parseExpenseScope(args: Record<string, unknown>): {
  scope: ExpensePeriodScope;
  year?: number;
  monthIdx0?: number;
} {
  const scope = (args.scope === "year" || args.scope === "all" ? args.scope : "month") as ExpensePeriodScope;
  const year = typeof args.year === "number" ? args.year : undefined;
  const month = typeof args.month === "number" ? args.month : undefined;
  const monthIdx0 = month != null ? Math.max(0, Math.min(11, month - 1)) : undefined;
  return { scope, year, monthIdx0 };
}

async function loadExpensesData(
  userId: string,
  args: Record<string, unknown>
): Promise<{ data: ExpensesData } | { error: string }> {
  const start = typeof args.start_date === "string" ? args.start_date.trim() : "";
  const end = typeof args.end_date === "string" ? args.end_date.trim() : "";
  if (start || end) {
    if (!start || !end) {
      return {
        error: "Для диапазона укажите оба параметра: start_date и end_date (формат YYYY-MM-DD).",
      };
    }
    return fetchExpensesBetween(userId, start, end);
  }
  const { scope, year, monthIdx0 } = parseExpenseScope(args);
  return fetchExpensesPeriod(userId, scope, { year, monthIdx0 });
}

function periodDescription(args: Record<string, unknown>): string {
  const start = typeof args.start_date === "string" ? args.start_date.trim() : "";
  const end = typeof args.end_date === "string" ? args.end_date.trim() : "";
  if (start && end) return `с ${start} по ${end}`;
  const { scope, year, monthIdx0 } = parseExpenseScope(args);
  const y = year ?? new Date().getFullYear();
  if (scope === "all") return "за всё время";
  if (scope === "year") return `за календарный год ${y}`;
  const m = (monthIdx0 ?? new Date().getMonth()) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function totalsByAccount(data: ExpensesData) {
  const nameById = new Map(data.accounts.map((a) => [a.id, a.name]));
  type Row = {
    account_id: string;
    account_name: string;
    expense: number;
    income: number;
    withdrawal: number;
    transfer: number;
  };
  const m = new Map<string, Row>();
  for (const t of data.transactions) {
    const nm = nameById.get(t.account_id) ?? "неизвестный счёт";
    const row =
      m.get(t.account_id) ??
      ({
        account_id: t.account_id,
        account_name: nm,
        expense: 0,
        income: 0,
        withdrawal: 0,
        transfer: 0,
      } satisfies Row);
    if (t.kind === "expense") row.expense += t.amount;
    else if (t.kind === "income") row.income += t.amount;
    else if (t.kind === "withdrawal") row.withdrawal += t.amount;
    else row.transfer += t.amount;
    m.set(t.account_id, row);
  }
  return Array.from(m.values()).sort((a, b) => a.account_name.localeCompare(b.account_name, "ru"));
}

function categoryLabel(categoryId: string | null, categories: ExpensesData["categories"]): string {
  if (!categoryId) return "—";
  const byId = new Map(categories.map((c) => [c.id, c]));
  const cat = byId.get(categoryId);
  if (!cat) return "—";
  const parent = cat.parent_id ? byId.get(cat.parent_id) : null;
  return parent ? `${parent.name} / ${cat.name}` : cat.name;
}

const KIND_RU: Record<ExpenseKind, string> = {
  expense: "расход",
  income: "доход",
  withdrawal: "снятие",
  transfer: "перевод",
};

export const getExpensesSummaryTool: AgentTool = {
  name: "get_expenses_summary",
  description: [
    "Финансы пользователя: сводка за период — суммарный расход, доход, снятия, баланс (доход минус расход),",
    "число операций; разбивка по счетам; топ мест/описаний расходов (по сумме).",
    "Период: либо scope month/year/all (+ year, month 1..12), либо произвольный диапазон start_date и end_date (YYYY-MM-DD).",
    "Если year/month не заданы при scope=month — текущий календарный месяц.",
    "Кейсы: «сколько я потратил в мае», «доходы и расходы за год», «баланс за неделю» (через даты).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["month", "year", "all"],
        description: "Игнорируется, если заданы start_date и end_date. По умолчанию month.",
      },
      year: { type: "integer", description: "Календарный год (для month/year)" },
      month: { type: "integer", minimum: 1, maximum: 12, description: "1=январь (только для scope=month)" },
      start_date: { type: "string", description: "YYYY-MM-DD — начало диапазона" },
      end_date: { type: "string", description: "YYYY-MM-DD — конец диапазона включительно" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const r = await loadExpensesData(ctx.userId, args);
    if ("error" in r) return { ok: false, error: r.error };
    const t = totals(r.data.transactions);
    const top = topMerchants(r.data.transactions, 8);
    return {
      ok: true,
      data: {
        period: periodDescription(args),
        totals: {
          expense_rub: t.expense,
          income_rub: t.income,
          withdrawal_rub: t.withdrawal,
          net_rub: t.net,
          operations: t.count,
        },
        by_account: totalsByAccount(r.data),
        top_expense_places: top.map((x) => ({
          label: x.key,
          amount_rub: x.amount,
          operations: x.txCount,
        })),
      },
    };
  },
};

export const getExpensesCategoryBreakdownTool: AgentTool = {
  name: "get_expenses_category_breakdown",
  description: [
    "Расходы за период, сгруппированные по верхнеуровневой категории (как на экране «Финансы»).",
    "Только операции kind=expense с назначенной категорией. Доли share от суммы всех таких расходов.",
    "Те же параметры периода, что у get_expenses_summary (scope/year/month или start_date/end_date).",
    "Кейсы: «на что ушло больше всего», «доля продуктов в расходах за месяц».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["month", "year", "all"] },
      year: { type: "integer" },
      month: { type: "integer", minimum: 1, maximum: 12 },
      start_date: { type: "string" },
      end_date: { type: "string" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const r = await loadExpensesData(ctx.userId, args);
    if ("error" in r) return { ok: false, error: r.error };
    const rows = expensesByParentCategory(r.data.transactions, r.data.categories);
    return {
      ok: true,
      data: {
        period: periodDescription(args),
        categories: rows.map((b) => ({
          parent_category: b.parentCategoryName,
          amount_rub: b.amount,
          share: b.share,
          operations: b.txCount,
        })),
      },
    };
  },
};

export const listExpenseTransactionsTool: AgentTool = {
  name: "list_expense_transactions",
  description: [
    "Список операций (доход/расход/снятие/перевод) за период, новые сверху.",
    "Каждая строка: дата-время, сумма, тип, счёт, категория (человекочитаемо), описание, источник (manual, bank_sber, …).",
    "Параметры периода — как у get_expenses_summary. limit по умолчанию 40, максимум 150.",
    "Опционально kind фильтрует по типу; search — подстрока в описании или месте (без учёта регистра).",
    "Кейсы: «покажи последние траты», «что приходило доходом в апреле», «операции по Сберу за неделю».",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["month", "year", "all"] },
      year: { type: "integer" },
      month: { type: "integer", minimum: 1, maximum: 12 },
      start_date: { type: "string" },
      end_date: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 150, description: "По умолчанию 40" },
      kind: {
        type: "string",
        enum: ["expense", "income", "withdrawal", "transfer", "all"],
        description: "По умолчанию all",
      },
      search: { type: "string", description: "Подстрока в описании или merchant" },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const r = await loadExpensesData(ctx.userId, args);
    if ("error" in r) return { ok: false, error: r.error };
    const limit =
      typeof args.limit === "number" ? Math.min(150, Math.max(1, Math.floor(args.limit))) : 40;
    const kindFilter =
      args.kind === "expense" ||
      args.kind === "income" ||
      args.kind === "withdrawal" ||
      args.kind === "transfer"
        ? args.kind
        : "all";
    const q = typeof args.search === "string" ? args.search.trim().toLowerCase() : "";

    const accountById = new Map(r.data.accounts.map((a) => [a.id, a.name]));
    let list = r.data.transactions;
    if (kindFilter !== "all") {
      list = list.filter((t) => t.kind === kindFilter);
    }
    if (q.length > 0) {
      list = list.filter((t) => {
        const hay = `${t.description ?? ""} ${t.merchant ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const sliced = list.slice(0, limit);
    return {
      ok: true,
      data: {
        period: periodDescription(args),
        returned: sliced.length,
        truncated_total_matching: list.length,
        transactions: sliced.map((t) => ({
          id: t.id,
          occurred_at: t.occurred_at,
          kind: t.kind,
          kind_ru: KIND_RU[t.kind],
          amount_rub: t.amount,
          account: accountById.get(t.account_id) ?? t.account_id,
          category: categoryLabel(t.category_id, r.data.categories),
          description: t.description,
          merchant: t.merchant,
          source: t.source,
          pending: t.pending,
        })),
      },
    };
  },
};

export const listExpenseCategoriesTool: AgentTool = {
  name: "list_expense_categories",
  description: [
    "Справочник счетов и категорий пользователя в разделе «Финансы» (без сумм).",
    "Категории только не заархивированные; для каждой указаны kind и родитель (если это подкатегория).",
    "Используй перед ответом про «какие категории есть» или чтобы сопоставить название с типом (расход/доход).",
  ].join(" "),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const r = await fetchExpenseAccountsAndCategories(ctx.userId);
    if ("error" in r) return { ok: false, error: r.error };
    const byId = new Map(r.data.categories.map((c) => [c.id, c]));
    const active = r.data.categories.filter((c) => !c.is_archived);
    const accounts = r.data.accounts
      .filter((a) => !a.is_archived)
      .map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
    const categories = active
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((c) => {
        const parent = c.parent_id ? byId.get(c.parent_id) : null;
        return {
          id: c.id,
          name: c.name,
          kind: c.kind,
          kind_ru: KIND_RU[c.kind],
          parent_id: c.parent_id,
          parent_name: parent?.name ?? null,
          label: parent ? `${parent.name} / ${c.name}` : c.name,
        };
      });
    return { ok: true, data: { accounts, categories, categories_count: categories.length } };
  },
};
