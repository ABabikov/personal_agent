/**
 * Добить 3 ambiguous дня: выбрать workout с упражнениями / тоннажем.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { candidateJournalDates } from "../src/lib/integrations/huawei/timezone";

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

async function main() {
  loadEnv();
  const uid = (process.env.NEXT_PUBLIC_WORKOUT_USER_ID || "").replace(/\s/g, "");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: sessions } = await sb
    .from("device_activity_sessions")
    .select("id, started_at, activity_type_mapped, duration_seconds")
    .eq("user_id", uid)
    .eq("activity_type_mapped", "gym");

  const { data: links } = await sb
    .from("workout_device_links")
    .select("device_session_id, workout_id");
  const linkedS = new Set((links ?? []).map((l) => l.device_session_id));
  const linkedW = new Set((links ?? []).map((l) => l.workout_id));

  const unlinked = (sessions ?? []).filter((s) => !linkedS.has(s.id));
  console.log("Unlinked gym:", unlinked.length);

  for (const s of unlinked) {
    const dates = candidateJournalDates(s.started_at);
    const { data: ws } = await sb
      .from("workouts")
      .select("id, date, total_tonnage, calories_estimated, notes, created_at")
      .eq("user_id", uid)
      .eq("type", "gym")
      .in("date", dates)
      .is("deleted_at", null)
      .eq("status", "completed");

    const free = (ws ?? []).filter((w) => !linkedW.has(w.id));
    console.log("\nSession", s.started_at, "dur min", s.duration_seconds ? Math.round(s.duration_seconds / 60) : null);
    for (const w of free) {
      const { count } = await sb
        .from("gym_exercises")
        .select("*", { count: "exact", head: true })
        .eq("workout_id", w.id);
      console.log(
        `  workout ${w.id.slice(0, 8)} date=${w.date} tonnage=${w.total_tonnage} exercises=${count} notes=${(w.notes || "").slice(0, 40)}`
      );
    }

    // Pick: max tonnage among free, or max exercise count
    let best = free[0];
    if (!best) {
      console.log("  no free — skip");
      continue;
    }
    for (const w of free) {
      const t = Number(w.total_tonnage ?? 0);
      const bt = Number(best.total_tonnage ?? 0);
      if (t > bt) best = w;
    }

    // If both tonnage 0, prefer non-materialized notes
    if (
      free.every((w) => !w.total_tonnage || Number(w.total_tonnage) === 0)
    ) {
      const withEx = [];
      for (const w of free) {
        const { count } = await sb
          .from("gym_exercises")
          .select("*", { count: "exact", head: true })
          .eq("workout_id", w.id);
        withEx.push({ w, count: count ?? 0 });
      }
      withEx.sort((a, b) => b.count - a.count);
      best = withEx[0].w;
    }

    const { error } = await sb.from("workout_device_links").insert({
      workout_id: best.id,
      device_session_id: s.id,
      match_method: "auto",
      confidence: 0.72,
    });
    if (error) {
      console.log("  LINK FAIL", error.message);
    } else {
      console.log("  LINKED →", best.id.slice(0, 8), "tonnage", best.total_tonnage);
      linkedW.add(best.id);
      linkedS.add(s.id);
    }
  }

  const { count } = await sb
    .from("workout_device_links")
    .select("*", { count: "exact", head: true });
  console.log("\nTotal links now:", count);
}

main().catch(console.error);
