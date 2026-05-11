/**
 * Разовый бэкфилл: пересчитать `workouts.calories_estimated` для силовых по тем же правилам,
 * что и `saveGymWorkoutToSupabase` / `estimateGymCalories` (MET + EPOC, без ручной длительности в БД).
 *
 * Запуск:
 *   npm run backfill:gym-calories
 *   npm run backfill:gym-calories:dry
 *
 * Флаги:
 *   --dry-run       — только лог, без update
 *   --force         — обновить все gym; иначе только строки с calories_estimated IS NULL
 *
 * .env (как у seed / backup):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (предпочтительно в проде) или NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Опционально ограничить пользователя:
 *   WORKOUT_IMPORT_USER_ID или NEXT_PUBLIC_WORKOUT_USER_ID
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database, GymSet } from "../src/types/database";
import { estimateGymCalories } from "../src/lib/features/workouts/calories";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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

loadEnvFromDotenv();

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const onlyMissing = !force;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const key = serviceKey || anonKey;

const filterUserId =
  process.env.WORKOUT_IMPORT_USER_ID?.trim() ||
  process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim() ||
  null;

if (!url || !key) {
  console.error(
    "Нужны NEXT_PUBLIC_SUPABASE_URL и (SUPABASE_SERVICE_ROLE_KEY или NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  );
  process.exit(1);
}

const supabase = createClient<Database>(url, key);

type WorkoutRow = Pick<
  Database["public"]["Tables"]["workouts"]["Row"],
  "id" | "user_id" | "body_weight" | "calories_estimated" | "date"
>;

function normalizeSets(raw: unknown): GymSet[] {
  if (!Array.isArray(raw)) return [];
  const out: GymSet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const w = Number((item as { weight?: unknown }).weight);
    const r = Number((item as { reps?: unknown }).reps);
    if (Number.isFinite(w) && Number.isFinite(r)) out.push({ weight: w, reps: r });
  }
  return out;
}

async function main() {
  let q = supabase
    .from("workouts")
    .select("id, user_id, body_weight, calories_estimated, date")
    .eq("type", "gym")
    .order("date", { ascending: true });

  if (filterUserId) q = q.eq("user_id", filterUserId);
  if (onlyMissing) q = q.is("calories_estimated", null);

  const { data: workouts, error: wErr } = await q;
  if (wErr) {
    console.error("workouts:", wErr.message);
    process.exit(1);
  }
  if (!workouts?.length) {
    console.log("Нет силовых для обработки (или все уже с ккал при --only-missing).");
    return;
  }

  const userIds = [...new Set(workouts.map((w) => w.user_id))];
  const weightByUser = new Map<string, number | null>();
  const { data: users, error: uErr } = await supabase
    .from("users")
    .select("id, weight")
    .in("id", userIds);
  if (uErr) {
    console.error("users:", uErr.message);
    process.exit(1);
  }
  for (const u of users ?? []) {
    weightByUser.set(u.id, u.weight);
  }

  const workoutIds = workouts.map((w) => w.id);
  const { data: allEx, error: eErr } = await supabase
    .from("gym_exercises")
    .select("workout_id, order_index, sets")
    .in("workout_id", workoutIds)
    .order("order_index", { ascending: true });
  if (eErr) {
    console.error("gym_exercises:", eErr.message);
    process.exit(1);
  }

  const byWorkout = new Map<string, { sets: GymSet[] }[]>();
  for (const row of allEx ?? []) {
    const list = byWorkout.get(row.workout_id) ?? [];
    list.push({ sets: normalizeSets(row.sets) });
    byWorkout.set(row.workout_id, list);
  }

  let updated = 0;
  let skipped = 0;

  for (const w of workouts as WorkoutRow[]) {
    const exercises = byWorkout.get(w.id) ?? [];
    const profileW = weightByUser.get(w.user_id) ?? null;
    const effective =
      w.body_weight != null && w.body_weight > 0
        ? w.body_weight
        : profileW != null && profileW > 0
          ? profileW
          : null;

    if (effective == null) {
      console.log(`skip ${w.date} ${w.id}: нет веса тела (workout + профиль)`);
      skipped++;
      continue;
    }

    const est = estimateGymCalories({
      bodyWeightKg: effective,
      exercises,
      durationMinOverride: null,
    });
    if (!est) {
      console.log(`skip ${w.date} ${w.id}: нет валидных подходов`);
      skipped++;
      continue;
    }

    const prev = w.calories_estimated;
    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("workouts")
        .update({ calories_estimated: est.calories })
        .eq("id", w.id);
      if (upErr) {
        console.error(`update ${w.id}:`, upErr.message);
        process.exit(1);
      }
    }
    updated++;
    const tag = dryRun ? "[dry-run]" : "OK";
    console.log(
      `${tag} ${w.date} ${w.id} → ${est.calories} ккал` +
        (prev != null ? ` (было ${prev})` : "")
    );
  }

  console.log(
    `\nИтого: обработано ${updated}, пропущено ${skipped}. Режим: ${dryRun ? "dry-run" : "write"}; ${onlyMissing ? "только NULL ккал" : "все gym (--force)"}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
