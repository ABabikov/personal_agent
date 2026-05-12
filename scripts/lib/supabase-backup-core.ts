/**
 * Общая логика: список таблиц, загрузка из Supabase, сетка для Sheets/Excel.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

export const BACKUP_TABLE_NAMES = [
  "users",
  "workouts",
  "gym_exercises",
  "swim_series",
  "swim_block_template",
  "workout_plans",
  "chat_messages",
  "user_context",
] as const satisfies readonly (keyof Database["public"]["Tables"])[];

export type BackupTableName = (typeof BACKUP_TABLE_NAMES)[number];

export function loadEnvFromDotenv() {
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

export function truthyEnv(name: string): boolean {
  const v = process.env[name]?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function cellValue(
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

export function rowsToGrid(
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
    grid.push(headers.map((h) => cellValue(h, row[h], includeEmbeddings)));
  }
  return grid;
}

export type FetchedBackup = {
  url: string;
  counts: Record<string, number>;
  /** сырое для зеркала в БД */
  rowsByTable: Record<string, Record<string, unknown>[]>;
  /** для Sheets / Excel */
  grids: Record<string, (string | number | boolean)[][]>;
};

export async function fetchBackupFromSupabase(
  includeEmbeddings: boolean
): Promise<FetchedBackup> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey ?? anonKey;
  if (!url || !key) {
    throw new Error(
      "Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY или NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const supabase = createClient<Database>(url, key);
  const counts: Record<string, number> = {};
  const rowsByTable: Record<string, Record<string, unknown>[]> = {};
  const grids: Record<string, (string | number | boolean)[][]> = {};

  for (const table of BACKUP_TABLE_NAMES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      const missing =
        error.code === "PGRST205" ||
        error.message.includes("Could not find the table");
      if (missing) {
        console.warn(
          `${table}: таблица не найдена в проекте — пометка в бэкапе.`
        );
        counts[table] = 0;
        rowsByTable[table] = [];
        grids[table] = [
          ["_backup_note"],
          [
            "Таблица отсутствует в этом экземпляре Supabase. Примените миграции.",
          ],
        ];
        continue;
      }
      throw new Error(`${table}: ${error.message}`);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    counts[table] = rows.length;
    rowsByTable[table] = rows;
    grids[table] = rowsToGrid(rows, includeEmbeddings);
    console.log(`${table}: ${rows.length} строк`);
  }

  return { url, counts, rowsByTable, grids };
}

/** Порядок удаления строк (дети → родители) для пустого зеркала. */
const MIRROR_DELETE_ORDER: BackupTableName[] = [
  "gym_exercises",
  "swim_series",
  "workouts",
  "workout_plans",
  "chat_messages",
  "user_context",
  "swim_block_template",
  "users",
];

/** Порядок вставки при зеркале. */
const MIRROR_INSERT_ORDER: BackupTableName[] = [
  "users",
  "swim_block_template",
  "workout_plans",
  "workouts",
  "gym_exercises",
  "swim_series",
  "chat_messages",
  "user_context",
];

const CHUNK = 300;

function cloneRowForMirror(row: Record<string, unknown>): Record<string, unknown> {
  const o = { ...row };
  delete o.embedding;
  for (const k of Object.keys(o)) {
    if (k.endsWith("_embedding")) delete o[k];
  }
  return o;
}

/**
 * Полная перезапись данных в **втором** проекте Supabase (должен быть пустым / выделенным под копию).
 * Удаляет все строки из перечисленных таблиц, затем вставляет данные из primary.
 */
export async function mirrorToSecondarySupabase(
  rowsByTable: Record<string, Record<string, unknown>[]>
): Promise<void> {
  const url = process.env.SUPABASE_MIRROR_URL?.trim();
  const key = process.env.SUPABASE_MIRROR_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Для зеркала задайте SUPABASE_MIRROR_URL и SUPABASE_MIRROR_SERVICE_ROLE_KEY"
    );
  }

  const db = createClient<Database>(url, key);

  for (const table of MIRROR_DELETE_ORDER) {
    const { error } = await db.from(table).delete().not("id", "is", null);
    if (error) {
      throw new Error(`Зеркало: удаление ${table}: ${error.message}`);
    }
    console.log(`Зеркало: очищено ${table}`);
  }

  for (const table of MIRROR_INSERT_ORDER) {
    const rows = rowsByTable[table] ?? [];
    if (rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(cloneRowForMirror);
      const { error } = await db.from(table).insert(chunk as never[]);
      if (error) {
        throw new Error(`Зеркало: вставка ${table} [${i}…]: ${error.message}`);
      }
    }
    console.log(`Зеркало: вставлено ${table}: ${rows.length} строк`);
  }
}
