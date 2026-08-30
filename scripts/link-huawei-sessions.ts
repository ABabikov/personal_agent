/**
 * Авто-сопоставление Huawei ↔ журнал + материализация «сирот» в workouts.
 *
 *   npm run link:huawei
 *   npm run link:huawei -- --no-materialize   # только линк к существующим
 *   npm run link:huawei -- --dry-run
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  autoLinkSessionsForUser,
  materializeOrphanDeviceSessions,
} from "../src/lib/integrations/huawei/linkSessions";
import { getSupabaseServer } from "../src/lib/db/supabase-server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function resolveUserId(): string {
  const id = (
    process.env.WORKOUT_IMPORT_USER_ID ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID ||
    process.env.WORKOUT_USER_ID ||
    ""
  ).replace(/\s/g, "");
  if (!id) {
    console.error("Задайте WORKOUT_IMPORT_USER_ID / NEXT_PUBLIC_WORKOUT_USER_ID");
    process.exit(1);
  }
  return id;
}

async function counts(userId: string) {
  const sb = getSupabaseServer();
  const { count: sessions } = await sb
    .from("device_activity_sessions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source", "huawei")
    .in("activity_type_mapped", ["gym", "swim"]);
  const { data: links } = await sb.from("workout_device_links").select("device_session_id");
  const { data: sess } = await sb
    .from("device_activity_sessions")
    .select("id")
    .eq("user_id", userId)
    .in("activity_type_mapped", ["gym", "swim"]);
  const linked = new Set((links ?? []).map((l) => l.device_session_id));
  const unlinked = (sess ?? []).filter((s) => !linked.has(s.id)).length;
  return { sessions: sessions ?? 0, links: links?.length ?? 0, unlinked };
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noMaterialize = args.includes("--no-materialize");
  const userId = resolveUserId();

  console.log(`User: ${userId}`);
  console.log(`TZ: ${process.env.HUAWEI_USER_TIMEZONE || "Asia/Novosibirsk"}`);

  const before = await counts(userId);
  console.log(
    `Before: gym/swim sessions ${before.sessions}, links ${before.links}, unlinked ${before.unlinked}`
  );

  if (dryRun) {
    console.log("Dry-run — ничего не пишем. Запустите без --dry-run.");
    return;
  }

  const linked = await autoLinkSessionsForUser(userId);
  console.log(`Auto-linked to existing journal: ${linked}`);

  if (!noMaterialize) {
    const mat = await materializeOrphanDeviceSessions(userId);
    console.log(
      `Materialized orphans: created ${mat.created}, linked ${mat.linked}, skipped ${mat.skipped}`
    );
    if (mat.errors.length) {
      console.log(`Errors (${mat.errors.length}):`);
      for (const e of mat.errors.slice(0, 15)) console.log(" ", e);
    }
  }

  if (args.includes("--outdoor")) {
    const { materializeOutdoorDeviceSessions } = await import(
      "../src/lib/integrations/huawei/linkSessions"
    );
    const out = await materializeOutdoorDeviceSessions(userId);
    console.log(
      `Outdoor → calendar: created ${out.created}, linked ${out.linked}, skipped ${out.skipped}`
    );
    if (out.errors.length) {
      console.log(`Outdoor errors (${out.errors.length}):`);
      for (const e of out.errors.slice(0, 10)) console.log(" ", e);
    }
  }

  const after = await counts(userId);
  console.log(
    `After: gym/swim sessions ${after.sessions}, links ${after.links}, unlinked ${after.unlinked}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
