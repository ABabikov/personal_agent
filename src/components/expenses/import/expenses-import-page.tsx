"use client";

/**
 * Импорт банковской выписки: файл → предпросмотр группами → запись.
 *
 * Ключевая идея против «болезненного» импорта: решение принимается не по каждой строке,
 * а по группе (одно место трат = одна группа), и категория для группы подставляется
 * автоматически — по истории или моделью. Подтверждённые связки сохраняются правилами,
 * поэтому следующий импорт почти не требует ручной работы.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Sparkles, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryPicker } from "@/components/expenses/category-picker";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import {
  fetchCategorizedHistory,
  fetchExpenseAccountsAndCategories,
  fetchExpenseCategoryRules,
  formatRub,
  formatRubFractional,
  type ExpenseAccountRow,
  type ExpenseCategoryRow,
} from "@/lib/db/expensesData";
import {
  insertExpenseCategory,
  saveLearnedCategoryRules,
  upsertSberBankOperations,
  type LearnedRuleInput,
} from "@/lib/db/expenseMutations";
import {
  buildSuggestionIndex,
  isGenericBankCategory,
  suggestCategory,
  type CategorySuggestion,
  type SuggestHistoryTx,
  type SuggestRule,
} from "@/lib/features/expenses/categorySuggest";
import { groupOperations, type ImportGroup } from "@/lib/features/expenses/importGrouping";
import {
  parseSberXlsxArrayBuffer,
  type SberParsedOperation,
} from "@/lib/features/expenses/sberXlsxImport";
import type { ExpenseKind } from "@/types/database";

type Engine = "history" | "llm";

type Suggestion = CategorySuggestion & { engine: Engine };

const KIND_SHORT: Record<ExpenseKind, string> = {
  expense: "Расход",
  income: "Доход",
  withdrawal: "Снятие",
  transfer: "Перевод",
};

const SOURCE_BADGE: Record<CategorySuggestion["source"], string> = {
  rule: "правило",
  history: "история",
  mcc: "MCC",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("ru", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExpensesImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<ExpenseAccountRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [rules, setRules] = useState<SuggestRule[]>([]);
  const [history, setHistory] = useState<SuggestHistoryTx[]>([]);

  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [operations, setOperations] = useState<SberParsedOperation[]>([]);
  const [issues, setIssues] = useState<{ rowIndex: number; message: string }[]>([]);

  const [accountId, setAccountId] = useState("");
  const [engine, setEngine] = useState<Engine>("history");
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoNote, setAutoNote] = useState<string | null>(null);

  /** groupKey → id категории ("" — не выбрана) */
  const [groupCategory, setGroupCategory] = useState<Record<string, string>>({});
  /** externalId → id категории; переопределяет решение группы */
  const [rowCategory, setRowCategory] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    rulesSaved: number;
  } | null>(null);

  const loadReference = useCallback(async () => {
    setLoading(true);
    setError(null);
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setError(user.error);
      setLoading(false);
      return;
    }
    setUserId(user.userId);

    const [refRes, rulesRes, historyRes] = await Promise.all([
      fetchExpenseAccountsAndCategories(user.userId),
      fetchExpenseCategoryRules(user.userId),
      fetchCategorizedHistory(user.userId),
    ]);

    if ("error" in refRes) {
      setError(refRes.error);
      setLoading(false);
      return;
    }
    setAccounts(refRes.data.accounts.filter((a) => !a.is_archived));
    setCategories(refRes.data.categories);
    setRules("error" in rulesRes ? [] : rulesRes.data);
    setHistory("error" in historyRes ? [] : historyRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadReference();
  }, [loadReference]);

  useEffect(() => {
    if (accounts.length === 0) return;
    setAccountId((prev) => (prev && accounts.some((a) => a.id === prev) ? prev : accounts[0].id));
  }, [accounts]);

  const suggestionIndex = useMemo(
    () => buildSuggestionIndex({ categories, rules, history }),
    [categories, rules, history]
  );

  const groups = useMemo(() => groupOperations(operations), [operations]);

  /** Категория, с которой операция реально уйдёт в базу: строка важнее группы. */
  const resolvedCategoryFor = useCallback(
    (group: ImportGroup, op: SberParsedOperation): string => {
      const row = rowCategory[op.externalId];
      if (row !== undefined) return row;
      return groupCategory[group.key] ?? "";
    },
    [rowCategory, groupCategory]
  );

  const includedGroups = useMemo(
    () => groups.filter((g) => !excluded.has(g.key)),
    [groups, excluded]
  );

  const stats = useMemo(() => {
    let total = 0;
    let uncategorized = 0;
    let amount = 0;
    for (const g of includedGroups) {
      for (const op of g.operations) {
        total += 1;
        amount += op.amount;
        if (!resolvedCategoryFor(g, op)) uncategorized += 1;
      }
    }
    return { total, uncategorized, amount };
  }, [includedGroups, resolvedCategoryFor]);

  const groupsWithoutCategory = useMemo(
    () => includedGroups.filter((g) => !groupCategory[g.key]),
    [includedGroups, groupCategory]
  );

  // ---------------------------------------------------------------- разбор файла

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    setParsing(true);
    setFileName(file.name);
    setGroupCategory({});
    setRowCategory({});
    setSuggestions({});
    setExcluded(new Set());
    setExpanded(new Set());
    setAutoNote(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await parseSberXlsxArrayBuffer(buf);
      setIssues(res.issues);
      setOperations(res.operations);
      if (res.operations.length === 0) {
        setError(res.issues[0]?.message ?? "В файле не найдено ни одной операции.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOperations([]);
    } finally {
      setParsing(false);
    }
  }, []);

  // ------------------------------------------------------- автоопределение категорий

  const applyHistorySuggestions = useCallback(
    (target: ImportGroup[]): number => {
      if (target.length === 0) return 0;
      const nextCategories: Record<string, string> = {};
      const nextSuggestions: Record<string, Suggestion> = {};
      let filled = 0;

      for (const g of target) {
        const suggestion = suggestCategory(
          {
            kind: g.kind,
            merchant: g.merchant,
            mcc: g.mcc,
            bankCategory: g.bankCategory,
            description: g.sampleDescriptions[0] ?? null,
          },
          suggestionIndex
        );
        if (!suggestion) continue;
        nextCategories[g.key] = suggestion.categoryId;
        nextSuggestions[g.key] = { ...suggestion, engine: "history" };
        filled += 1;
      }

      setGroupCategory((prev) => ({ ...prev, ...nextCategories }));
      setSuggestions((prev) => ({ ...prev, ...nextSuggestions }));
      return filled;
    },
    [suggestionIndex]
  );

  // Как только файл разобран, бесплатный движок отрабатывает сам — пользователь сразу
  // видит заполненную таблицу, а не пустые ячейки.
  useEffect(() => {
    if (groups.length === 0 || loading) return;
    const filled = applyHistorySuggestions(groups);
    setAutoNote(
      filled > 0
        ? `По истории и правилам заполнено групп: ${filled} из ${groups.length}.`
        : "История пока ничего не подсказала — выберите категории вручную или попробуйте ИИ."
    );
    // Запускается один раз на новый разбор файла: groups пересобираются только вместе с operations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, loading]);

  const runLlmSuggestions = useCallback(async () => {
    if (!userId) return;
    const target = groupsWithoutCategory;
    if (target.length === 0) {
      setAutoNote("Все группы уже с категориями.");
      return;
    }
    setAutoBusy(true);
    setAutoNote(null);
    setError(null);
    try {
      const res = await fetch("/api/expenses/suggest-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          groups: target.map((g) => ({
            key: g.key,
            kind: g.kind,
            label: g.label,
            merchant: g.merchant,
            mcc: g.mcc,
            bankCategory: g.bankCategory,
            sampleDescriptions: g.sampleDescriptions,
            count: g.operations.length,
            total: g.total,
          })),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: {
          suggestions: { key: string; categoryId: string; confidence: number; reason: string }[];
          modelUsed: string | null;
        };
      };
      if (!json.ok || !json.data) {
        setError(json.error ?? "Модель не ответила.");
        return;
      }

      const nextCategories: Record<string, string> = {};
      const nextSuggestions: Record<string, Suggestion> = {};
      for (const s of json.data.suggestions) {
        nextCategories[s.key] = s.categoryId;
        nextSuggestions[s.key] = {
          categoryId: s.categoryId,
          confidence: s.confidence,
          reason: s.reason,
          source: "history",
          engine: "llm",
        };
      }
      setGroupCategory((prev) => ({ ...prev, ...nextCategories }));
      setSuggestions((prev) => ({ ...prev, ...nextSuggestions }));
      const filled = Object.keys(nextCategories).length;
      setAutoNote(
        `ИИ (${json.data.modelUsed ?? "модель"}): заполнено групп ${filled} из ${target.length}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoBusy(false);
    }
  }, [userId, groupsWithoutCategory]);

  const runAutoCategorize = useCallback(async () => {
    if (engine === "llm") {
      await runLlmSuggestions();
      return;
    }
    const target = groupsWithoutCategory;
    const filled = applyHistorySuggestions(target);
    setAutoNote(
      target.length === 0
        ? "Все группы уже с категориями."
        : `По истории и правилам заполнено групп: ${filled} из ${target.length}.`
    );
  }, [engine, runLlmSuggestions, groupsWithoutCategory, applyHistorySuggestions]);

  const clearAll = useCallback(() => {
    setGroupCategory({});
    setRowCategory({});
    setSuggestions({});
    setAutoNote(null);
  }, []);

  // ------------------------------------------------------------- создание категории

  const createCategory = useCallback(
    async (name: string, parentId: string | null, kind: ExpenseKind): Promise<string | null> => {
      if (!userId) return null;
      const res = await insertExpenseCategory({ userId, name, kind, parentId });
      if ("error" in res) {
        setError(res.error);
        return null;
      }
      const refRes = await fetchExpenseAccountsAndCategories(userId);
      if (!("error" in refRes)) setCategories(refRes.data.categories);
      return res.id;
    },
    [userId]
  );

  // ---------------------------------------------------------------------- импорт

  /**
   * Что запомнить на будущее: по каждой включённой группе с категорией — связку
   * «место → категория», а если места нет, то «категория банка → категория»
   * (кроме бессмысленных «Прочих операций»).
   */
  const buildLearnedRules = useCallback((): LearnedRuleInput[] => {
    const out: LearnedRuleInput[] = [];
    for (const g of includedGroups) {
      const categoryId = groupCategory[g.key];
      if (!categoryId) continue;

      const suggestion = suggestions[g.key];
      const untouched = suggestion?.categoryId === categoryId;
      const origin: LearnedRuleInput["origin"] = !untouched
        ? "manual"
        : suggestion.engine === "llm"
          ? "llm"
          : "learned";

      if (g.merchantKey) {
        out.push({
          matchType: "merchant",
          pattern: g.merchantKey,
          kind: g.kind,
          categoryId,
          origin,
        });
      } else if (!isGenericBankCategory(g.bankCategory)) {
        out.push({
          matchType: "bank_category",
          pattern: g.bankCategory.trim().toLowerCase(),
          kind: g.kind,
          categoryId,
          origin,
        });
      }
    }
    return out;
  }, [includedGroups, groupCategory, suggestions]);

  const runImport = useCallback(async () => {
    if (!userId) return;
    if (!accountId) {
      setError("Выберите счёт, на который записать операции.");
      return;
    }
    const ops: SberParsedOperation[] = [];
    const categoryByExternalId: Record<string, string> = {};
    for (const g of includedGroups) {
      for (const op of g.operations) {
        ops.push(op);
        const categoryId = resolvedCategoryFor(g, op);
        if (categoryId) categoryByExternalId[op.externalId] = categoryId;
      }
    }
    if (ops.length === 0) {
      setError("Нечего импортировать: все группы исключены.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const res = await upsertSberBankOperations({
        userId,
        accountId,
        operations: ops,
        fileLabel: fileName || "import.xlsx",
        categoryByExternalId,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }

      // Правила — вспомогательные: их неудача не должна выглядеть как провал импорта.
      let rulesSaved = 0;
      const rulesRes = await saveLearnedCategoryRules({ userId, rules: buildLearnedRules() });
      if ("ok" in rulesRes) rulesSaved = rulesRes.saved;
      else console.warn("expense_category_rules:", rulesRes.error);

      setResult({ inserted: res.inserted, skipped: res.skipped, rulesSaved });
      setOperations([]);
      setIssues([]);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      void loadReference();
    } finally {
      setImporting(false);
    }
  }, [
    userId,
    accountId,
    includedGroups,
    resolvedCategoryFor,
    fileName,
    buildLearnedRules,
    loadReference,
  ]);

  // ------------------------------------------------------------------------- UI

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleExcluded = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link
            href="/expenses"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Финансы
          </Link>
          <h2 className="text-xl font-semibold">Импорт операций</h2>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {result && (
        <Card size="sm">
          <CardContent className="space-y-2 pt-3">
            <p className="text-sm font-medium">Импорт завершён</p>
            <p className="text-sm text-muted-foreground">
              Добавлено операций: <span className="font-medium text-foreground">{result.inserted}</span>
              {result.skipped > 0 && (
                <>
                  {" · "}пропущено как дубли:{" "}
                  <span className="font-medium text-foreground">{result.skipped}</span>
                </>
              )}
              {result.rulesSaved > 0 && (
                <>
                  {" · "}запомнено правил:{" "}
                  <span className="font-medium text-foreground">{result.rulesSaved}</span>
                </>
              )}
            </p>
            <div className="flex gap-2 pt-1">
              <Link href="/expenses" className={buttonVariants({ size: "sm" })}>
                К финансам
              </Link>
              <Button size="sm" variant="outline" onClick={() => setResult(null)}>
                Импортировать ещё файл
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!result && (
        <>
          {/* Шаг 1 — файл */}
          <Card size="sm">
            <CardContent className="pt-3">
              <div
                className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
              >
                <Upload className="size-6 text-muted-foreground" />
                <p className="text-sm">
                  Перетащите сюда выписку <span className="font-medium">.xlsx</span> или
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={parsing}
                  onClick={() => fileRef.current?.click()}
                >
                  {parsing ? "Чтение…" : "Выбрать файл"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                {fileName && (
                  <p className="text-xs text-muted-foreground">
                    {fileName} · операций: {operations.length}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Выписка Сбербанка (лента операций). Повторный импорт тех же операций
                  пропускается — задвоения не будет.
                </p>
              </div>

              {issues.length > 0 && operations.length > 0 && (
                <details className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                  <summary className="cursor-pointer">
                    Пропущено строк при разборе: {issues.length}
                  </summary>
                  <ul className="mt-1 max-h-24 list-inside list-disc overflow-y-auto">
                    {issues.slice(0, 20).map((it, i) => (
                      <li key={i}>{it.message}</li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>

          {groups.length > 0 && (
            <>
              {/* Шаг 2 — автоопределение и счёт */}
              <Card size="sm">
                <CardContent className="space-y-3 pt-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Автоопределение категорий</span>
                      <div className="flex overflow-hidden rounded-md border border-input">
                        {(["history", "llm"] as Engine[]).map((e) => (
                          <button
                            key={e}
                            type="button"
                            className={`px-3 py-1.5 text-xs ${
                              engine === e
                                ? "bg-primary text-primary-foreground"
                                : "bg-card text-muted-foreground hover:bg-muted"
                            }`}
                            onClick={() => setEngine(e)}
                          >
                            {e === "history" ? "По истории" : "ИИ"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={autoBusy || groupsWithoutCategory.length === 0}
                      onClick={() => void runAutoCategorize()}
                    >
                      <Sparkles className="mr-1.5 size-4" />
                      {autoBusy
                        ? "Определяю…"
                        : `Определить оставшиеся (${groupsWithoutCategory.length})`}
                    </Button>

                    <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
                      Сбросить категории
                    </Button>

                    <label className="ml-auto flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">Счёт</span>
                      <select
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className="h-8 rounded-md border border-border bg-card px-2 text-sm"
                      >
                        {accounts.length === 0 ? (
                          <option value="">Нет счетов</option>
                        ) : (
                          accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {engine === "history"
                      ? "По истории: правила из прошлых импортов, похожие места и MCC. Бесплатно и мгновенно."
                      : "ИИ: один запрос к модели по группам, которые история не покрыла. Нужен OPENROUTER_API_KEY."}
                  </p>

                  {autoNote && <p className="text-xs text-muted-foreground">{autoNote}</p>}
                </CardContent>
              </Card>

              {/* Шаг 3 — предпросмотр группами */}
              <Card size="sm">
                <CardContent className="space-y-2 pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      Группы операций ({groups.length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      К импорту: {stats.total} оп. на {formatRub(stats.amount)}
                      {stats.uncategorized > 0 && (
                        <span className="text-amber-600 dark:text-amber-500">
                          {" · "}без категории: {stats.uncategorized}
                        </span>
                      )}
                    </p>
                  </div>

                  <ul className="divide-y divide-border/60 rounded-md border border-border">
                    {groups.map((g) => {
                      const isExcluded = excluded.has(g.key);
                      const isExpanded = expanded.has(g.key);
                      const picked = groupCategory[g.key] ?? "";
                      const suggestion = suggestions[g.key];
                      const suggestionShown =
                        suggestion && suggestion.categoryId === picked ? suggestion : null;

                      return (
                        <li
                          key={g.key}
                          className={isExcluded ? "bg-muted/30 opacity-60" : undefined}
                        >
                          <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleExcluded(g.key)}
                              aria-label={`Импортировать группу ${g.label}`}
                              className="shrink-0"
                            />

                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-1 text-left"
                              onClick={() => toggleExpanded(g.key)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium" title={g.label}>
                                  {g.label}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {KIND_SHORT[g.kind]} · {g.operations.length} оп. ·{" "}
                                  {formatRub(g.total)}
                                  {g.mcc && ` · MCC ${g.mcc}`}
                                </span>
                              </span>
                            </button>

                            <div className="flex w-full flex-col gap-0.5 sm:w-[260px]">
                              <CategoryPicker
                                value={picked}
                                onChange={(categoryId) =>
                                  setGroupCategory((prev) => ({ ...prev, [g.key]: categoryId }))
                                }
                                categories={categories}
                                kind={g.kind}
                                allowEmpty
                                emptyLabel="Без категории"
                                disabled={isExcluded}
                                onCreate={(name, parentId) =>
                                  createCategory(name, parentId, g.kind)
                                }
                              />
                              {suggestionShown && (
                                <span
                                  className="truncate text-[11px] text-muted-foreground"
                                  title={suggestionShown.reason}
                                >
                                  {suggestionShown.engine === "llm"
                                    ? "ИИ"
                                    : SOURCE_BADGE[suggestionShown.source]}{" "}
                                  · {Math.round(suggestionShown.confidence * 100)}% ·{" "}
                                  {suggestionShown.reason}
                                </span>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <ul className="space-y-1 border-t border-border/50 bg-muted/20 px-2 py-2">
                              {g.operations.map((op) => {
                                const rowPick = resolvedCategoryFor(g, op);
                                const overridden = rowCategory[op.externalId] !== undefined;
                                return (
                                  <li
                                    key={op.externalId}
                                    className="flex flex-wrap items-center gap-2 text-xs"
                                  >
                                    <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                                      {formatDateTime(op.occurredAt)}
                                    </span>
                                    <span className="w-24 shrink-0 text-right tabular-nums font-medium">
                                      {formatRubFractional(op.amount)}
                                    </span>
                                    <span
                                      className="min-w-0 flex-1 truncate text-muted-foreground"
                                      title={op.description ?? ""}
                                    >
                                      {op.description ?? "—"}
                                    </span>
                                    <div className="w-full sm:w-[240px]">
                                      <CategoryPicker
                                        value={rowPick}
                                        onChange={(categoryId) =>
                                          setRowCategory((prev) => ({
                                            ...prev,
                                            [op.externalId]: categoryId,
                                          }))
                                        }
                                        categories={categories}
                                        kind={op.kind}
                                        allowEmpty
                                        emptyLabel={
                                          overridden ? "Без категории" : "Как у группы"
                                        }
                                        disabled={isExcluded}
                                        onCreate={(name, parentId) =>
                                          createCategory(name, parentId, op.kind)
                                        }
                                      />
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>

              <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
                <p className="text-xs text-muted-foreground">
                  {stats.total} оп. · {formatRub(stats.amount)}
                  {stats.uncategorized > 0 && (
                    <span className="text-amber-600 dark:text-amber-500">
                      {" · "}
                      {stats.uncategorized} без категории (запишутся как есть)
                    </span>
                  )}
                </p>
                <Button
                  type="button"
                  disabled={importing || loading || stats.total === 0}
                  onClick={() => void runImport()}
                >
                  {importing ? "Запись…" : `Импортировать ${stats.total} оп.`}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
