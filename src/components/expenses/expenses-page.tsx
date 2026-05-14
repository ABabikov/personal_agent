"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, Trash2 } from "lucide-react";
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
  insertExpenseCategory,
  softDeleteExpenseTransaction,
} from "@/lib/db/expenseMutations";
import { ExpenseCategoryCombobox } from "@/components/expenses/expense-category-combobox";
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
    "Вверху — сводка по текущему календарному месяцу и году (все счета). Календарь месяца, операции по дню, фильтры и график по категориям. Можно добавить свою категорию в блоке «Справочник категорий»."
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

  const [overviewMonth, setOverviewMonth] = useState<ReturnType<typeof totals> | null>(null);
  const [overviewYear, setOverviewYear] = useState<ReturnType<typeof totals> | null>(null);

  const [newCatName, setNewCatName] = useState("");
  const [newCatKind, setNewCatKind] = useState<ExpenseKind>("expense");
  const [newCatParentId, setNewCatParentId] = useState("");
  const [newCatError, setNewCatError] = useState<string | null>(null);
  const [newCatSubmitting, setNewCatSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setError(user.error);
      setLoading(false);
      return;
    }
    const clock = new Date();
    const curY = clock.getFullYear();
    const curM = clock.getMonth();

    const [mainRes, omRes, oyRes] = await Promise.all([
      fetchExpensesPeriod(user.userId, "month", { year, monthIdx0 }),
      fetchExpensesPeriod(user.userId, "month", { year: curY, monthIdx0: curM }),
      fetchExpensesPeriod(user.userId, "year", { year: curY }),
    ]);

    if ("error" in mainRes) {
      setError(mainRes.error);
      setLoading(false);
      return;
    }
    let res = mainRes;
    if (res.data.accounts.length === 0) {
      const ensured = await ensureDefaultExpenseAccount(user.userId);
      if ("id" in ensured) {
        const again = await fetchExpensesPeriod(user.userId, "month", { year, monthIdx0 });
        if ("error" in again) {
          setError(again.error);
          setLoading(false);
          return;
        }
        res = again;
      }
    }
    setData(res.data);
    if (!("error" in omRes)) setOverviewMonth(totals(omRes.data.transactions));
    else setOverviewMonth(null);
    if (!("error" in oyRes)) setOverviewYear(totals(oyRes.data.transactions));
    else setOverviewYear(null);
    setLoading(false);
  }, [year, monthIdx0]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodTitle = new Date(year, monthIdx0, 1).toLocaleDateString("ru", {
    month: "long",
    year: "numeric",
  });

  const activeCategories = useMemo(
    () => data.categories.filter((c) => !c.is_archived),
    [data.categories]
  );

  const parentCategories = useMemo(() => {
    return activeCategories
      .filter((c) => c.parent_id == null)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [activeCategories]);

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
    return activeCategories
      .filter((c) => c.kind === formKind)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [activeCategories, formKind]);

  const formCategoryOptions = useMemo(() => {
    return categoriesMatchingFormKind.map((c) => {
      const parent = c.parent_id ? categoryById.get(c.parent_id) : null;
      const label = parent ? `${parent.name} / ${c.name}` : c.name;
      return { id: c.id, label };
    });
  }, [categoriesMatchingFormKind, categoryById]);

  const parentFilterOptions = useMemo(
    () => parentCategories.map((c) => ({ id: c.id, label: c.name })),
    [parentCategories]
  );

  const newCategoryParentOptions = useMemo(() => {
    return activeCategories
      .filter((c) => c.kind === newCatKind && c.parent_id == null)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((c) => ({ id: c.id, label: c.name }));
  }, [activeCategories, newCatKind]);

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
      if (!cat || cat.kind !== formKind || cat.is_archived) return "";
      return prev;
    });
  }, [formKind, categoryById]);

  useEffect(() => {
    setNewCatParentId((prev) => {
      if (!prev) return "";
      const p = categoryById.get(prev);
      if (!p || p.kind !== newCatKind || p.parent_id != null || p.is_archived) return "";
      return prev;
    });
  }, [newCatKind, categoryById]);

  const categoryReviewTree = useMemo(() => {
    const childrenByParent = new Map<string, typeof activeCategories>();
    for (const c of activeCategories) {
      if (!c.parent_id) continue;
      const arr = childrenByParent.get(c.parent_id) ?? [];
      arr.push(c);
      childrenByParent.set(c.parent_id, arr);
    }
    for (const [, arr] of childrenByParent) {
      arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }
    return parentCategories.map((p) => ({
      parent: p,
      children: childrenByParent.get(p.id) ?? [],
    }));
  }, [activeCategories, parentCategories]);

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

  async function onSubmitNewCategory(e: React.FormEvent) {
    e.preventDefault();
    setNewCatError(null);
    const name = newCatName.trim();
    if (!name) {
      setNewCatError("Введите название.");
      return;
    }
    setNewCatSubmitting(true);
    try {
      const user = await getWorkoutUserId();
      if ("error" in user) {
        setNewCatError(user.error);
        return;
      }
      const res = await insertExpenseCategory({
        userId: user.userId,
        name,
        kind: newCatKind,
        parentId: newCatParentId || null,
      });
      if ("error" in res) {
        setNewCatError(res.error);
        return;
      }
      setNewCatName("");
      setNewCatParentId("");
      await load();
    } finally {
      setNewCatSubmitting(false);
    }
  }

  const calendarNow = new Date();
  const overviewMonthTitle = new Date(
    calendarNow.getFullYear(),
    calendarNow.getMonth(),
    1
  ).toLocaleDateString("ru", { month: "long", year: "numeric" });

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
            categories={activeCategories}
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

      <div className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5 text-xs text-foreground">
        <p className="mb-2 font-medium text-muted-foreground">
          Сводка по календарю · все счета
        </p>
        <div className="space-y-2 tabular-nums leading-relaxed">
          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-6">
            <span className="shrink-0 capitalize text-muted-foreground sm:w-36">
              {overviewMonthTitle}
            </span>
            <span className="text-muted-foreground">
              доход{" "}
              <span className="text-foreground">
                {loading && overviewMonth == null ? "…" : formatRub(overviewMonth?.income ?? 0)}
              </span>
            </span>
            <span className="text-muted-foreground">
              расход{" "}
              <span className="text-foreground">
                {loading && overviewMonth == null ? "…" : formatRub(overviewMonth?.expense ?? 0)}
              </span>
            </span>
            <span className="text-muted-foreground">
              баланс{" "}
              <span
                className={
                  (overviewMonth?.net ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {loading && overviewMonth == null ? "…" : formatRub(overviewMonth?.net ?? 0)}
              </span>
            </span>
            <span className="text-muted-foreground sm:ml-auto">
              {overviewMonth?.count ?? 0} оп.
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t border-border/50 pt-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-6">
            <span className="shrink-0 text-muted-foreground sm:w-36">
              С начала {calendarNow.getFullYear()} г.
            </span>
            <span className="text-muted-foreground">
              доход{" "}
              <span className="text-foreground">
                {loading && overviewYear == null ? "…" : formatRub(overviewYear?.income ?? 0)}
              </span>
            </span>
            <span className="text-muted-foreground">
              расход{" "}
              <span className="text-foreground">
                {loading && overviewYear == null ? "…" : formatRub(overviewYear?.expense ?? 0)}
              </span>
            </span>
            <span className="text-muted-foreground">
              баланс{" "}
              <span
                className={
                  (overviewYear?.net ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {loading && overviewYear == null ? "…" : formatRub(overviewYear?.net ?? 0)}
              </span>
            </span>
            <span className="text-muted-foreground sm:ml-auto">
              {overviewYear?.count ?? 0} оп.
            </span>
          </div>
        </div>
      </div>

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
                <ExpenseCategoryCombobox
                  id="expense-form-category"
                  value={formCategoryId}
                  onChange={setFormCategoryId}
                  options={formCategoryOptions}
                  allowEmpty
                  emptyLabel="Не указана"
                  disabled={loading}
                />
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

      <Card size="sm">
        <CardContent className="space-y-2 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Фильтры и сводка за выбранный месяц
            </p>
            <p className="text-xs tabular-nums text-muted-foreground capitalize">{periodTitle}</p>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            <span className="text-foreground">Доход</span> {formatRub(kpis.income)}
            {" · "}
            <span className="text-foreground">расход</span> {formatRub(kpis.expense)}
            {" · "}
            <span className="text-foreground">баланс</span>{" "}
            <span className={kpis.net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
              {formatRub(kpis.net)}
            </span>
            {" · "}
            {kpis.count} оп.
            {kpis.withdrawal > 0 && (
              <>
                {" · "}
                снятия {formatRub(kpis.withdrawal)}
              </>
            )}
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
              <span className="text-muted-foreground">Категория (верхний уровень)</span>
              <ExpenseCategoryCombobox
                id="expense-filter-parent-cat"
                value={parentCategoryId}
                onChange={setParentCategoryId}
                options={parentFilterOptions}
                allowEmpty
                emptyLabel="Все"
                placeholder="Поиск категории…"
                disabled={loading}
              />
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

      <details className="rounded-md border border-border/70 bg-card/40 px-3 py-2 text-xs open:pb-3">
        <summary className="cursor-pointer font-medium text-muted-foreground">
          Справочник категорий и своя категория
        </summary>
        <div className="mt-3 space-y-4">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Текущий набор — из импорта (Money Manager, Сбер) и ручных записей. Дерево: родитель
            и подкатегории; для графика «по категориям» суммируются расходы по родителю.
          </p>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-muted/15 p-2">
            {categoryReviewTree.length === 0 ? (
              <p className="text-muted-foreground">Нет категорий</p>
            ) : (
              <ul className="space-y-2">
                {categoryReviewTree.map(({ parent: p, children }) => (
                  <li key={p.id}>
                    <div className="font-medium text-foreground">
                      {p.name}
                      <span className="ml-1 font-normal text-muted-foreground">
                        (
                        {p.kind === "expense"
                          ? "расход"
                          : p.kind === "income"
                            ? "доход"
                            : p.kind === "withdrawal"
                              ? "снятие"
                              : "перевод"}
                        )
                      </span>
                    </div>
                    {children.length > 0 && (
                      <ul className="mt-1 space-y-0.5 border-l border-border/60 pl-2 text-muted-foreground">
                        {children.map((ch) => (
                          <li key={ch.id}>— {ch.name}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form
            onSubmit={(e) => void onSubmitNewCategory(e)}
            className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2"
          >
            <p className="text-[11px] font-medium text-muted-foreground">Добавить свою категорию</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Название</span>
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Например, Подписки"
                  className="h-8"
                  maxLength={120}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Тип</span>
                <select
                  value={newCatKind}
                  onChange={(e) => setNewCatKind(e.target.value as ExpenseKind)}
                  className="h-8 rounded-md border border-border bg-card px-2 text-sm"
                >
                  <option value="expense">Расход</option>
                  <option value="income">Доход</option>
                  <option value="withdrawal">Снятие</option>
                  <option value="transfer">Перевод</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Родитель (опционально)</span>
                <ExpenseCategoryCombobox
                  id="expense-new-cat-parent"
                  value={newCatParentId}
                  onChange={setNewCatParentId}
                  options={newCategoryParentOptions}
                  allowEmpty
                  emptyLabel="Корневая категория"
                  placeholder="Поиск группы…"
                  disabled={loading || newCatSubmitting}
                />
              </label>
            </div>
            {newCatError && (
              <p className="text-[11px] text-destructive" role="alert">
                {newCatError}
              </p>
            )}
            <Button type="submit" size="sm" disabled={loading || newCatSubmitting}>
              {newCatSubmitting ? "Сохранение…" : "Добавить категорию"}
            </Button>
          </form>
        </div>
      </details>
    </div>
  );
}
