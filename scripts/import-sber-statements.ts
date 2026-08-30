/**
 * Импорт двух выписок Сбера (текущий счёт + кредитная карта).
 *
 *   npx tsx scripts/import-sber-statements.ts --dry-run
 *   npx tsx scripts/import-sber-statements.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExpenseKind } from "../src/types/database";
import {
  parseSberXlsxArrayBuffer,
  type SberParsedOperation,
} from "../src/lib/features/expenses/sberXlsxImport";
import { groupOperations } from "../src/lib/features/expenses/importGrouping";
import {
  buildSuggestionIndex,
  suggestCategory,
  type SuggestHistoryTx,
  type SuggestRule,
} from "../src/lib/features/expenses/categorySuggest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const FILES: { path: string; accountName: string; accountHint: string }[] = [
  {
    path: "C:/Users/Ababikov/Downloads/28 февраля 2026 - 30 августа 2026.xlsx",
    accountName: "Банк",
    accountHint: "Текущий счёт …73194",
  },
  {
    path: "C:/Users/Ababikov/Downloads/01 марта 2026 - 30 августа 2026.xlsx",
    accountName: "Карта",
    accountHint: "Кредитная карта …27112",
  },
];

function loadEnvFromDotenv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf-8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function fmtRub(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

async function ensureCategory(
  sb: SupabaseClient<Database>,
  userId: string,
  name: string,
  kind: ExpenseKind,
  cache: Map<string, string>
): Promise<string> {
  const key = `${kind}|${name}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { data: existing } = await sb
    .from("expense_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("name", name)
    .is("parent_id", null)
    .eq("is_archived", false)
    .maybeSingle();
  if (existing?.id) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const { data: created, error } = await sb
    .from("expense_categories")
    .insert({
      user_id: userId,
      parent_id: null,
      name,
      kind,
      is_archived: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`category ${name}: ${error.message}`);
  cache.set(key, created.id);
  console.log(`  + категория [${kind}] ${name}`);
  return created.id;
}

async function ensureAccount(
  sb: SupabaseClient<Database>,
  userId: string,
  name: string
): Promise<string> {
  const { data: existing } = await sb
    .from("expense_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .eq("is_archived", false)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await sb
    .from("expense_accounts")
    .insert({
      user_id: userId,
      name,
      currency: "RUB",
      is_archived: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`account ${name}: ${error.message}`);
  console.log(`  + счёт ${name}`);
  return created.id;
}

async function fetchAllHistory(
  sb: SupabaseClient<Database>,
  userId: string
): Promise<SuggestHistoryTx[]> {
  const pageSize = 1000;
  const out: SuggestHistoryTx[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("expense_transactions")
      .select("category_id, kind, merchant, mcc, description, raw")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .not("category_id", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      out.push({
        category_id: r.category_id as string,
        kind: r.kind,
        merchant: r.merchant,
        mcc: r.mcc,
        description: r.description,
        bank_category:
          r.raw && typeof r.raw === "object" && "bank_category" in r.raw
            ? String((r.raw as { bank_category?: unknown }).bank_category ?? "")
            : null,
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

async function upsertOps(
  sb: SupabaseClient<Database>,
  params: {
    userId: string;
    accountId: string;
    operations: SberParsedOperation[];
    fileLabel: string;
    categoryByExternalId: Record<string, string>;
  }
): Promise<{ inserted: number; skipped: number }> {
  const { userId, accountId, operations, fileLabel, categoryByExternalId } =
    params;
  let inserted = 0;
  let skipped = 0;
  const chunk = 60;

  for (let i = 0; i < operations.length; i += chunk) {
    const slice = operations.slice(i, i + chunk);
    const payload = slice.map((op) => ({
      user_id: userId,
      occurred_at: op.occurredAt,
      posted_at: null as string | null,
      account_id: accountId,
      category_id: (() => {
        const id = categoryByExternalId[op.externalId]?.trim();
        return id && id.length > 0 ? id : null;
      })() as string | null,
      kind: op.kind,
      amount: op.amount,
      currency: "RUB",
      description:
        [op.bankCategory, op.description]
          .filter((x) => x && String(x).trim())
          .join(" · ") || null,
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

    const { error, count } = await sb
      .from("expense_transactions")
      .upsert(payload, {
        onConflict: "user_id,source,external_id",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) throw new Error(error.message);
    const n = count ?? 0;
    inserted += n;
    skipped += slice.length - n;
  }

  const dates = operations.map((o) => o.occurredAt.slice(0, 10)).sort();
  await sb.from("expense_imports").insert({
    user_id: userId,
    source: "bank_sber",
    file_name: fileLabel.slice(0, 500),
    period_from: dates[0] ?? null,
    period_to: dates[dates.length - 1] ?? null,
    rows_total: operations.length,
    rows_inserted: inserted,
    rows_skipped: skipped,
    notes: "__cli:sber-xlsx__",
  });

  return { inserted, skipped };
}

async function saveMerchantRules(
  sb: SupabaseClient<Database>,
  userId: string,
  rules: {
    pattern: string;
    kind: ExpenseKind;
    categoryId: string;
  }[]
): Promise<number> {
  let n = 0;
  for (const r of rules) {
    const { error } = await sb.from("expense_category_rules").upsert(
      {
        user_id: userId,
        match_type: "merchant",
        pattern: r.pattern,
        kind: r.kind,
        category_id: r.categoryId,
        priority: 10,
        origin: "learned",
        hits: 1,
      },
      { onConflict: "user_id,match_type,pattern,kind" }
    );
    if (!error) n += 1;
  }
  return n;
}

async function main() {
  loadEnvFromDotenv();
  const dryRun = process.argv.includes("--dry-run");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const userId = (
    process.env.EXPENSES_IMPORT_USER_ID ||
    process.env.WORKOUT_IMPORT_USER_ID ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID ||
    ""
  ).trim();
  if (!url || !key || !userId) {
    console.error("Нужны SUPABASE URL/KEY и WORKOUT_USER_ID");
    process.exit(1);
  }

  const sb = createClient<Database>(url, key);
  console.log(dryRun ? "DRY-RUN" : "IMPORT", "user", userId);

  const catCache = new Map<string, string>();
  if (!dryRun) {
    // «Прочее» уже занято income (unique без kind) — расходная ветка = «Разное»
    await ensureCategory(sb, userId, "Разное", "expense", catCache);
    await ensureCategory(sb, userId, "Снятие наличных", "withdrawal", catCache);
    await ensureCategory(sb, userId, "Переводы", "transfer", catCache);
  }

  const { data: catsRaw, error: catErr } = await sb
    .from("expense_categories")
    .select("id, parent_id, name, kind, is_archived")
    .eq("user_id", userId);
  if (catErr) throw new Error(catErr.message);
  const categories = (catsRaw ?? []).filter((c) => !c.is_archived);

  const { data: rulesRaw } = await sb
    .from("expense_category_rules")
    .select("match_type, pattern, kind, category_id, priority")
    .eq("user_id", userId);
  const rules = (rulesRaw ?? []) as SuggestRule[];
  const history = await fetchAllHistory(sb, userId);
  console.log(
    `cats=${categories.length} rules=${rules.length} history=${history.length}`
  );

  const index = buildSuggestionIndex({ categories, rules, history });
  const transferCatId = categories.find(
    (c) => c.kind === "transfer" && c.name === "Переводы" && !c.parent_id
  )?.id;
  const withdrawalCatId = categories.find(
    (c) =>
      c.kind === "withdrawal" && c.name === "Снятие наличных" && !c.parent_id
  )?.id;

  let totalInserted = 0;
  let totalSkipped = 0;
  const controversial: string[] = [];
  const learnedRules: {
    pattern: string;
    kind: ExpenseKind;
    categoryId: string;
  }[] = [];

  for (const file of FILES) {
    if (!existsSync(file.path)) {
      console.error("Нет файла:", file.path);
      continue;
    }
    const buf = readFileSync(file.path);
    const parsed = await parseSberXlsxArrayBuffer(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    const groups = groupOperations(parsed.operations);
    const accountId = dryRun
      ? "dry"
      : await ensureAccount(sb, userId, file.accountName);

    console.log("\n" + "=".repeat(64));
    console.log(
      `${basename(file.path)} → счёт «${file.accountName}» (${file.accountHint})`
    );
    console.log(
      `ops=${parsed.operations.length} issues=${parsed.issues.length} groups=${groups.length}`
    );

    const byKind = new Map<string, { n: number; sum: number }>();
    for (const op of parsed.operations) {
      const cur = byKind.get(op.kind) ?? { n: 0, sum: 0 };
      cur.n += 1;
      cur.sum += op.amount;
      byKind.set(op.kind, cur);
    }
    for (const [k, v] of byKind) {
      console.log(`  ${k}: ${v.n} шт / ${fmtRub(v.sum)} ₽`);
    }

    const categoryByExternalId: Record<string, string> = {};
    let withCat = 0;
    let withoutCat = 0;

    for (const g of groups) {
      let categoryId: string | null = null;
      let reason = "";

      if (g.kind === "transfer") {
        categoryId = transferCatId ?? null;
        reason = "перевод";
      } else if (g.kind === "withdrawal") {
        categoryId = withdrawalCatId ?? null;
        reason = "снятие";
      } else {
        const sug = suggestCategory(
          {
            kind: g.kind,
            merchant: g.merchant,
            mcc: g.mcc,
            bankCategory: g.bankCategory,
            description: g.sampleDescriptions[0] ?? null,
          },
          index
        );
        if (sug) {
          categoryId = sug.categoryId;
          reason = `${sug.source} ${sug.confidence.toFixed(2)}: ${sug.reason}`;
          if (g.merchantKey && sug.confidence >= 0.65) {
            learnedRules.push({
              pattern: g.merchantKey,
              kind: g.kind,
              categoryId: sug.categoryId,
            });
          }
          if (sug.confidence < 0.6) {
            controversial.push(
              `[${file.accountName}] ${g.label} ×${g.operations.length} ${fmtRub(g.total)} ₽ → ? ${reason}`
            );
          }
        } else {
          controversial.push(
            `[${file.accountName}] ${g.label} ×${g.operations.length} ${fmtRub(g.total)} ₽ | ${g.bankCategory} | ${(g.sampleDescriptions[0] ?? "").slice(0, 100)}`
          );
        }
      }

      for (const op of g.operations) {
        if (categoryId) {
          categoryByExternalId[op.externalId] = categoryId;
          withCat += 1;
        } else {
          withoutCat += 1;
        }
      }

      if (!categoryId || g.kind === "transfer" || g.kind === "withdrawal") {
        // already handled
      }
    }

    console.log(`категории: ${withCat} с / ${withoutCat} без`);

    if (dryRun) {
      console.log("(dry-run — в БД не пишем)");
      continue;
    }

    const res = await upsertOps(sb, {
      userId,
      accountId,
      operations: parsed.operations,
      fileLabel: basename(file.path),
      categoryByExternalId,
    });
    console.log(`записано: inserted=${res.inserted} skipped=${res.skipped}`);
    totalInserted += res.inserted;
    totalSkipped += res.skipped;
  }

  if (!dryRun && learnedRules.length > 0) {
    // уникальные по pattern+kind
    const uniq = new Map<string, (typeof learnedRules)[0]>();
    for (const r of learnedRules) {
      uniq.set(`${r.kind}|${r.pattern}`, r);
    }
    const n = await saveMerchantRules(sb, userId, [...uniq.values()]);
    console.log(`\nправил сохранено: ${n}`);
  }

  console.log("\n" + "=".repeat(64));
  if (!dryRun) {
    console.log(`ИТОГО inserted=${totalInserted} skipped=${totalSkipped}`);
  }
  console.log(`\nСпорные / без категории (${controversial.length}):`);
  for (const line of controversial.slice(0, 60)) console.log(" •", line);
  if (controversial.length > 60) {
    console.log(` … и ещё ${controversial.length - 60}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
