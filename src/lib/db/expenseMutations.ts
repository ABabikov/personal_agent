import { supabase } from "@/lib/db/supabase";
import type {
  ExpenseKind,
  ExpenseRuleMatchType,
  ExpenseRuleOrigin,
} from "@/types/database";
import type { SberParsedOperation } from "@/lib/features/expenses/sberXlsxImport";

export async function insertManualExpenseTransaction(params: {
  userId: string;
  occurredIsoDate: string;
  accountId: string;
  categoryId: string | null;
  kind: ExpenseKind;
  amount: number;
  description: string | null;
}): Promise<{ id: string } | { error: string }> {
  const occurred_at = `${params.occurredIsoDate}T12:00:00`;
  const { data, error } = await supabase
    .from("expense_transactions")
    .insert({
      user_id: params.userId,
      occurred_at,
      posted_at: null,
      account_id: params.accountId,
      category_id: params.categoryId,
      kind: params.kind,
      amount: params.amount,
      source: "manual",
      description: params.description?.trim() || null,
      merchant: null,
      mcc: null,
      currency: "RUB",
      external_id: null,
      linked_transaction_id: null,
      raw: null,
      pending: false,
      deleted_at: null,
      deleted_reason: null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}

/** Первая доступная запись счёта или создание «Основной». */
export async function ensureDefaultExpenseAccount(
  userId: string
): Promise<{ id: string } | { error: string }> {
  const { data: row, error: selErr } = await supabase
    .from("expense_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selErr) return { error: selErr.message };
  if (row?.id) return { id: row.id };

  const { data: created, error: insErr } = await supabase
    .from("expense_accounts")
    .insert({
      user_id: userId,
      name: "Основной",
      currency: "RUB",
      is_archived: false,
    })
    .select("id")
    .single();
  if (insErr) return { error: insErr.message };
  return { id: created.id };
}

export async function insertExpenseCategory(params: {
  userId: string;
  name: string;
  kind: ExpenseKind;
  parentId?: string | null;
}): Promise<{ id: string } | { error: string }> {
  const name = params.name.trim();
  if (!name) return { error: "Введите название категории." };
  const { data, error } = await supabase
    .from("expense_categories")
    .insert({
      user_id: params.userId,
      parent_id: params.parentId ?? null,
      name,
      kind: params.kind,
      is_archived: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}

const SBER_UPSERT_CHUNK = 60;

/** Импорт операций из выписки Сбербанка (.xlsx). Дубликаты по (user_id, source, external_id) пропускаются. */
export async function upsertSberBankOperations(params: {
  userId: string;
  accountId: string;
  operations: SberParsedOperation[];
  fileLabel: string;
  /** external_id операции → uuid категории в приложении; пусто/null — без категории */
  categoryByExternalId?: Record<string, string>;
}): Promise<
  | { ok: true; inserted: number; skipped: number }
  | { error: string }
> {
  const { userId, accountId, operations, fileLabel, categoryByExternalId } = params;
  if (operations.length === 0) return { ok: true, inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < operations.length; i += SBER_UPSERT_CHUNK) {
    const slice = operations.slice(i, i + SBER_UPSERT_CHUNK);
    const payload = slice.map((op) => ({
      user_id: userId,
      occurred_at: op.occurredAt,
      posted_at: null as string | null,
      account_id: accountId,
      category_id: (() => {
        const id = categoryByExternalId?.[op.externalId]?.trim();
        return id && id.length > 0 ? id : null;
      })() as string | null,
      kind: op.kind,
      amount: op.amount,
      currency: "RUB",
      description:
        [op.bankCategory, op.description].filter((x) => x && String(x).trim()).join(" · ") ||
        null,
      merchant: op.merchant,
      mcc: op.mcc,
      source: "bank_sber" as const,
      external_id: op.externalId,
      linked_transaction_id: null as string | null,
      raw: {
        bank_category: op.bankCategory,
        source_row: op.sourceRow,
        import_file: fileLabel,
        cells: op.rawRow,
      },
      pending: false,
      deleted_at: null as string | null,
      deleted_reason: null as string | null,
    }));

    const { error, count } = await supabase
      .from("expense_transactions")
      .upsert(payload, {
        onConflict: "user_id,source,external_id",
        ignoreDuplicates: true,
        count: "exact",
      });

    if (error) return { error: error.message };
    const n = count ?? 0;
    inserted += n;
    skipped += slice.length - n;
  }

  const dates = operations.map((o) => o.occurredAt.slice(0, 10)).sort();
  const periodFrom = dates[0] ?? null;
  const periodTo = dates[dates.length - 1] ?? null;

  const { error: jrnErr } = await supabase.from("expense_imports").insert({
    user_id: userId,
    source: "bank_sber",
    file_name: fileLabel.slice(0, 500),
    period_from: periodFrom,
    period_to: periodTo,
    rows_total: operations.length,
    rows_inserted: inserted,
    rows_skipped: skipped,
    notes: "__ui:xlsx__",
  });
  if (jrnErr) console.warn("expense_imports:", jrnErr.message);

  return { ok: true, inserted, skipped };
}

export type LearnedRuleInput = {
  matchType: ExpenseRuleMatchType;
  /** уже нормализованный образец (нижний регистр, без лишней пунктуации) */
  pattern: string;
  kind: ExpenseKind;
  categoryId: string;
  origin: ExpenseRuleOrigin;
};

/** Приоритет по силе признака: место сильнее MCC, MCC сильнее категории банка. */
const RULE_PRIORITY: Record<ExpenseRuleMatchType, number> = {
  merchant: 10,
  mcc: 20,
  bank_category: 30,
  description: 40,
};

/**
 * Запоминает подтверждённые на импорте связки «признак → категория».
 * Благодаря этому следующий импорт того же мерчанта не требует ручного выбора.
 * Повторное правило не дублируется, а обновляет категорию и счётчик срабатываний.
 */
export async function saveLearnedCategoryRules(params: {
  userId: string;
  rules: LearnedRuleInput[];
}): Promise<{ ok: true; saved: number } | { error: string }> {
  const { userId } = params;

  // Дедуп внутри одного вызова: upsert падает, если в payload две строки с одним арбитром.
  const byKey = new Map<string, LearnedRuleInput>();
  for (const r of params.rules) {
    const pattern = r.pattern.trim();
    if (!pattern || !r.categoryId) continue;
    byKey.set(`${r.matchType}|${pattern}|${r.kind}`, { ...r, pattern });
  }
  if (byKey.size === 0) return { ok: true, saved: 0 };

  const { data: existing, error: selErr } = await supabase
    .from("expense_category_rules")
    .select("match_type, pattern, kind, hits")
    .eq("user_id", userId)
    .limit(5000);
  if (selErr) return { error: selErr.message };

  const hitsByKey = new Map<string, number>();
  for (const row of existing ?? []) {
    hitsByKey.set(`${row.match_type}|${row.pattern}|${row.kind}`, row.hits ?? 0);
  }

  const payload = Array.from(byKey.entries()).map(([key, r]) => ({
    user_id: userId,
    match_type: r.matchType,
    pattern: r.pattern,
    kind: r.kind,
    category_id: r.categoryId,
    priority: RULE_PRIORITY[r.matchType],
    origin: r.origin,
    hits: (hitsByKey.get(key) ?? 0) + 1,
  }));

  const { error } = await supabase
    .from("expense_category_rules")
    .upsert(payload, { onConflict: "user_id,match_type,pattern,kind" });
  if (error) return { error: error.message };

  return { ok: true, saved: payload.length };
}

/** Скрывает операцию из UI и отчётов (soft delete). */
export async function softDeleteExpenseTransaction(params: {
  userId: string;
  transactionId: string;
}): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("expense_transactions")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_reason: "user_ui",
    })
    .eq("id", params.transactionId)
    .eq("user_id", params.userId)
    .is("deleted_at", null);

  if (error) return { error: error.message };
  return { ok: true };
}
