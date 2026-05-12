/**
 * Снимок тех же таблиц Supabase → один .xlsx (лист на таблицу + backup_meta).
 *
 *   npm run backup:excel
 *   npm run backup:excel -- --dry-run
 *
 * BACKUP_EXCEL_DIR — каталог (по умолчанию ./backups/excel)
 * BACKUP_EXCEL_FILENAME — фиксированное имя файла (иначе backup-ISO.xlsx)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  BACKUP_TABLE_NAMES,
  loadEnvFromDotenv,
  truthyEnv,
  fetchBackupFromSupabase,
} from "./lib/supabase-backup-core";

async function main() {
  loadEnvFromDotenv();
  const dryRun = process.argv.includes("--dry-run");
  const includeEmbeddings = truthyEnv("BACKUP_INCLUDE_EMBEDDINGS");

  const fetched = await fetchBackupFromSupabase(includeEmbeddings);
  const { url, counts, grids } = fetched;

  const nowIso = new Date().toISOString();
  const metaRows: (string | number | boolean)[][] = [
    ["key", "value"],
    ["backup_at_utc", nowIso],
    ...BACKUP_TABLE_NAMES.map((t) => [`rows_${t}`, counts[t] ?? 0]),
    ["supabase_url_host", new URL(url).host],
    ["include_embeddings", includeEmbeddings ? "yes" : "no"],
  ];

  if (dryRun) {
    console.log("--dry-run: запись Excel пропущена.");
    process.exit(0);
  }

  const wb = XLSX.utils.book_new();
  for (const table of BACKUP_TABLE_NAMES) {
    const grid = grids[table] ?? [["_empty"]];
    const ws = XLSX.utils.aoa_to_sheet(grid);
    const title = table.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, title);
  }
  const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, wsMeta, "backup_meta");

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

  const outPath = join(outDir, fileName);
  XLSX.writeFile(wb, outPath);
  console.log(`Excel: записано ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
