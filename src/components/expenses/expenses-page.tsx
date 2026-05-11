"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, TrendingDown, TrendingUp, Banknote, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PieChart, type PieSlice } from "@/components/charts/pie-chart";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";
import {
  fetchExpensesPeriod,
  totals,
  expensesByParentCategory,
  topMerchants,
  formatRub,
  formatRubFractional,
  type ExpensesData,
  type ExpenseTransactionRow,
} from "@/lib/db/expensesData";
import {
  insertManualExpenseTransaction,
  ensureDefaultExpenseAccount,
  softDeleteExpenseTransaction,
} from "@/lib/db/expenseMutations";
import { SberXlsxImportDialog } from "@/components/expenses/sber-xlsx-import-dialog";
import { ExpenseMonthCalendar } from "@/components/expenses/expense-month-calendar";
import { expenseTransactionLocalDate } from "@/lib/features/expenses/expenseCalendar";
import { dateFromIso, isoLocalDate } from "@/lib/features/workouts/analytics";
import type { ExpenseKind } from "@/types/database";

const EMPTY_DATA: ExpensesData = { accounts: [], categories: [], transactions: [] };

const CATEGORY_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--gym)",
  "var(--swim)",
  "var(--primary)",
  "#ef4444",
  "#22c55e",
  "#eab308",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#10b981",
  "#0ea5e9",
];

function paletteColor(i: number): string {
  return CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
}

function shortenLabel(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

type KindFilter = "all" | "expense" | "income" | "withdrawal";

export function ExpensesPage() {
  useRegisterPageChatContext(
    "Финансы",
    "Календарь месяца: по дню — операции и ручное добавление; ниже — сводка за месяц."
  );

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [monthIdx0, setMonthIdx0] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(() => isoLocalDate(today));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExpensesData>(EMPTY_DATA);

  const [accountId, setAccountId] = useState<string>("");
  const [parentCategoryId, setParentCategoryId] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [formKind, setFormKind] = useState<ExpenseKind>("expense");
  const [formAmount, setFormAmount] = useState("");
  const [formAccountId, setFormAccountId] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setError(user.error);
      setLoading(false);
      return;
    }
    let res = await fetchExpensesPeriod(user.userId, "month", { year, monthIdx0 });
    if ("error" in res) {
      setError(res.error);
      setLoading(false);
      return;
    }
    if (res.data.accounts.length === 0) {
      const ensured = await ensureDefaultExpenseAccount(user.userId);
      if ("id" in ensured) {
        res = await fetchExpensesPeriod(user.userId, "month", { year, monthIdx0 });
        if ("error" in res) {
          setError(res.error);
          setLoading(false);
          return;
        }
      }
    }
    setData(res.data);
    setLoading(false);
  }, [year, monthIdx0]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodTitle = new Date(year, monthIdx0, 1).toLocaleDateString("ru", {
    month: "long",
    year: "numeric",
  });

  const parentCategories = useMemo(() => {
    return data.categories
      .filter((c) => c.parent_id == null)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [data.categories]);

  const parentByCategoryId = useMemo(() => {
    const byId = new Map(data.categories.map((c) => [c.id, c]));
    const out = new Map<string, string>();
    for (const c of data.categories) {
      let cur = c;
      while (cur.parent_id != null) {
        const p = byId.get(cur.parent_id);
        if (!p) break;
        cur = p;
      }
      out.set(c.id, cur.id);
    }
    return out;
  }, [data.categories]);

  const accountById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts]
  );
  const categoryById = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c])),
    [data.categories]
  );

  const categoriesMatchingFormKind = useMemo(() => {
    return data.categories
      .filter((c) => c.kind === formKind)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [data.categories, formKind]);

  useEffect(() => {
    if (data.accounts.length === 0) return;
    setFormAccountId((prev) => {
      if (prev && data.accounts.some((a) => a.id === prev)) return prev;
      return data.accounts[0].id;
    });
  }, [data.accounts]);

  useEffect(() => {
    setFormCategoryId((prev) => {
      if (!prev) return "";
      const cat = categoryById.get(prev);
      if (!cat || cat.kind !== formKind) return "";
      return prev;
    });
  }, [formKind, categoryById]);

  const filteredTransactions = useMemo<ExpenseTransactionRow[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (accountId && t.account_id !== accountId) return false;
      if (parentCategoryId) {
        const p = t.category_id ? parentByCategoryId.get(t.category_id) : null;
        if (p !== parentCategoryId) return false;
      }
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (q.length > 0) {
        const hay = [
          t.description ?? "",
          t.merchant ?? "",
          accountById.get(t.account_id)?.name ?? "",
          t.category_id ? categoryById.get(t.category_id)?.name ?? "" : "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    data.transactions,
    accountId,
    parentCategoryId,
    kindFilter,
    searchQuery,
    parentByCategoryId,
    accountById,
    categoryById,
  ]);

  const kpis = useMemo(() => totals(filteredTransactions), [filteredTransactions]);

  const byParent = useMemo(
    () => expensesByParentCategory(filteredTransactions, data.categories),
    [filteredTransactions, data.categories]
  );

  const donutSlices: PieSlice[] = useMemo(() => {
    return byParent.map((b, i) => ({
      id: b.parentCategoryId,
      label: b.parentCategoryName,
      value: b.amount,
      color: paletteColor(i),
    }));
  }, [byParent]);

  const topRows = useMemo(() => topMerchants(filteredTransactions, 8), [filteredTransactions]);

  function shiftMonth(delta: number) {
    let m = monthIdx0 + delta;
    let y = year;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    setMonthIdx0(m);
    setYear(y);
    setSelectedDate((prev) => {
      const d = dateFromIso(prev);
      const dayNum = d.getDate();
      const last = new Date(y, m + 1, 0).getDate();
      return isoLocalDate(new Date(y, m, Math.min(dayNum, last)));
    });
  }

  function selectCalendarDate(iso: string) {
    setSelectedDate(iso);
    const d = dateFromIso(iso);
    const y = d.getFullYear();
    const mo = d.getMonth();
    if (y !== year || mo !== monthIdx0) {
      setYear(y);
      setMonthIdx0(mo);
    }
  }

  const dayTransactions = useMemo(() => {
    return filteredTransactions.filter((t) => expenseTransactionLocalDate(t) === selectedDate);
  }, [filteredTransactions, selectedDate]);

  const selectedDayTitle = useMemo(() => {
    return dateFromIso(selectedDate).toLocaleDateString("ru", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [selectedDate]);

  const handleDeleteTransaction = useCallback(
    async (transactionId: string) => {
      if (
        !confirm(
          "Удалить эту операцию? Она исчезнет из календаря и сводок. Данные останутся в базе (техническое скрытие)."
        )
      ) {
        return;
      }
      setDeletingId(transactionId);
      setError(null);
      try {
        const user = await getWorkoutUserId();
        if ("error" in user) {
          setError(user.error);
          return;
        }
        const res = await softDeleteExpenseTransaction({
          userId: user.userId,
          transactionId,
        });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        await load();
      } finally {
        setDeletingId(null);
      }
    },
    [load]
  );

  async function onSubmitManual(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = Number.parseFloat(formAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Введите сумму больше нуля.");
      return;
    }
    setFormSubmitting(true);
    try {
      const user = await getWorkoutUserId();
      if ("error" in user) {
        setFormError(user.error);
        return;
      }
      let accId = formAccountId;
      if (!accId) {
        const ens = await ensureDefaultExpenseAccount(user.userId);
        if ("error" in ens) {
          setFormError(ens.error);
          return;
        }
        accId = ens.id;
      }
      const res = await insertManualExpenseTransaction({
        userId: user.userId,
        occurredIsoDate: selectedDate,
        accountId: accId,
        categoryId: formCategoryId || null,
        kind: formKind,
        amount,
        description: formDescription.trim() || null,
      });
      if ("error" in res) {
        setFormError(res.error);
        return;
      }
      setFormAmount("");
      setFormDescription("");
      await load();
    } finally {
      setFormSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="size-5" />
          <h2 className="text-xl font-semibold">Финансы</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SberXlsxImportDialog
            disabled={loading}
            onImported={() => void load()}
            categories={data.categories}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Загрузка…" : "Обновить"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <ExpenseMonthCalendar
        year={year}
        monthIdx0={monthIdx0}
        transactions={filteredTransactions}
        selectedDate={selectedDate}
        onSelect={selectCalendarDate}
        onPrev={() => shiftMonth(-1)}
        onNext={() => shiftMonth(1)}
      />

      <Card size="sm">
        <CardContent className="space-y-4 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold capitalize">{selectedDayTitle}</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {dayTransactions.length}{" "}
              {dayTransactions.length === 1 ? "операция" : "операций"}
            </span>
          </div>

          <form onSubmit={(e) => void onSubmitManual(e)} className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">Новая операция на этот день</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Тип</span>
                <select
                  value={formKind}
                  onChange={(e) => setFormKind(e.target.value as ExpenseKind)}
                  className="h-8 rounded-md border border-border bg-card px-2 text-sm"
                >
                  <option value="expense">Расход</option>
                  <option value="income">Доход</option>
                  <option value="withdrawal">Снятие</option>
                  <option value="transfer">Перевод</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Сумма</span>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="h-8"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Счёт</span>
                <select
                  value={formAccountId}
                  onChange={(e) => setFormAccountId(e.target.value)}
                  className="h-8 rounded-md border border-border bg-card px-2 text-sm"
                  required
                >
                  {data.accounts.length === 0 ? (
                    <option value="">Нет счёта</option>
                  ) : (
                    data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Категория</span>
                <select
                  value={formCategoryId}
                  onChange={(e) => setFormCategoryId(e.target.value)}
                  className="h-8 rounded-md border border-border bg-card px-2 text-sm"
                >
                  <option value="">Не указана</option>
                  {categoriesMatchingFormKind.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Описание</span>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="необязательно"
                className="h-8"
              />
            </label>
            {formError && (
              <p className="text-xs text-destructive" role="alert">
                {formError}
              </p>
            )}
            <Button type="submit" size="sm" disabled={formSubmitting || loading}>
              {formSubmitting ? "Сохранение…" : "Добавить операцию"}
            </Button>
          </form>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Операции за день</p>
            <ul className="space-y-2">
              {dayTransactions.map((t) => {
                const cat = t.category_id ? categoryById.get(t.category_id) : null;
                const parent =
                  cat && cat.parent_id ? categoryById.get(cat.parent_id) : null;
                const catLabel = cat
                  ? parent
                    ? `${parent.name} / ${cat.name}`
                    : cat.name
                  : "—";
                const sign =
                  t.kind === "income" ? "+" : t.kind === "expense" ? "−" : "";
                const color =
                  t.kind === "income"
                    ? "text-emerald-500"
                    : t.kind === "expense"
                      ? "text-red-500"
                      : "text-muted-foreground";
                const timeStr = new Date(t.occurred_at).toLocaleTimeString("ru", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <li
                    key={t.id}
                    className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium tabular-nums text-muted-foreground">
                          {timeStr}
                          {t.pending && (
                            <span className="ml-1 font-normal text-amber-600 dark:text-amber-500">
                              · HOLD
                            </span>
                          )}
                        </div>
                        <div className="truncate">{catLabel}</div>
                        {t.description && (
                          <div className="mt-0.5 text-xs">{t.description}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <div className={`tabular-nums font-semibold ${color}`}>
                          {sign}
                          {formatRubFractional(t.amount)}
                        </div>
                        <button
                          type="button"
                          disabled={loading || deletingId === t.id}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
                          aria-label="Удалить операцию"
                          title="Удалить операцию"
                          onClick={() => void handleDeleteTransaction(t.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
              {dayTransactions.length === 0 && (
                <li className="py-3 text-center text-sm text-muted-foreground">
                  {loading ? "Загрузка…" : "Нет операций за этот день"}
                </li>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="flex items-baseline gap-1">
              <TrendingDown className="size-4 text-red-500" />
              <p className="text-2xl font-bold tabular-nums">
                {loading ? "…" : formatRub(kpis.expense)}
              </p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">расход</p>
            <p className="text-[10px] capitalize text-muted-foreground">{periodTitle}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="flex items-baseline gap-1">
              <TrendingUp className="size-4 text-emerald-500" />
              <p className="text-2xl font-bold tabular-nums">
                {loading ? "…" : formatRub(kpis.income)}
              </p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">доход</p>
            <p className="text-[10px] capitalize text-muted-foreground">{periodTitle}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <p
              className={`text-2xl font-bold tabular-nums ${
                kpis.net < 0 ? "text-red-500" : "text-emerald-500"
              }`}
            >
              {loading ? "…" : formatRub(kpis.net)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">баланс</p>
            <p className="text-[10px] text-muted-foreground">доход − расход</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="flex items-baseline gap-1">
              <Banknote className="size-4 text-muted-foreground" />
              <p className="text-2xl font-bold tabular-nums">
                {loading ? "…" : kpis.count.toLocaleString("ru")}
              </p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">операций</p>
            <p className="text-[10px] text-muted-foreground">
              {formatRub(kpis.withdrawal)} снятий
            </p>
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardContent className="space-y-2 pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Фильтры для сводки за месяц
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Счёт</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2 text-sm"
              >
                <option value="">Все</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Категория</span>
              <select
                value={parentCategoryId}
                onChange={(e) => setParentCategoryId(e.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2 text-sm"
              >
                <option value="">Все</option>
                {parentCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Тип</span>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as KindFilter)}
                className="h-8 rounded-md border border-border bg-card px-2 text-sm"
              >
                <option value="all">Все</option>
                <option value="expense">Расход</option>
                <option value="income">Доход</option>
                <option value="withdrawal">Снятие</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Поиск</span>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="описание / место"
                className="h-8"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-3 text-sm font-semibold">Расходы по категориям</h3>
          {donutSlices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? "Загрузка…" : "Нет расходов за период"}
            </p>
          ) : (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <PieChart
                slices={donutSlices}
                size={220}
                centerLabel={formatRub(kpis.expense)}
                centerSubLabel={`${kpis.count} операций`}
                valueFormat={(v) => formatRub(v)}
              />
              <ul className="grid flex-1 grid-cols-1 gap-1 text-sm">
                {byParent.map((b, i) => (
                  <li key={b.parentCategoryId} className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ background: paletteColor(i) }}
                    />
                    <span className="flex-1 truncate">{b.parentCategoryName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {(b.share * 100).toFixed(1)}%
                    </span>
                    <span className="w-24 text-right tabular-nums">{formatRub(b.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {topRows.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-3 text-sm font-semibold">Топ мест трат</h3>
            <ul className="space-y-1 text-sm">
              {topRows.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="flex-1 truncate" title={r.key}>
                    {shortenLabel(r.key, 60)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{r.txCount}×</span>
                  <span className="w-24 text-right tabular-nums">{formatRub(r.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
