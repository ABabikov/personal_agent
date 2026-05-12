/**
 * Снимок данных Supabase → одна Google Таблица (вкладка на таблицу БД).
 *
 * Какая база попадает в снимок — та, что в `NEXT_PUBLIC_SUPABASE_URL` (и ключ в env).
 * Облачная и self-hosted реплика — это два разных URL: два отдельных запуска/cron с
 * нужным `.env` (в ту же или в разные таблицы — на ваш выбор), без второй переменной Sheet ID.
 *
 * Запуск: npm run backup:sheets | npm run backup:sheets -- --dry-run
 */
import {
  BACKUP_TABLE_NAMES,
  loadEnvFromDotenv,
  truthyEnv,
  fetchBackupFromSupabase,
} from "./lib/supabase-backup-core";
import {
  normalizeSpreadsheetId,
  writeBackupGridsToSpreadsheet,
} from "./lib/google-sheets-backup";

async function main() {
  loadEnvFromDotenv();
  const dryRun = process.argv.includes("--dry-run");
  const includeEmbeddings = truthyEnv("BACKUP_INCLUDE_EMBEDDINGS");

  const fetched = await fetchBackupFromSupabase(includeEmbeddings);
  const { url, counts, grids } = fetched;

  const nowIso = new Date().toISOString();
  const metaGrid: (string | number | boolean)[][] = [
    ["key", "value"],
    ["backup_at_utc", nowIso],
    ...BACKUP_TABLE_NAMES.map((t) => [`rows_${t}`, counts[t] ?? 0]),
    ["supabase_url_host", new URL(url).host],
    ["include_embeddings", includeEmbeddings ? "yes" : "no"],
  ];

  if (dryRun) {
    console.log("--dry-run: запись в Google Sheets пропущена.");
    process.exit(0);
  }

  const primaryRaw =
    process.env.GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID ??
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!primaryRaw?.trim()) {
    console.error(
      "Задайте GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID (или GOOGLE_SHEETS_SPREADSHEET_ID)"
    );
    process.exit(1);
  }

  const primaryId = normalizeSpreadsheetId(primaryRaw);
  await writeBackupGridsToSpreadsheet(
    primaryId,
    BACKUP_TABLE_NAMES,
    grids,
    metaGrid
  );
  console.log(
    `Готово: ${primaryId} обновлена (${nowIso}). Вкладки: ${BACKUP_TABLE_NAMES.join(", ")}, backup_meta.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
