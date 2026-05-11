import { supabase } from "@/lib/db/supabase";
import type { ExpenseKind } from "@/types/database";
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
