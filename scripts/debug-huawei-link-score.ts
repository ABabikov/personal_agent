/**
 * Score linking strategies (no duration_minutes column required).
 * npx tsx scripts/debug-huawei-link-score.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const userId = (
    process.env.WORKOUT_IMPORT_USER_ID ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID ||
    ""
  ).replace(/\s/g, "");
  const sb = createClient(url, key);

  const { data: sessions } = await sb
    .from("device_activity_sessions")
    .select("id, started_at, activity_type_mapped, duration_seconds")
    .eq("user_id", userId)
    .in("activity_type_mapped", ["gym", "swim"]);

  const { data: links } = await sb
    .from("workout_device_links")
    .select("device_session_id, workout_id");
  const linkedS = new Set((links ?? []).map((l) => l.device_session_id));
  const linkedW = new Set((links ?? []).map((l) => l.workout_id));

  const { data: workouts, error } = await sb
    .from("workouts")
    .select("id, date, type, status")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "completed");

  console.log("workouts:", workouts?.length, "err:", error?.message ?? "ok");
  console.log(
    "sessions:",
    sessions?.length,
    "linked:",
    linkedS.size,
    "unlinked:",
    (sessions ?? []).filter((s) => !linkedS.has(s.id)).length
  );

  const by = new Map<string, { id: string; date: string }[]>();
  for (const w of workouts ?? []) {
    const k = `${w.date}|${w.type}`;
    const arr = by.get(k) ?? [];
    arr.push({ id: w.id, date: w.date });
    by.set(k, arr);
  }

  const unlinked = (sessions ?? []).filter((s) => !linkedS.has(s.id));

  function score(name: string, datesFn: (iso: string) => string[]) {
    let one = 0;
    let zero = 0;
    let multi = 0;
    const used = new Set(linkedW);
    const examples: string[] = [];
    for (const s of unlinked) {
      const dates = datesFn(s.started_at);
      const free: { id: string; date: string }[] = [];
      for (const d of dates) {
        for (const c of by.get(`${d}|${s.activity_type_mapped}`) ?? []) {
          if (!used.has(c.id)) free.push(c);
        }
      }
      const uniq = [...new Map(free.map((c) => [c.id, c])).values()];
      if (uniq.length === 0) zero++;
      else if (uniq.length === 1) {
        one++;
        used.add(uniq[0].id);
        if (examples.length < 5) {
          examples.push(
            `${s.activity_type_mapped} ${dateInZone(s.started_at, "Asia/Novosibirsk")} → ${uniq[0].date}`
          );
        }
      } else multi++;
    }
    console.log(
      `${name.padEnd(24)} link ${String(one).padStart(3)} | zero ${String(zero).padStart(3)} | multi ${multi}`
    );
    for (const e of examples) console.log("   ", e);
  }

  for (const z of ["UTC", "Europe/Moscow", "Asia/Novosibirsk"] as const) {
    score(z, (iso) => [dateInZone(iso, z)]);
    score(`${z} +/-1d`, (iso) => {
      const d = dateInZone(iso, z);
      return [d, addDays(d, -1), addDays(d, 1)];
    });
  }

  const years: Record<string, number> = {};
  for (const s of unlinked) {
    const y = dateInZone(s.started_at, "Asia/Novosibirsk").slice(0, 4);
    years[y] = (years[y] ?? 0) + 1;
  }
  console.log("unlinked by year:", years);

  // Overlap days exact NSK
  let overlap = 0;
  for (const s of unlinked) {
    const d = dateInZone(s.started_at, "Asia/Novosibirsk");
    const c = by.get(`${d}|${s.activity_type_mapped}`) ?? [];
    if (c.some((x) => !linkedW.has(x.id))) overlap++;
  }
  console.log("unlinked with free workout same NSK day:", overlap);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
