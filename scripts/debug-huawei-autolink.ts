/**
 * Диагностика авто-линка Huawei ↔ workouts.
 * npm run debug:huawei-autolink
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcDateKey(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const userId =
    process.env.WORKOUT_IMPORT_USER_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim();
  if (!url || !key || !userId) {
    console.error("Need SUPABASE + WORKOUT_IMPORT_USER_ID");
    process.exit(1);
  }

  const sb = createClient<Database>(url, key);

  const { data: sessions } = await sb
    .from("device_activity_sessions")
    .select("id, started_at, activity_type_mapped, activity_type_raw")
    .eq("user_id", userId)
    .in("activity_type_mapped", ["gym", "swim"])
    .order("started_at", { ascending: false });

  const { data: links } = await sb.from("workout_device_links").select("device_session_id");

  const linked = new Set((links ?? []).map((l) => l.device_session_id));
  const unlinked = (sessions ?? []).filter((s) => !linked.has(s.id));

  console.log(`TZ offset (Node): UTC${-new Date().getTimezoneOffset() / 60}`);
  console.log(`Sessions gym/swim: ${sessions?.length ?? 0}, unlinked: ${unlinked.length}\n`);

  const reasons = {
    zeroCandidates: 0,
    multipleCandidates: 0,
    oneCandidateWrongStatus: 0,
    wouldLink: 0,
  };

  const samples: string[] = [];

  for (const s of unlinked.slice(0, 50)) {
    const dateLocal = localDateKey(s.started_at);
    const dateUtc = utcDateKey(s.started_at);
    const type = s.activity_type_mapped as "gym" | "swim";

    const { data: onLocal } = await sb
      .from("workouts")
      .select("id, date, type, status")
      .eq("user_id", userId)
      .eq("date", dateLocal)
      .eq("type", type)
      .is("deleted_at", null);

    const { data: onUtc } =
      dateUtc !== dateLocal
        ? await sb
            .from("workouts")
            .select("id, date, type, status")
            .eq("user_id", userId)
            .eq("date", dateUtc)
            .eq("type", type)
            .is("deleted_at", null)
        : { data: null };

    const completedLocal = (onLocal ?? []).filter((w) => w.status === "completed");
    const allLocal = onLocal ?? [];

    let reason = "";
    if (allLocal.length === 0) {
      reasons.zeroCandidates++;
      reason = `0 workouts on ${dateLocal}`;
      if (onUtc && onUtc.length > 0) {
        reason += ` (but ${onUtc.length} on UTC date ${dateUtc} ← TZ?)`;
      }
    } else if (completedLocal.length !== 1) {
      if (completedLocal.length === 0 && allLocal.length > 0) {
        reasons.oneCandidateWrongStatus++;
        reason = `${allLocal.length} on ${dateLocal} but status≠completed: ${allLocal.map((w) => w.status).join(",")}`;
      } else {
        reasons.multipleCandidates++;
        reason = `${completedLocal.length} completed / ${allLocal.length} total on ${dateLocal}`;
      }
    } else {
      reasons.wouldLink++;
      reason = `OK: 1 completed on ${dateLocal}`;
    }

    if (samples.length < 15) {
      samples.push(
        `${s.activity_type_raw} ${dateLocal} (utc ${dateUtc}) | ${reason} | started ${s.started_at.slice(0, 19)}`
      );
    }
  }

  console.log("Reason breakdown (first 50 unlinked sessions):");
  console.log(reasons);
  console.log("\nSamples:");
  for (const line of samples) console.log(" ", line);

  // Global: workout dates vs session dates overlap
  const { data: allWorkouts } = await sb
    .from("workouts")
    .select("date, type, status")
    .eq("user_id", userId)
    .is("deleted_at", null);

  const workoutDays = new Map<string, { gym: number; swim: number; active: number }>();
  for (const w of allWorkouts ?? []) {
    const k = w.date;
    const cur = workoutDays.get(k) ?? { gym: 0, swim: 0, active: 0 };
    if (w.type === "gym") cur.gym++;
    else cur.swim++;
    if (w.status !== "completed") cur.active++;
    workoutDays.set(k, cur);
  }

  const sessionDays = new Map<string, { gym: number; swim: number }>();
  for (const s of sessions ?? []) {
    if (s.activity_type_mapped !== "gym" && s.activity_type_mapped !== "swim") continue;
    const k = localDateKey(s.started_at);
    const cur = sessionDays.get(k) ?? { gym: 0, swim: 0 };
    if (s.activity_type_mapped === "gym") cur.gym++;
    else cur.swim++;
    sessionDays.set(k, cur);
  }

  let overlapGym = 0;
  let overlapSwim = 0;
  let sessionOnly = 0;
  for (const [day, sc] of sessionDays) {
    const w = workoutDays.get(day);
    if (!w) {
      sessionOnly++;
      continue;
    }
    if (sc.gym > 0 && w.gym > 0) overlapGym++;
    if (sc.swim > 0 && w.swim > 0) overlapSwim++;
  }

  console.log("\nGlobal overlap (local TZ date):");
  console.log(`  Session days: ${sessionDays.size}, Workout days: ${workoutDays.size}`);
  console.log(`  Days with both gym: ${overlapGym}, both swim: ${overlapSwim}`);
  console.log(`  Session days without any workout: ${sessionOnly}`);

  const multiGymDays = [...workoutDays.entries()].filter(([, v]) => v.gym > 1).length;
  const multiSwimDays = [...workoutDays.entries()].filter(([, v]) => v.swim > 1).length;
  console.log(`  Workout days with 2+ gym: ${multiGymDays}, 2+ swim: ${multiSwimDays}`);

  const { data: completed } = await sb
    .from("workouts")
    .select("id, date, type")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "completed");

  const byDateType = new Map<string, string[]>();
  for (const w of completed ?? []) {
    const k = `${w.date}|${w.type}`;
    const arr = byDateType.get(k) ?? [];
    arr.push(w.id);
    byDateType.set(k, arr);
  }

  let couldLink = 0;
  const couldExamples: string[] = [];
  for (const s of unlinked) {
    const k = `${localDateKey(s.started_at)}|${s.activity_type_mapped}`;
    const cands = byDateType.get(k) ?? [];
    if (cands.length === 1) {
      couldLink++;
      if (couldExamples.length < 8) {
        couldExamples.push(
          `${s.activity_type_mapped} ${localDateKey(s.started_at)} → 1 workout (${cands[0].slice(0, 8)}…)`
        );
      }
    }
  }

  console.log(`\nUnlinked that WOULD link now: ${couldLink} / ${unlinked.length}`);
  for (const e of couldExamples) console.log(" ", e);

  const wDates = (completed ?? []).map((w) => w.date).sort();
  const sDates = (sessions ?? []).map((s) => localDateKey(s.started_at)).sort();
  console.log("\nDate ranges:");
  console.log(`  Workouts: ${wDates[0]} .. ${wDates[wDates.length - 1]} (${wDates.length} rows)`);
  console.log(
    `  Sessions: ${sDates[0]} .. ${sDates[sDates.length - 1]} (${sDates.length} rows)`
  );
  console.log(`  Links in DB: ${links?.length ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
