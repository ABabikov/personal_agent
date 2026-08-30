/**
 * Быстрая проверка: workouts vs sessions по user_id.
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

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const userId = (
    process.env.WORKOUT_IMPORT_USER_ID ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID ||
    ""
  )
    .trim()
    .replace(/\s/g, "");

  console.log("userId:", JSON.stringify(userId));
  console.log("has service role:", !!service);

  for (const [label, key] of [
    ["anon", anon],
    ["service", service || anon],
  ] as const) {
    const sb = createClient(url, key);
    const all = await sb
      .from("workouts")
      .select("id, user_id, date, type, status, deleted_at", { count: "exact" })
      .eq("user_id", userId)
      .limit(5);
    console.log(`\n[${label}] eq user_id:`, {
      count: all.count,
      error: all.error?.message,
      sample: all.data?.slice(0, 2),
    });

    const any = await sb
      .from("workouts")
      .select("id, user_id, date, status", { count: "exact" })
      .limit(5);
    console.log(`[${label}] any workouts:`, {
      count: any.count,
      error: any.error?.message,
      users: [...new Set((any.data ?? []).map((w) => w.user_id))],
      sample: any.data?.slice(0, 2),
    });

    const sessions = await sb
      .from("device_activity_sessions")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .limit(1);
    console.log(`[${label}] sessions for user:`, {
      count: sessions.count,
      error: sessions.error?.message,
    });

    const links = await sb
      .from("workout_device_links")
      .select("id, workout_id, device_session_id", { count: "exact" })
      .limit(3);
    console.log(`[${label}] links:`, {
      count: links.count,
      error: links.error?.message,
      sample: links.data,
    });
  }
}

main().catch(console.error);
