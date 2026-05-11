/**
 * Импорт истории операций из экспорта Money Manager (.xls, на самом деле HTML)
 * в таблицы expense_* в Supabase.
 *
 * Запуск:
 *   npm run seed:expenses:dry                    # парсит, печатает сводку, БД не трогает
 *   npm run seed:expenses:dry -- --print-unmapped # печатает только пары без маппинга
 *   npm run seed:expenses                        # реальный импорт
 *
 * Переменные окружения (читаются из .env, как в seed-workouts):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY — для записи.
 *   EXPENSES_IMPORT_USER_ID (или WORKOUT_IMPORT_USER_ID / NEXT_PUBLIC_WORKOUT_USER_ID
 *     как fallback) — UUID существующего пользователя; если не задан, создаётся новый.
 *   EXPENSES_MM_FILE — абсолютный путь к Money Manager .xls.
 *     По умолчанию ищем `<repo>/docs/features/expenses/current_stat/Money Manager_*.xls`,
 *     потом `C:/Users/Ababikov/Downloads/Money Manager_*.xls` (для локалки автора).
 *
 * Идемпотентность: уникальный индекс (user_id, source, external_id) в схеме —
 * повторный запуск не плодит дубли. external_id считается от исходных полей MM.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import {
  parseMoneyManagerHtml,
  mmKindToInternal,
  type MmRow,
} from "../src/lib/features/expenses/moneyManagerImport";
import { lookupMapping, mmKey, withdrawalTarget } from "./expenses/categoryMap";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const IMPORT_NOTE = "__seed:money-manager__";

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

function findMmFile(): string {
  const explicit = process.env.EXPENSES_MM_FILE?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [
    join(root, "docs", "features", "expenses", "current_stat"),
    "C:/Users/Ababikov/Downloads",
  ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const found = readdirSync(dir).filter(
      (n) => n.toLowerCase().startsWith("money manager") && n.toLowerCase().endsWith(".xls")
    );
    if (found.length > 0) {
      found.sort();
      return join(dir, found[found.length - 1]); // latest by name
    }
  }
  console.error(
    "Не нашёл файл Money Manager. Положите его в docs/features/expenses/current_stat/Money Manager_*.xls\n" +
      "или задайте EXPENSES_MM_FILE=<абсолютный путь> в .env"
  );
  process.exit(1);
}

type AggKey = { category: string; subcategory: string };

function aggregateRows(rows: MmRow[]): {
  unmapped: AggKey[];
  byTargetCategory: Map<string, number>;
  byAccount: Map<string, number>;
  total: number;
  income: number;
  expense: number;
  withdrawal: number;
} {
  const unmappedSet = new Map<string, AggKey>();
  const byTargetCategory = new Map<string, number>();
  const byAccount = new Map<string, number>();
  let income = 0;
  let expense = 0;
  let withdrawal = 0;

  for (const r of rows) {
    const internal = mmKindToInternal(r.kindRaw);
    if (internal === "income") income += r.amountRub;
    else if (internal === "expense") expense += r.amountRub;
    else if (internal === "withdrawal") withdrawal += r.amountRub;

    byAccount.set(r.account, (byAccount.get(r.account) ?? 0) + 1);

    let target = lookupMapping(r.category, r.subcategory);
    if (!target && internal === "withdrawal") target = withdrawalTarget();
    if (!target) {
      const key = mmKey(r.category, r.subcategory);
      if (!unmappedSet.has(key)) {
        unmappedSet.set(key, { category: r.category, subcategory: r.subcategory });
      }
      continue;
    }
    byTargetCategory.set(target.category, (byTargetCategory.get(target.category) ?? 0) + 1);
  }

  return {
    unmapped: Array.from(unmappedSet.values()),
    byTargetCategory,
    byAccount,
    total: rows.length,
    income,
    expense,
    withdrawal,
  };
}

function printUnmapped(unmapped: AggKey[]) {
  if (unmapped.length === 0) {
    console.log("Все пары категорий из MM уже замаплены.");
    return;
  }
  console.log(
    `\nНезамапленные пары категорий (${unmapped.length}). Скопируйте в scripts/expenses/categoryMap.ts:\n`
  );
  for (const k of unmapped) {
    const sub = k.subcategory.length > 0 ? `subcategory: ${JSON.stringify(k.subcategory.toLowerCase())}` : "";
    console.log(
      `  [mmKey(${JSON.stringify(k.category)}, ${JSON.stringify(k.subcategory)})]: { category: "TODO" ${sub ? ", " + sub : ""} },`
    );
  }
}

function printSummary(rows: MmRow[]) {
  const agg = aggregateRows(rows);
  console.log(`\nИтого строк: ${agg.total}`);
  console.log(
    `  Доход: ${agg.income.toFixed(2)} RUB   Расход: ${agg.expense.toFixed(2)} RUB   Снятие: ${agg.withdrawal.toFixed(2)} RUB`
  );
  console.log(`  Счёта: ${[...agg.byAccount.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}`);
  console.log(`  Незамапленных пар категорий: ${agg.unmapped.length}`);
  if (agg.unmapped.length > 0) {
    console.log("  → запустите с --print-unmapped, чтобы увидеть и дополнить categoryMap.ts");
  }
  console.log(`  Распределение по итоговым категориям (после маппинга):`);
  const entries = [...agg.byTargetCategory.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of entries) {
    console.log(`    ${v.toString().padStart(5)}  ${k}`);
  }
}

type AccountId = string;
type CategoryId = string;

async function resolveUserId(supabase: SupabaseClient<Database>): Promise<string> {
  let userId =
    process.env.EXPENSES_IMPORT_USER_ID?.trim() ||
    process.env.WORKOUT_IMPORT_USER_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim();

  if (userId && userId.length > 0) return userId;

  const { data, error } = await supabase
    .from("users")
    .insert({
      telegram_id: null,
      weight: null,
      height: null,
      age: null,
      gender: null,
      activity_level: null,
      body_fat_pct: null,
      swim_equipment: null,
    } satisfies Database["public"]["Tables"]["users"]["Insert"])
    .select("id")
    .single();

  if (error || !data) {
    console.error("Не удалось создать пользователя:", error?.message);
    process.exit(1);
  }
  userId = data.id;
  console.log(
    "\nСоздан новый users.id — добавьте в .env для того же аккаунта, что и в браузере:\n" +
      `  NEXT_PUBLIC_WORKOUT_USER_ID=${userId}\n` +
      `  EXPENSES_IMPORT_USER_ID=${userId}\n`
  );
  return userId;
}

async function ensureAccount(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string,
  cache: Map<string, AccountId>
): Promise<AccountId> {
  const cached = cache.get(name);
  if (cached) return cached;

  const { data: existing, error: selErr } = await supabase
    .from("expense_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  if (selErr) {
    console.error("expense_accounts select error:", selErr.message);
    process.exit(1);
  }
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }

  const { data: created, error: insErr } = await supabase
    .from("expense_accounts")
    .insert({
      user_id: userId,
      name,
      currency: "RUB",
      is_archived: false,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    console.error("expense_accounts insert error:", insErr?.message);
    process.exit(1);
  }
  cache.set(name, created.id);
  return created.id;
}

async function ensureCategory(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string,
  kind: Database["public"]["Tables"]["expense_categories"]["Row"]["kind"],
  parentId: CategoryId | null,
  cache: Map<string, CategoryId>
): Promise<CategoryId> {
  const cacheKey = `${parentId ?? "ROOT"}|${name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let query = supabase
    .from("expense_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name);
  query = parentId == null ? query.is("parent_id", null) : query.eq("parent_id", parentId);
  const { data: existing, error: selErr } = await query.maybeSingle();
  if (selErr) {
    console.error("expense_categories select error:", selErr.message);
    process.exit(1);
  }
  if (existing) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }

  const { data: created, error: insErr } = await supabase
    .from("expense_categories")
    .insert({
      user_id: userId,
      name,
      kind,
      parent_id: parentId,
      is_archived: false,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    console.error("expense_categories insert error:", insErr?.message);
    process.exit(1);
  }
  cache.set(cacheKey, created.id);
  return created.id;
}

async function main() {
  loadEnvFromDotenv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyUnmapped = args.includes("--print-unmapped");

  const filePath = findMmFile();
  console.log(`Файл: ${filePath}`);
  const html = readFileSync(filePath, "utf-8");
  const rows = parseMoneyManagerHtml(html);
  console.log(`Распарсено строк операций: ${rows.length}`);

  if (onlyUnmapped) {
    const agg = aggregateRows(rows);
    printUnmapped(agg.unmapped);
    process.exit(0);
  }

  printSummary(rows);

  if (dryRun) {
    console.log("\ndry-run: Supabase не вызывается.");
    process.exit(0);
  }

  // Проверка: есть ли незамапленные пары → стоп.
  const agg = aggregateRows(rows);
  if (agg.unmapped.length > 0) {
    console.error(
      `\nЕсть ${agg.unmapped.length} незамапленных пар категорий. Запустите с --print-unmapped, добавьте в categoryMap.ts, повторите.`
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в .env");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key);
  const userId = await resolveUserId(supabase);
  console.log(`user_id: ${userId}`);

  const accountCache = new Map<string, AccountId>();
  const categoryCache = new Map<string, CategoryId>();

  let inserted = 0;
  let skipped = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const internal = mmKindToInternal(r.kindRaw);

    let target = lookupMapping(r.category, r.subcategory);
    if (!target && internal === "withdrawal") target = withdrawalTarget();
    if (!target) {
      console.error(
        `[${i}] Незамапленная пара (${r.category} / ${r.subcategory}) — это уже должно было быть отловлено`
      );
      process.exit(1);
    }

    const kind = target.kindOverride ?? internal;
    const accountId = await ensureAccount(supabase, userId, r.account, accountCache);
    const parentId = await ensureCategory(supabase, userId, target.category, kind, null, categoryCache);
    const categoryId =
      target.subcategory != null && target.subcategory.length > 0
        ? await ensureCategory(supabase, userId, target.subcategory, kind, parentId, categoryCache)
        : parentId;

    const { error: insErr, count } = await supabase
      .from("expense_transactions")
      .upsert(
        {
          user_id: userId,
          occurred_at: r.occurredAt,
          posted_at: null,
          account_id: accountId,
          category_id: categoryId,
          kind,
          amount: r.amountRub,
          currency: "RUB",
          description: r.notes || null,
          merchant: null,
          mcc: null,
          source: "money_manager",
          external_id: r.externalId,
          linked_transaction_id: null,
          raw: {
            mm_category: r.category,
            mm_subcategory: r.subcategory,
            mm_kind: r.kindRaw,
            cells: r.rawCells,
          },
          pending: false,
          deleted_at: null,
          deleted_reason: null,
        },
        { onConflict: "user_id,source,external_id", ignoreDuplicates: true, count: "exact" }
      );

    if (insErr) {
      console.error(`[${i}] insert error:`, insErr.message);
      process.exit(1);
    }
    if ((count ?? 0) > 0) inserted++;
    else skipped++;

    const dateOnly = r.occurredAt.slice(0, 10);
    if (dateOnly < minDate) minDate = dateOnly;
    if (dateOnly > maxDate) maxDate = dateOnly;

    if ((i + 1) % 200 === 0) {
      console.log(`  …${i + 1}/${rows.length} (вставлено ${inserted}, пропущено ${skipped})`);
    }
  }

  const { error: jrnErr } = await supabase.from("expense_imports").insert({
    user_id: userId,
    source: "money_manager",
    file_name: basename(filePath),
    period_from: minDate <= maxDate ? minDate : null,
    period_to: minDate <= maxDate ? maxDate : null,
    rows_total: rows.length,
    rows_inserted: inserted,
    rows_skipped: skipped,
    notes: IMPORT_NOTE,
  });
  if (jrnErr) console.warn("expense_imports insert warn:", jrnErr.message);

  console.log(`\nГотово. Вставлено: ${inserted}, пропущено (уже было): ${skipped}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
