/**
 * Импорт сессий из выгрузки Huawei Health (Motion path detail data) в Supabase.
 *
 * Не импортирует «Sport per minute merged data» — это поминутные фрагменты, не тренировки.
 *
 * Запуск:
 *   npm run import:huawei-export
 *   npm run import:huawei-export -- --dry-run
 *   npm run import:huawei-export -- --dir "docs/huawei/huawei data"
 *
 * .env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *       WORKOUT_IMPORT_USER_ID или NEXT_PUBLIC_WORKOUT_USER_ID
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importHuaweiMotionPathExport } from "../src/lib/integrations/huawei/importExport";
import { mapMotionPathToSession } from "../src/lib/integrations/huawei/parseMotionPath";
import type { HuaweiMotionPathRecord } from "../src/lib/integrations/huawei/parseMotionPath";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DEFAULT_EXPORT_DIR = join(root, "docs", "huawei", "huawei data");

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

function resolveUserId(): string {
  const id =
    process.env.WORKOUT_IMPORT_USER_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim();
  if (!id) {
    console.error(
      "Задайте WORKOUT_IMPORT_USER_ID или NEXT_PUBLIC_WORKOUT_USER_ID в .env"
    );
    process.exit(1);
  }
  return id;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let dir = DEFAULT_EXPORT_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--dir" && args[i + 1]) {
      dir = args[++i];
      if (!dir.startsWith("/") && !/^[A-Za-z]:/.test(dir)) {
        dir = join(root, dir);
      }
    }
  }
  return { dryRun, dir };
}

function dryRunCount(exportDir: string) {
  const motionDir = join(exportDir, "Motion path detail data & description");
  if (!existsSync(motionDir)) {
    console.error(`Нет папки: ${motionDir}`);
    process.exit(1);
  }
  const files = readdirSync(motionDir).filter(
    (f) => f.toLowerCase().endsWith(".json") && f.toLowerCase().includes("motion path")
  );
  let parsed = 0;
  let skipped = 0;
  let sessions = 0;
  const types = new Map<string, number>();

  for (const file of files) {
    try {
      const rows = JSON.parse(
        readFileSync(join(motionDir, file), "utf-8")
      ) as HuaweiMotionPathRecord[];
      if (!Array.isArray(rows)) {
        skipped++;
        continue;
      }
      parsed++;
      for (const row of rows) {
        const m = mapMotionPathToSession(row);
        if (!m) continue;
        sessions++;
        const key = m.activity_type_mapped;
        types.set(key, (types.get(key) ?? 0) + 1);
      }
    } catch {
      skipped++;
    }
  }

  console.log("Dry run — motion path only");
  console.log(`  Dir: ${exportDir}`);
  console.log(`  JSON files: ${files.length} (parsed ${parsed}, skipped ${skipped})`);
  console.log(`  Sessions to upsert: ${sessions}`);
  console.log("  By mapped type:", Object.fromEntries(types));
}

async function main() {
  loadEnvFromDotenv();
  const { dryRun, dir } = parseArgs();

  if (!existsSync(dir)) {
    console.error(`Папка выгрузки не найдена: ${dir}`);
    process.exit(1);
  }

  if (dryRun) {
    dryRunCount(dir);
    return;
  }

  const userId = resolveUserId();
  console.log(`Import Huawei export → user ${userId}`);
  console.log(`  Dir: ${dir}`);

  const result = await importHuaweiMotionPathExport(userId, dir);

  console.log("Done:");
  console.log(`  Files scanned: ${result.filesScanned}`);
  console.log(`  Parsed: ${result.filesParsed}, skipped: ${result.filesSkipped}`);
  console.log(`  Sessions in files: ${result.sessionsFound}`);
  console.log(`  Upserted: ${result.upserted}, auto-linked: ${result.linked}`);
  if (result.errors.length > 0) {
    console.log(`  Errors (${result.errors.length}):`);
    for (const e of result.errors.slice(0, 10)) console.log(`    - ${e}`);
    if (result.errors.length > 10) {
      console.log(`    … and ${result.errors.length - 10} more`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
