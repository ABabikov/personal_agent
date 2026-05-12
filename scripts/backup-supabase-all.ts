/**
 * Один проход чтения из Supabase → Google Sheet (и вторая), Excel, опционально зеркало в другой Supabase.
 *
 *   npm run backup:all
 *   npm run backup:all -- --dry-run
 *
 * Зеркало: только если заданы SUPABASE_MIRROR_URL и SUPABASE_MIRROR_SERVICE_ROLE_KEY
 * (отдельный пустой проект; данные в нём полностью перезаписываются).
 */
import {
  BACKUP_TABLE_NAMES,
  loadEnvFromDotenv,
  truthyEnv,
  fetchBackupFromSupabase,
  mirrorToSecondarySupabase,
} from "./lib/supabase-backup-core";
import {
  normalizeSpreadsheetId,
  writeBackupGridsToSpreadsheet,
} from "./lib/google-sheets-backup";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

async function main() {
  loadEnvFromDotenv();
  const dryRun = process.argv.includes("--dry-run");
  const includeEmbeddings = truthyEnv("BACKUP_INCLUDE_EMBEDDINGS");

  const fetched = await fetchBackupFromSupabase(includeEmbeddings);
  const { url, counts, grids, rowsByTable } = fetched;

  const nowIso = new Date().toISOString();
  const metaGrid: (string | number | boolean)[][] = [
    ["key", "value"],
    ["backup_at_utc", nowIso],
    ...BACKUP_TABLE_NAMES.map((t) => [`rows_${t}`, counts[t] ?? 0]),
    ["supabase_url_host", new URL(url).host],
    ["include_embeddings", includeEmbeddings ? "yes" : "no"],
  ];

  if (dryRun) {
    console.log("--dry-run: запись в Sheets / Excel / зеркало пропущена.");
    process.exit(0);
  }

  const primaryRaw =
    process.env.GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID ??
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (primaryRaw?.trim()) {
    const id = normalizeSpreadsheetId(primaryRaw);
    await writeBackupGridsToSpreadsheet(
      id,
      BACKUP_TABLE_NAMES,
      grids,
      metaGrid
    );
    console.log(`Sheets (основная): ${id}`);
  } else {
    console.warn(
      "GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID не задан — пропуск Google Sheets."
    );
  }

  const secondaryRaw = process.env.GOOGLE_SHEETS_BACKUP_SPREADSHEET_ID_2?.trim();
  if (secondaryRaw) {
    const id2 = normalizeSpreadsheetId(secondaryRaw);
    await writeBackupGridsToSpreadsheet(
      id2,
      BACKUP_TABLE_NAMES,
      grids,
      metaGrid
    );
    console.log(`Sheets (вторая): ${id2}`);
  }

  const outDir =
    process.env.BACKUP_EXCEL_DIR?.trim() ||
    join(process.cwd(), "backups", "excel");
  mkdirSync(outDir, { recursive: true });
  const fixedName = process.env.BACKUP_EXCEL_FILENAME?.trim();
  const fileName =
    fixedName && fixedName.endsWith(".xlsx")
      ? fixedName
      : fixedName
        ? `${fixedName}.xlsx`
        : `supabase-backup-${nowIso.replace(/[:.]/g, "-")}.xlsx`;
  const wb = XLSX.utils.book_new();
  for (const table of BACKUP_TABLE_NAMES) {
    const grid = grids[table] ?? [["_empty"]];
    const ws = XLSX.utils.aoa_to_sheet(grid);
    XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(metaGrid),
    "backup_meta"
  );
  const excelPath = join(outDir, fileName);
  XLSX.writeFile(wb, excelPath);
  console.log(`Excel: ${excelPath}`);

  if (
    process.env.SUPABASE_MIRROR_URL?.trim() &&
    process.env.SUPABASE_MIRROR_SERVICE_ROLE_KEY?.trim()
  ) {
    await mirrorToSecondarySupabase(rowsByTable);
    console.log("Зеркало Supabase: готово.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
