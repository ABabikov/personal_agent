/**
 * Прогноз доходов/расходов: НГ-хвост + база до лета 2027.
 *
 * Правила (актуализация 30.10.2026):
 *   — аренда, коммуналка, короткий отпуск, НГ → дебет (Банк)
 *   — базовые траты → кредитка (Карта), ~100к/мес (~3.3к/день)
 *   — большой отпуск 14–29.11 не закладываем (деньги отложены)
 *   — до 11.11: кэш копим → полное гашение ОД одним платежом
 *   — с янв 2027: обычный ритм аванс 25-го / ЗП 10-го; гашение ОД с ЗП
 *   — горизонт базы: янв–июнь 2027 (до лета)
 *   — разовые: долг маме 60к (25.01, сразу после аванса), Питер ~150к (15.06)
 *
 *   npx tsx scripts/seed-forecast-nye.ts --dry-run
 *   npx tsx scripts/seed-forecast-nye.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExpenseKind } from "../src/types/database";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Факт ~30.10: долг карты */
const START_CARD_DEBT = 200_000;
/** Факт ~30.10: живые деньги на счетах */
const START_DEBIT = 125_000;

function loadEnv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
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
  // подкатегория? (аренда)
  const { data: child } = await sb
    .from("expense_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("name", name)
    .eq("is_archived", false)
    .not("parent_id", "is", null)
    .maybeSingle();
  if (child?.id) {
    cache.set(key, child.id);
    return child.id;
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
  if (error) throw new Error(`category ${kind}/${name}: ${error.message}`);
  cache.set(key, created.id);
  console.log(`  + категория [${kind}] ${name}`);
  return created.id;
}

async function ensureAccount(
  sb: SupabaseClient<Database>,
  userId: string,
  name: string
): Promise<string> {
  const { data } = await sb
    .from("expense_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .eq("is_archived", false)
    .maybeSingle();
  if (!data?.id) throw new Error(`нет счёта «${name}»`);
  return data.id;
}

type Planned = {
  date: string;
  kind: ExpenseKind;
  amount: number;
  slug: string;
  description: string;
  merchant?: string;
  account?: "Банк" | "Карта" | "Альфа";
  categoryName?: string;
};

const AVG_HALF = 115_020;
/** База на карте без аренды/разовых: ~3.3к/день ≈ 100к/мес */
const BASE_CARD_MONTH = 100_000;
const RENT = 52_000;
/** Коммуналка/дом по базе (исторически ~9к; округление) */
const UTILITIES = 10_000;

const MONTH_RU = [
  "",
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Обычный месяц: аванс 25-го / ЗП 10-го след.мес / аренда / коммуналка / база карта / гашение с ЗП */
function buildBaseMonths(fromYm: string, toYm: string): Planned[] {
  const out: Planned[] = [];
  let [y, m] = fromYm.split("-").map(Number);
  const [ey, em] = toYm.split("-").map(Number);

  while (y < ey || (y === ey && m <= em)) {
    const label = MONTH_RU[m];
    const ym = `${y}-${String(m).padStart(2, "0")}`;

    // аванс текущего месяца (25-е)
    out.push({
      date: ymd(y, m, 25),
      kind: "income",
      amount: AVG_HALF,
      slug: `advance-${ym}`,
      description: `[прогноз] Аванс ${label} ${y}`,
      merchant: "Зарплата (аванс)",
      account: "Банк",
    });

    // база месяца на карте (середина месяца)
    out.push({
      date: ymd(y, m, 20),
      kind: "expense",
      amount: BASE_CARD_MONTH,
      slug: `base-card-${ym}`,
      description: `[прогноз] База ${label} ${y} с кредитки (~100к, без аренды)`,
      merchant: "Базовые расходы",
      account: "Карта",
    });

    // коммуналка 15-го с дебета
    out.push({
      date: ymd(y, m, 15),
      kind: "expense",
      amount: UTILITIES,
      slug: `utilities-${ym}`,
      description: `[прогноз] Коммуналка / дом ${label} ${y}`,
      merchant: "Коммуналка",
      account: "Банк",
    });

    // ЗП за этот месяц → 10-е следующего + аренда + гашение ОД (~база прошлого цикла)
    let ny = y;
    let nm = m + 1;
    if (nm > 12) {
      nm = 1;
      ny++;
    }
    const nextYm = `${ny}-${String(nm).padStart(2, "0")}`;
    out.push({
      date: ymd(ny, nm, 10),
      kind: "income",
      amount: AVG_HALF,
      slug: `salary-${ym}`,
      description: `[прогноз] ЗП за ${label} ${y}`,
      merchant: "Зарплата",
      account: "Банк",
    });
    out.push({
      date: ymd(ny, nm, 10),
      kind: "expense",
      amount: RENT,
      slug: `rent-${nextYm}`,
      description: `[прогноз] Аренда ${MONTH_RU[nm]} ${ny}`,
      merchant: "Аренда",
      account: "Банк",
      categoryName: "аренда",
    });
    out.push({
      date: ymd(ny, nm, 10),
      kind: "transfer",
      amount: BASE_CARD_MONTH,
      slug: `pay-card-${nextYm}`,
      description: `[прогноз] Гашение ОД с ЗП за ${label} (база ~100к → к 0)`,
      merchant: "Погашение ОД",
      account: "Банк",
      categoryName: "Переводы",
    });

    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function buildPlan(): Planned[] {
  const VAC_BIG = 126_000;
  const VAC_SHORT = 31_400;
  /** Оценка ОД к 11.11: факт 200к + хвост базы до отпуска */
  const PAY_FULL_NOV = 240_000;
  /** Оценка ОД к янв. ЗП: база дек/янв после нуля 11.11 */
  const PAY_FULL_JAN = 105_000;

  const special: Planned[] = [
    // —— доходы → Банк (с 30.10; окт. аванс уже в START_DEBIT) ——
    {
      date: "2026-11-10",
      kind: "income",
      amount: AVG_HALF,
      slug: "salary-oct",
      description: "[прогноз] ЗП за октябрь (полный месяц)",
      merchant: "Зарплата",
      account: "Банк",
    },
    {
      date: "2026-11-11",
      kind: "income",
      amount: VAC_BIG,
      slug: "vacation-pay-nov",
      description:
        "[прогноз] Отпускные 14–29.11 (16 к.дн). Заменяют оклад за дни отпуска",
      merchant: "Отпускные",
      account: "Банк",
    },
    {
      date: "2026-11-25",
      kind: "income",
      amount: AVG_HALF,
      slug: "advance-nov-full",
      description:
        "[прогноз] Аванс ноябрь полный (работа до 14.11; с 14-го отпуск)",
      merchant: "Зарплата (аванс)",
      account: "Банк",
    },
    {
      date: "2026-11-28",
      kind: "income",
      amount: VAC_SHORT,
      slug: "vacation-pay-dec",
      description:
        "[прогноз] Отпускные 3–6.12 (4 к.дн). Выплата за 3 дня до отпуска",
      merchant: "Отпускные",
      account: "Банк",
    },
    // ЗП в декабре нет: ноябрь закрыт отпускными+авансом; декабрь → январь
    {
      date: "2027-01-09",
      kind: "income",
      amount: 200_000,
      slug: "salary-dec-jan",
      description:
        "[прогноз] ЗП за декабрь в январе (в декабре выплаты ЗП нет; минус уже выданные отпускные 3–6.12)",
      merchant: "Зарплата",
      account: "Банк",
    },

    // —— дебет: аренда / коммуналка / развлечения (НГ-хвост) ——
    {
      date: "2026-11-10",
      kind: "expense",
      amount: RENT,
      slug: "rent-nov",
      description: "[прогноз] Аренда ноябрь",
      merchant: "Аренда",
      account: "Банк",
      categoryName: "аренда",
    },
    {
      date: "2026-12-10",
      kind: "expense",
      amount: RENT,
      slug: "rent-dec",
      description: "[прогноз] Аренда декабрь",
      merchant: "Аренда",
      account: "Банк",
      categoryName: "аренда",
    },
    {
      date: "2027-01-10",
      kind: "expense",
      amount: RENT,
      slug: "rent-jan",
      description: "[прогноз] Аренда январь",
      merchant: "Аренда",
      account: "Банк",
      categoryName: "аренда",
    },
    {
      date: "2026-11-15",
      kind: "expense",
      amount: 15_000,
      slug: "utilities-1",
      description: "[прогноз] Коммуналка / дом (часть 1 из ~30к до НГ)",
      merchant: "Коммуналка",
      account: "Банк",
    },
    {
      date: "2026-12-15",
      kind: "expense",
      amount: 15_000,
      slug: "utilities-2",
      description: "[прогноз] Коммуналка / дом (часть 2 из ~30к до НГ)",
      merchant: "Коммуналка",
      account: "Банк",
    },
    {
      date: "2026-12-03",
      kind: "expense",
      amount: 50_000,
      slug: "short-trip",
      description: "[прогноз] Короткий отпуск 3–6.12 (~50к) — с дебета",
      merchant: "Путешествия",
      account: "Банк",
      categoryName: "Путешествия",
    },
    {
      date: "2026-12-28",
      kind: "expense",
      amount: 18_000,
      slug: "nye-1",
      description: "[прогноз] НГ: часть 1 (18к) — с дебета",
      merchant: "Праздники",
      account: "Банк",
      categoryName: "Праздники",
    },
    {
      date: "2026-12-31",
      kind: "expense",
      amount: 35_000,
      slug: "nye-2",
      description: "[прогноз] НГ: часть 2 (35к) — с дебета",
      merchant: "Праздники",
      account: "Банк",
      categoryName: "Праздники",
    },
    {
      date: "2027-01-02",
      kind: "expense",
      amount: 30_000,
      slug: "nye-3",
      description: "[прогноз] НГ: часть 3 (30к) — с дебета",
      merchant: "Праздники",
      account: "Банк",
      categoryName: "Праздники",
    },

    // —— Шерегеш: траты уже в выписке; остались взаиморасчёты ——
    {
      date: "2026-10-26",
      kind: "income",
      amount: 9_500,
      slug: "sheregesh-owed-to-me",
      description:
        "[прогноз] Шерегеш: мне должны 9 500 ₽ — заменить фактом перевода",
      merchant: "Долг мне / Шерегеш",
      account: "Банк",
    },
    {
      date: "2026-10-26",
      kind: "expense",
      amount: 4_000,
      slug: "sheregesh-i-owe",
      description:
        "[прогноз] Шерегеш: я должен ~4 000 ₽ — заменить фактом",
      merchant: "Долг мой / Шерегеш",
      account: "Банк",
    },

    // —— кредитка: только база (большой отпуск не трогаем) ——
    {
      date: "2026-11-05",
      kind: "expense",
      amount: 40_000,
      slug: "base-nov1-13",
      description:
        "[прогноз] Хвост базы 1–13.11 с кредитки (~13 дн × ~3.1к; до отпуска)",
      merchant: "Базовые расходы",
      account: "Карта",
    },
    {
      date: "2026-12-01",
      kind: "expense",
      amount: 10_000,
      slug: "base-nov30-dec2",
      description: "[прогноз] База 30.11–2.12 с кредитки (~3 дн)",
      merchant: "Базовые расходы",
      account: "Карта",
    },
    {
      date: "2026-12-20",
      kind: "expense",
      amount: 70_000,
      slug: "base-dec7-27",
      description:
        "[прогноз] База 7–27.12 с кредитки (~21 дн × ~3.3к; без аренды и НГ)",
      merchant: "Базовые расходы",
      account: "Карта",
    },
    {
      date: "2027-01-08",
      kind: "expense",
      amount: 25_000,
      slug: "base-jan3-10",
      description: "[прогноз] База 3–10.01 с кредитки (до прихода дек. ЗП)",
      merchant: "Базовые расходы",
      account: "Карта",
    },

    // —— гашение: одним объёмом до НГ ——
    {
      date: "2026-11-11",
      kind: "transfer",
      amount: PAY_FULL_NOV,
      slug: "pay-card-nov-full",
      description:
        "[прогноз] Полное гашение ОД после ЗП+отпускных−аренда (кэш копили до полного объёма)",
      merchant: "Погашение ОД",
      account: "Банк",
      categoryName: "Переводы",
    },
    {
      date: "2027-01-09",
      kind: "transfer",
      amount: PAY_FULL_JAN,
      slug: "pay-card-jan-full",
      description:
        "[прогноз] Гашение накопившейся базы дек/янв с январской ЗП → к 0 по ОД",
      merchant: "Погашение ОД",
      account: "Банк",
      categoryName: "Переводы",
    },

    // —— хвост января после нуля 09.01 (до входа в регулярную базу с фев) ——
    {
      date: "2027-01-20",
      kind: "expense",
      amount: 66_000,
      slug: "base-jan11-31",
      description:
        "[прогноз] База 11–31.01 с кредитки (~20 дн × ~3.3к; после гашения 09.01)",
      merchant: "Базовые расходы",
      account: "Карта",
    },
    {
      date: "2027-01-15",
      kind: "expense",
      amount: UTILITIES,
      slug: "utilities-jan",
      description: "[прогноз] Коммуналка / дом январь 2027",
      merchant: "Коммуналка",
      account: "Банк",
    },
    {
      date: "2027-01-25",
      kind: "income",
      amount: AVG_HALF,
      slug: "advance-jan",
      description: "[прогноз] Аванс январь 2027",
      merchant: "Зарплата (аванс)",
      account: "Банк",
    },
    // ЗП за январь + аренда фев + гашение янв. базы → 10.02
    {
      date: "2027-02-10",
      kind: "income",
      amount: AVG_HALF,
      slug: "salary-jan",
      description: "[прогноз] ЗП за январь 2027",
      merchant: "Зарплата",
      account: "Банк",
    },
    {
      date: "2027-02-10",
      kind: "expense",
      amount: RENT,
      slug: "rent-feb",
      description: "[прогноз] Аренда февраль 2027",
      merchant: "Аренда",
      account: "Банк",
      categoryName: "аренда",
    },
    {
      date: "2027-02-10",
      kind: "transfer",
      amount: 66_000,
      slug: "pay-card-feb",
      description:
        "[прогноз] Гашение ОД с ЗП за январь (база 11–31.01 → к 0)",
      merchant: "Погашение ОД",
      account: "Банк",
      categoryName: "Переводы",
    },
  ];

  // Регулярная база фев–июнь 2027 → ЗП/аренда/гашение до 10.07 (лето)
  const base = buildBaseMonths("2027-02", "2027-06");

  const extras: Planned[] = [
    // остаток долга маме — ближайшая возможность после НГ (аванс 25.01;
    // до этого после аренды 10.01 на руках ~54к < 60к)
    {
      date: "2027-01-25",
      kind: "expense",
      amount: 60_000,
      slug: "debt-mom-remainder",
      description:
        "[прогноз] Остаток долга маме (60к) — сразу после аванса, первая возможность после НГ",
      merchant: "Долг / мама",
      account: "Банк",
      categoryName: "Долг",
    },
    // Питер с дочей в июне — после ЗП 10.06 (за май)
    {
      date: "2027-06-15",
      kind: "expense",
      amount: 150_000,
      slug: "trip-spb-june",
      description:
        "[прогноз] Поездка в Питер с дочей (~150к) — с дебета",
      merchant: "Путешествия / Питер",
      account: "Банк",
      categoryName: "Путешествия",
    },
  ];

  return [...special, ...base, ...extras];
}

function simulate(plan: Planned[]) {
  let debit = START_DEBIT;
  let card = START_CARD_DEBT;
  let minDebit = debit;
  let hitZero = false;
  const zeroDates: string[] = [];

  console.log(
    `\n=== Двойной баланс (старт дебет ${fmt(START_DEBIT)}, долг карты ${fmt(START_CARD_DEBT)}) ===`
  );

  const sorted = [...plan].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    // доходы раньше расходов/гашений в тот же день
    const rank = (k: ExpenseKind) =>
      k === "income" ? 0 : k === "expense" ? 1 : 2;
    return rank(a.kind) - rank(b.kind);
  });

  for (const p of sorted) {
    const acc = p.account ?? "Банк";
    if (p.kind === "income") {
      debit += p.amount;
    } else if (p.kind === "transfer") {
      // гашение: с дебета на карту
      debit -= p.amount;
      card = Math.max(0, card - p.amount);
    } else if (p.kind === "expense") {
      if (acc === "Карта") card += p.amount;
      else debit -= p.amount;
    }
    if (card === 0) {
      if (!hitZero) hitZero = true;
      if (!zeroDates.includes(p.date)) zeroDates.push(p.date);
    }
    minDebit = Math.min(minDebit, debit);
    const mark = card === 0 ? "  ← карта 0" : "";
    const warn = debit < 0 ? "  ← ДЕФИЦИТ ДЕБЕТА" : "";
    console.log(
      `  ${p.date}  D=${fmt(debit).padStart(8)}  C=${fmt(card).padStart(8)}  ${p.slug}${mark}${warn}`
    );
  }

  console.log(`\nМин. дебет: ${fmt(minDebit)}`);
  console.log(
    hitZero
      ? `Карта в 0: да (${zeroDates.join(", ")})`
      : "Карта в 0: нет — увеличь гашения"
  );
  console.log(
    debit < 0 || minDebit < 0
      ? "Кассовый разрыв по дебету: да"
      : "Кассовый разрыв по дебету: нет"
  );
}

async function main() {
  loadEnv();
  const dry = process.argv.includes("--dry-run");
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
  const plan = buildPlan();
  const cache = new Map<string, string>();

  console.log(dry ? "DRY-RUN" : "SEED", "forecast items", plan.length);

  const expCat = dry
    ? "dry"
    : await ensureCategory(sb, userId, "прогноз", "expense", cache);
  const incCat = dry
    ? "dry"
    : await ensureCategory(sb, userId, "прогноз доход", "income", cache);
  const trCat = dry
    ? "dry"
    : await ensureCategory(sb, userId, "Переводы", "transfer", cache);

  const accIds: Record<string, string> = {};
  if (!dry) {
    for (const name of ["Банк", "Карта", "Альфа"] as const) {
      accIds[name] = await ensureAccount(sb, userId, name);
    }
  }

  const rows: {
    user_id: string;
    occurred_at: string;
    posted_at: null;
    account_id: string;
    category_id: string;
    kind: ExpenseKind;
    amount: number;
    currency: string;
    description: string;
    merchant: string | null;
    mcc: null;
    source: "manual";
    external_id: string;
    linked_transaction_id: null;
    raw: Record<string, unknown>;
    pending: boolean;
    deleted_at: null;
    deleted_reason: null;
  }[] = [];

  for (const p of plan) {
    const sign =
      p.kind === "income" ? "+" : p.kind === "transfer" ? "→" : "−";
    console.log(
      `  ${p.date} ${sign}${fmt(p.amount)} ₽  [${p.account}] ${p.description.slice(0, 60)}`
    );

    if (dry) continue;
    const accountId = accIds[p.account ?? "Банк"];
    if (!accountId) throw new Error("нет account_id");

    let categoryId: string;
    if (p.categoryName) {
      categoryId = await ensureCategory(
        sb,
        userId,
        p.categoryName,
        p.kind,
        cache
      );
    } else if (p.kind === "income") categoryId = incCat;
    else if (p.kind === "transfer") categoryId = trCat;
    else categoryId = expCat;

    rows.push({
      user_id: userId,
      occurred_at: `${p.date}T12:00:00`,
      posted_at: null,
      account_id: accountId,
      category_id: categoryId,
      kind: p.kind,
      amount: p.amount,
      currency: "RUB",
      description: p.description,
      merchant: p.merchant ?? null,
      mcc: null,
      source: "manual",
      external_id: `forecast:${p.date}:${p.slug}`,
      linked_transaction_id: null,
      raw: {
        forecast: true,
        slug: p.slug,
        replace_with_fact: true,
        card_paydown: p.kind === "transfer",
      },
      pending: true,
      deleted_at: null,
      deleted_reason: null,
    });
  }

  simulate(plan);

  if (dry) return;

  // снести все прошлые forecast:* этого юзера
  const { error: delErr } = await sb
    .from("expense_transactions")
    .delete()
    .eq("user_id", userId)
    .eq("source", "manual")
    .like("external_id", "forecast:%");
  if (delErr) throw new Error(delErr.message);

  const chunk = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const { error, count } = await sb
      .from("expense_transactions")
      .insert(rows.slice(i, i + chunk), { count: "exact" });
    if (error) throw new Error(error.message);
    inserted += count ?? rows.slice(i, i + chunk).length;
  }
  console.log(`\nзаписано: ${inserted} операций`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
