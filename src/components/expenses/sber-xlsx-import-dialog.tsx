"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  countByBankCategory,
  parseSberXlsxArrayBuffer,
  type SberParsedOperation,
} from "@/lib/features/expenses/sberXlsxImport";
import { ensureDefaultExpenseAccount, upsertSberBankOperations } from "@/lib/db/expenseMutations";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import type { ExpenseCategoryRow } from "@/lib/db/expensesData";
import { formatRubFractional } from "@/lib/db/expensesData";
import type { ExpenseKind } from "@/types/database";

type Props = {
  disabled?: boolean;
  onImported: () => void;
  categories: ExpenseCategoryRow[];
};

const KIND_SHORT: Record<ExpenseKind, string> = {
  expense: "Расход",
  income: "Доход",
  withdrawal: "Снятие",
  transfer: "Перевод",
};

export function SberXlsxImportDialog({ disabled, onImported, categories }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<SberParsedOperation[]>([]);
  const [issues, setIssues] = useState<{ rowIndex: number; message: string }[]>([]);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  /** externalId → expense_categories.id */
  const [appCategoryByExternalId, setAppCategoryByExternalId] = useState<
    Record<string, string>
  >({});

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const optionsByKind = useMemo(() => {
    const out = new Map<ExpenseKind, { id: string; label: string }[]>();
    const kinds: ExpenseKind[] = ["expense", "income", "withdrawal", "transfer"];
    for (const k of kinds) {
      const opts = categories
        .filter((c) => c.kind === k)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map((c) => {
          const parent = c.parent_id ? categoryById.get(c.parent_id) : null;
          const label = parent ? `${parent.name} / ${c.name}` : c.name;
          return { id: c.id, label };
        });
      out.set(k, opts);
    }
    return out;
  }, [categories, categoryById]);

  const categoryCounts = useMemo(() => countByBankCategory(parsed), [parsed]);
  const sortedCategories = useMemo(() => {
    return Array.from(categoryCounts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "ru")
    );
  }, [categoryCounts]);

  useEffect(() => {
    if (!open) return;
    setSelectedCats(new Set(categoryCounts.keys()));
  }, [open, categoryCounts]);

  const filteredOps = useMemo(() => {
    return parsed.filter((o) => selectedCats.has(o.bankCategory));
  }, [parsed, selectedCats]);

  const sortedForTable = useMemo(() => {
    return [...filteredOps].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }, [filteredOps]);

  const resetState = useCallback(() => {
    setError(null);
    setFileName("");
    setParsed([]);
    setIssues([]);
    setSelectedCats(new Set());
    setAppCategoryByExternalId({});
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState]);

  const onPickFile = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setBusy(true);
    setFileName(f.name);
    setAppCategoryByExternalId({});
    try {
      const buf = await f.arrayBuffer();
      const res = await parseSberXlsxArrayBuffer(buf);
      setIssues(res.issues);
      setParsed(res.operations);
      if (res.operations.length === 0 && res.issues.length > 0) {
        setError(res.issues[0]?.message ?? "Не удалось разобрать файл");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setParsed([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleCat = useCallback((cat: string) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedCats(new Set(categoryCounts.keys()));
  }, [categoryCounts]);

  const clearAll = useCallback(() => {
    setSelectedCats(new Set());
  }, []);

  const setRowCategory = useCallback((externalId: string, categoryId: string) => {
    setAppCategoryByExternalId((prev) => {
      const next = { ...prev };
      if (!categoryId) delete next[externalId];
      else next[externalId] = categoryId;
      return next;
    });
  }, []);

  const runImport = useCallback(async () => {
    if (filteredOps.length === 0) {
      setError("Выберите хотя бы одну категорию банка или загрузите строки.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await getWorkoutUserId();
      if ("error" in user) {
        setError(user.error);
        return;
      }
      const acc = await ensureDefaultExpenseAccount(user.userId);
      if ("error" in acc) {
        setError(acc.error);
        return;
      }

      const res = await upsertSberBankOperations({
        userId: user.userId,
        accountId: acc.id,
        operations: filteredOps,
        fileLabel: fileName || "import.xlsx",
        categoryByExternalId: appCategoryByExternalId,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onImported();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [
    filteredOps,
    fileName,
    onClose,
    onImported,
    appCategoryByExternalId,
  ]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          resetState();
          setOpen(true);
        }}
      >
        <Upload className="mr-1.5 size-4" />
        Импорт
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => void onFileChange(e)}
      />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bank-import-title"
          onClick={() => !busy && onClose()}
        >
          <div
            className="flex max-h-[min(92vh,900px)] w-full max-w-5xl flex-col rounded-t-xl border border-border bg-card shadow-lg sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-border px-4 py-3">
              <h2 id="bank-import-title" className="text-base font-semibold">
                Импорт операций
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Загрузите Excel (.xlsx). Ниже — все строки, которые попадут в импорт:
                проверьте суммы и назначьте свои категории в последнем столбце. Фильтр по
                категориям банка — опционально. Повторный импорт тех же строк пропускается.
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3">
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onPickFile}>
                  {busy && parsed.length === 0 ? "Чтение…" : "Выбрать файл"}
                </Button>
                {fileName && (
                  <span className="self-center truncate text-xs text-muted-foreground" title={fileName}>
                    {fileName}
                  </span>
                )}
              </div>

              {issues.length > 0 && parsed.length > 0 && (
                <details className="shrink-0 text-xs text-amber-600 dark:text-amber-500">
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

              {sortedCategories.length > 0 && (
                <details className="shrink-0 rounded-md border border-border/80 bg-muted/20 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Фильтр по категориям из файла ({sortedCategories.length})
                  </summary>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-4 hover:underline"
                      onClick={selectAll}
                    >
                      все
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                      onClick={clearAll}
                    >
                      снять
                    </button>
                  </div>
                  <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-sm">
                    {sortedCategories.map(([cat, n], idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          id={`bank-import-filter-${idx}`}
                          checked={selectedCats.has(cat)}
                          onChange={() => toggleCat(cat)}
                          className="mt-0.5"
                        />
                        <label htmlFor={`bank-import-filter-${idx}`} className="flex-1 cursor-pointer leading-snug">
                          <span className="break-words">{cat}</span>
                          <span className="ml-1 tabular-nums text-muted-foreground">({n})</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    К импорту:{" "}
                    <span className="font-medium text-foreground">{filteredOps.length}</span> из{" "}
                    {parsed.length}
                  </p>
                </details>
              )}

              {sortedForTable.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  <p className="shrink-0 text-xs font-medium text-muted-foreground">
                    Операции ({sortedForTable.length})
                  </p>
                  <div className="min-h-[200px] flex-1 overflow-auto rounded-md border border-border">
                    <table className="w-full min-w-[960px] border-collapse text-left text-[11px] sm:text-xs">
                      <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
                        <tr className="border-b border-border">
                          <th className="whitespace-nowrap px-2 py-1.5 font-medium">Дата</th>
                          <th className="whitespace-nowrap px-2 py-1.5 font-medium">Тип</th>
                          <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                            Сумма
                          </th>
                          <th className="min-w-[100px] px-2 py-1.5 font-medium">
                            Категория в файле
                          </th>
                          <th className="min-w-[min(28rem,45vw)] px-2 py-1.5 font-medium">
                            Описание
                          </th>
                          <th className="min-w-[160px] px-2 py-1.5 font-medium">
                            Моя категория
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedForTable.map((op) => {
                          const dt = new Date(op.occurredAt);
                          const dateStr = Number.isNaN(dt.getTime())
                            ? op.occurredAt.slice(0, 16)
                            : dt.toLocaleString("ru", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              });
                          const desc =
                            op.description?.trim() ||
                            "—";
                          const pick = appCategoryByExternalId[op.externalId] ?? "";
                          const opts = optionsByKind.get(op.kind) ?? [];

                          return (
                            <tr
                              key={op.externalId}
                              className="border-b border-border/60 odd:bg-card/40"
                            >
                              <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
                                {dateStr}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1">
                                {KIND_SHORT[op.kind] ?? op.kind}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums font-medium">
                                {formatRubFractional(op.amount)}
                              </td>
                              <td className="max-w-[140px] px-2 py-1 align-top">
                                <span className="break-words leading-snug">{op.bankCategory}</span>
                              </td>
                              <td className="min-w-[min(28rem,45vw)] max-w-xl px-2 py-1 align-top text-muted-foreground">
                                <div className="break-words leading-snug select-text hyphens-auto">
                                  {desc}
                                </div>
                              </td>
                              <td className="px-1 py-0.5 align-top">
                                <select
                                  value={pick}
                                  onChange={(e) =>
                                    setRowCategory(op.externalId, e.target.value)
                                  }
                                  className="h-8 max-w-[min(220px,28vw)] rounded border border-input bg-card px-1 text-[11px] sm:max-w-none sm:text-xs"
                                >
                                  <option value="">— не выбрано —</option>
                                  {opts.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {error && (
                <p className="shrink-0 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Отмена
              </Button>
              <Button
                type="button"
                disabled={busy || filteredOps.length === 0}
                onClick={() => void runImport()}
              >
                {busy ? "Запись…" : "Импортировать"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
