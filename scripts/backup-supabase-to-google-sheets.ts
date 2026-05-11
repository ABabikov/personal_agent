/**
 * Ежедневный снимок данных Supabase → Google Таблица (по одной вкладке на таблицу БД).
 *
 * Запуск вручную:
 *   npm run backup:sheets
 *   npm run backup:sheets -- --dry-run   — только чтение из Supabase, без Google
 *
 * Переменные окружения (.env или CI):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY — предпочтительно (обходит RLS в проде)
 *   либо NEXT_PUBLIC_SUPABASE_ANON_KEY — подойдёт при текущих dev-политиках «allow all»
 *
 *   GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID — id таблицы или целиком URL из браузера
 *
 *   Ключ сервисного аккаунта (один из вариантов):
 *   GOOGLE_SERVICE_ACCOUNT_JSON — весь JSON одной строкой или многострочно (удобно в CI / Vercel)
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE или GOOGLE_APPLICATION_CREDENTIALS — путь к файлу .json
 *
 *   BACKUP_INCLUDE_EMBEDDINGS=1 — писать векторы в ячейки (иначе пусто; векторы огромные)
 *
 * Google Cloud: включите API «Google Sheets», создайте сервисный аккаунт, скачайте ключ.
 * Таблицу расшарьте на email сервисного аккаунта (редактор).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import type { JWTInput } from "google-auth-library";
import type { Database } from "../src/types/database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const TABLE_NAMES = [
  "users",
  "workouts",
  "gym_exercises",
  "swim_series",
  "swim_block_template",
  "workout_plans",
  "chat_messages",
  "user_context",
] as const satisfies readonly (keyof Database["public"]["Tables"])[];

const META_SHEET = "backup_meta";

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

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** JSON из env: в private_key часто приходят литеральные `\n` — заменяем на переводы строк. */
function parseServiceAccountJson(raw: string): JWTInput {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const pk = parsed.private_key;
  if (typeof pk === "string") {
    parsed.private_key = pk.replace(/\\n/g, "\n");
  }
  return parsed as JWTInput;
}

const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"] as const;

/** Допускает вставку целиком URL из браузера, не только id между `/d/` и `/edit`. */
function normalizeSpreadsheetId(raw: string): string {
  const t = raw.trim();
  const fromUrl = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  return t;
}

function createSheetsAuth() {
  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    let credentials: JWTInput;
    try {
      credentials = parseServiceAccountJson(jsonRaw);
    } catch {
      console.error(
        "GOOGLE_SERVICE_ACCOUNT_JSON задан, но это не валидный JSON."
      );
      process.exit(1);
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: [...SHEETS_SCOPES],
    });
  }

  const keyFile =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile || !existsSync(keyFile)) {
    console.error(
      "Задайте один из вариантов: GOOGLE_SERVICE_ACCOUNT_JSON (содержимое ключа) " +
        "или путь к файлу: GOOGLE_SERVICE_ACCOUNT_KEY_FILE / GOOGLE_APPLICATION_CREDENTIALS."
    );
    process.exit(1);
  }

  return new google.auth.GoogleAuth({
    keyFile,
    scopes: [...SHEETS_SCOPES],
  });
}

function cellValue(
  key: string,
  val: unknown,
  includeEmbeddings: boolean
): string | number | boolean {
  if (
    !includeEmbeddings &&
    (key === "embedding" || key.endsWith("_embedding"))
  ) {
    return "";
  }
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function rowsToGrid(
  rows: Record<string, unknown>[],
  includeEmbeddings: boolean
): (string | number | boolean)[][] {
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) keySet.add(k);
  }
  const headers = [...keySet].sort();
  const grid: (string | number | boolean)[][] = [headers];
  for (const row of rows) {
    grid.push(
      headers.map((h) => cellValue(h, row[h], includeEmbeddings))
    );
  }
  return grid;
}

async function ensureSheets(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  titles: string[]
) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(
    (data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t))
  );
  const toAdd = titles.filter((t) => !existing.has(t));
  if (toAdd.length === 0) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: toAdd.map((title) => ({
        addSheet: { properties: { title } },
      })),
    },
  });
}

async function writeGridToSheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetTitle: string,
  grid: (string | number | boolean)[][]
) {
  const q = `'${sheetTitle.replace(/'/g, "''")}'`;
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${q}!A:ZZ`,
  });
  if (grid.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${q}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: grid },
  });
}

async function main() {
  loadEnvFromDotenv();
  const dryRun = process.argv.includes("--dry-run");
  const includeEmbeddings = truthyEnv("BACKUP_INCLUDE_EMBEDDINGS");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey ?? anonKey;
  if (!url || !key) {
    console.error(
      "Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY или NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key);

  const counts: Record<string, number> = {};
  const grids: Record<string, (string | number | boolean)[][]> = {};

  for (const table of TABLE_NAMES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      const missing =
        error.code === "PGRST205" ||
        error.message.includes("Could not find the table");
      if (missing) {
        console.warn(
          `${table}: таблица не найдена в проекте (миграции?) — вкладка будет пустой с пометкой.`
        );
        counts[table] = 0;
        grids[table] = [
          ["_backup_note"],
          [
            "Таблица отсутствует в этом экземпляре Supabase. Примените миграции или удалите имя из TABLE_NAMES.",
          ],
        ];
        continue;
      }
      console.error(`Ошибка чтения ${table}:`, error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    counts[table] = rows.length;
    grids[table] = rowsToGrid(rows, includeEmbeddings);
    console.log(`${table}: ${rows.length} строк`);
  }

  const nowIso = new Date().toISOString();
  const metaGrid: (string | number | boolean)[][] = [
    ["key", "value"],
    ["backup_at_utc", nowIso],
    ...TABLE_NAMES.map((t) => [`rows_${t}`, counts[t] ?? 0]),
    ["supabase_url_host", new URL(url).host],
    ["include_embeddings", includeEmbeddings ? "yes" : "no"],
  ];

  if (dryRun) {
    console.log("--dry-run: запись в Google Sheets пропущена.");
    process.exit(0);
  }

  const spreadsheetIdRaw =
    process.env.GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID ??
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetIdRaw?.trim()) {
    console.error(
      "Задайте GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID (или GOOGLE_SHEETS_SPREADSHEET_ID)"
    );
    process.exit(1);
  }
  const spreadsheetId = normalizeSpreadsheetId(spreadsheetIdRaw);

  const auth = createSheetsAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const allTitles = [...TABLE_NAMES, META_SHEET];
  await ensureSheets(sheets, spreadsheetId, allTitles);

  for (const table of TABLE_NAMES) {
    await writeGridToSheet(sheets, spreadsheetId, table, grids[table]!);
  }
  await writeGridToSheet(sheets, spreadsheetId, META_SHEET, metaGrid);

  console.log(
    `Готово: ${spreadsheetId} обновлена (${nowIso}). Вкладки: ${TABLE_NAMES.join(", ")}, ${META_SHEET}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
