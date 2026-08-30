/**
 * Что осталось непривязанным после link:huawei.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { sessionDateInZone, candidateJournalDates } from "../src/lib/integrations/huawei/timezone";

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
  const uid = (
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID || ""
  ).replace(/\s/g, "");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: sessions } = await sb
    .from("device_activity_sessions")
    .select(
      "id, started_at, activity_type_mapped, activity_type_raw, duration_seconds, calories_device"
    )
    .eq("user_id", uid)
    .eq("source", "huawei");

  const { data: links } = await sb
    .from("workout_device_links")
    .select("device_session_id");
  const linked = new Set((links ?? []).map((l) => l.device_session_id));

  const unlinked = (sessions ?? []).filter((s) => !linked.has(s.id));
  console.log("Unlinked total:", unlinked.length);
  console.log(
    "  gym/swim:",
    unlinked.filter((s) => s.activity_type_mapped === "gym" || s.activity_type_mapped === "swim")
      .length
  );
  console.log(
    "  other:",
    unlinked.filter((s) => s.activity_type_mapped === "other").length
  );

  for (const s of unlinked.filter(
    (x) => x.activity_type_mapped === "gym" || x.activity_type_mapped === "swim"
  )) {
    const dates = candidateJournalDates(s.started_at);
    const { data: ws } = await sb
      .from("workouts")
      .select("id, date, type, status")
      .eq("user_id", uid)
      .eq("type", s.activity_type_mapped!)
      .in("date", dates)
      .is("deleted_at", null);
    console.log(
      `\n${s.activity_type_mapped} raw=${s.activity_type_raw} ${sessionDateInZone(s.started_at)} dur=${s.duration_seconds ? Math.round(s.duration_seconds / 60) : "?"}min`
    );
    console.log(
      "  candidates:",
      (ws ?? []).map((w) => `${w.date} ${w.status} ${w.id.slice(0, 8)}`).join(", ") || "none"
    );
  }

  const { count: materialized } = await sb
    .from("workouts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", uid)
    .like("notes", "%__huawei:materialized__%");
  console.log("\nMaterialized workouts in journal:", materialized);
  console.log("Total links:", links?.length);
}

main().catch(console.error);
