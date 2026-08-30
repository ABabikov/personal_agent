/**
 * Полная диагностика пересечений Huawei ↔ workouts + пробные стратегии линка.
 * npm run debug:huawei-timezone
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const ZONES = ["UTC", "Europe/Moscow", "Asia/Novosibirsk"] as const;

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

function hourInZone(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const userId = (
    process.env.WORKOUT_IMPORT_USER_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim() ||
    ""
  ).replace(/\s/g, "");
  if (!url || !key || !userId) {
    console.error("Need SUPABASE + WORKOUT_USER_ID");
    process.exit(1);
  }

  const sb = createClient<Database>(url, key);

  const { data: sessions } = await sb
    .from("device_activity_sessions")
    .select(
      "id, started_at, ended_at, activity_type_mapped, duration_seconds, calories_device"
    )
    .eq("user_id", userId)
    .eq("source", "huawei")
    .in("activity_type_mapped", ["gym", "swim"]);

  const { data: links } = await sb
    .from("workout_device_links")
    .select("device_session_id, workout_id");
  const linkedSessions = new Set((links ?? []).map((l) => l.device_session_id));
  const linkedWorkouts = new Set((links ?? []).map((l) => l.workout_id));

  const { data: workouts } = await sb
    .from("workouts")
    .select("id, date, type, status, duration_minutes, calories_estimated")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "completed");

  const byDateType = new Map<
    string,
    { id: string; date: string; duration_minutes: number | null }[]
  >();
  for (const w of workouts ?? []) {
    const k = `${w.date}|${w.type}`;
    const arr = byDateType.get(k) ?? [];
    arr.push({
      id: w.id,
      date: w.date,
      duration_minutes: w.duration_minutes,
    });
    byDateType.set(k, arr);
  }

  const unlinked = (sessions ?? []).filter((s) => !linkedSessions.has(s.id));
  console.log(`User: ${userId}`);
  console.log(
    `Sessions gym/swim: ${sessions?.length ?? 0}, linked: ${linkedSessions.size}, unlinked: ${unlinked.length}`
  );
  console.log(`Workouts completed: ${workouts?.length ?? 0}\n`);

  type Score = { name: string; one: number; zero: number; multi: number };
  const scores: Score[] = [];

  function tryStrategy(
    name: string,
    sessionDate: (iso: string) => string[]
  ): Score {
    let one = 0;
    let zero = 0;
    let multi = 0;
    const usedWorkouts = new Set(linkedWorkouts);
    for (const s of unlinked) {
      const type = s.activity_type_mapped as "gym" | "swim";
      const dates = sessionDate(s.started_at);
      const free: { id: string; date: string; duration_minutes: number | null }[] =
        [];
      for (const d of dates) {
        for (const c of byDateType.get(`${d}|${type}`) ?? []) {
          if (!usedWorkouts.has(c.id)) free.push(c);
        }
      }
      // unique by id
      const uniq = [...new Map(free.map((c) => [c.id, c])).values()];
      if (uniq.length === 0) zero++;
      else if (uniq.length === 1) {
        one++;
        usedWorkouts.add(uniq[0].id);
      } else {
        // duration pick among free
        const dur =
          s.duration_seconds != null
            ? Math.round(s.duration_seconds / 60)
            : null;
        if (dur != null) {
          const ranked = [...uniq].sort((a, b) => {
            const da =
              a.duration_minutes != null
                ? Math.abs(a.duration_minutes - dur)
                : 9999;
            const db =
              b.duration_minutes != null
                ? Math.abs(b.duration_minutes - dur)
                : 9999;
            return da - db;
          });
          if (
            ranked[0].duration_minutes != null &&
            Math.abs(ranked[0].duration_minutes - dur) <= 30
          ) {
            one++;
            usedWorkouts.add(ranked[0].id);
          } else if (
            ranked.every((x) => x.duration_minutes == null) &&
            uniq.length === 1
          ) {
            one++;
            usedWorkouts.add(uniq[0].id);
          } else {
            multi++;
          }
        } else {
          multi++;
        }
      }
    }
    const sc = { name, one, zero, multi };
    scores.push(sc);
    return sc;
  }

  for (const z of ZONES) {
    tryStrategy(z, (iso) => [dateInZone(iso, z)]);
    tryStrategy(`${z} ±1d`, (iso) => {
      const d = dateInZone(iso, z);
      return [d, addDays(d, -1), addDays(d, 1)];
    });
  }
  // Node local (как сейчас в linkSessions)
  tryStrategy("Node local", (iso) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return [`${y}-${m}-${day}`];
  });

  console.log("=== Стратегии (unlinked → сколько можно привязать) ===\n");
  for (const s of scores.sort((a, b) => b.one - a.one)) {
    console.log(
      `${s.name.padEnd(22)} linkable: ${String(s.one).padStart(3)} | no match: ${String(s.zero).padStart(3)} | ambiguous: ${s.multi}`
    );
  }

  const best = scores[0];
  console.log(`\nЛучшая: ${best.name} → +${best.one} линков (из ${unlinked.length} unlinked)\n`);

  console.log("=== Ближайшие промахи (NSK ±1d) ===\n");
  let shown = 0;
  for (const s of unlinked) {
    if (shown >= 10) break;
    const nsb = dateInZone(s.started_at, "Asia/Novosibirsk");
    const type = s.activity_type_mapped;
    const exact = (byDateType.get(`${nsb}|${type}`) ?? []).filter(
      (c) => !linkedWorkouts.has(c.id)
    );
    if (exact.length === 1) continue;
    for (const shift of [-1, 1] as const) {
      const alt = addDays(nsb, shift);
      const cands = (byDateType.get(`${alt}|${type}`) ?? []).filter(
        (c) => !linkedWorkouts.has(c.id)
      );
      if (cands.length >= 1) {
        console.log(
          `${type} Huawei ${nsb} ${hourInZone(s.started_at, "Asia/Novosibirsk")}:xx NSK → journal ${alt} (${cands.length}) shift ${shift}`
        );
        shown++;
        break;
      }
    }
  }

  console.log("\n=== Часы старта unlinked (Asia/Novosibirsk) ===\n");
  const hours = new Map<number, number>();
  for (const s of unlinked) {
    const h = hourInZone(s.started_at, "Asia/Novosibirsk");
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  for (const h of [...hours.keys()].sort((a, b) => a - b)) {
    console.log(`  ${String(h).padStart(2)}:00 — ${hours.get(h)}`);
  }

  // Years coverage
  const sessionYears = new Map<string, number>();
  const workoutYears = new Map<string, number>();
  for (const s of unlinked) {
    const y = dateInZone(s.started_at, "Asia/Novosibirsk").slice(0, 4);
    sessionYears.set(y, (sessionYears.get(y) ?? 0) + 1);
  }
  for (const w of workouts ?? []) {
    const y = w.date.slice(0, 4);
    workoutYears.set(y, (workoutYears.get(y) ?? 0) + 1);
  }
  console.log("\n=== По годам (unlinked sessions vs all workouts) ===");
  console.log("  Sessions unlinked:", Object.fromEntries(sessionYears));
  console.log("  Workouts:", Object.fromEntries(workoutYears));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
