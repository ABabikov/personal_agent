/**
 * Запись сетки в Google Sheets (бэкап).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import type { JWTInput } from "google-auth-library";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

export const BACKUP_META_SHEET = "backup_meta";

export function loadEnvFromDotenvForGoogle() {
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

function parseServiceAccountJson(raw: string): JWTInput {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const pk = parsed.private_key;
  if (typeof pk === "string") {
    parsed.private_key = pk.replace(/\\n/g, "\n");
  }
  return parsed as JWTInput;
}

const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"] as const;

export function normalizeSpreadsheetId(raw: string): string {
  const t = raw.trim();
  const fromUrl = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  return t;
}

export function createSheetsAuth() {
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

export async function writeBackupGridsToSpreadsheet(
  spreadsheetId: string,
  tableNames: readonly string[],
  grids: Record<string, (string | number | boolean)[][]>,
  metaGrid: (string | number | boolean)[][]
): Promise<void> {
  const auth = createSheetsAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const allTitles = [...tableNames, BACKUP_META_SHEET];
  await ensureSheets(sheets, spreadsheetId, allTitles);
  for (const table of tableNames) {
    await writeGridToSheet(sheets, spreadsheetId, table, grids[table]!);
  }
  await writeGridToSheet(sheets, spreadsheetId, BACKUP_META_SHEET, metaGrid);
}
