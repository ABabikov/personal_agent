/**
 * Импорт истории тренировок из CSV в репозитории напрямую в Supabase (workouts + детали).
 * UI приложения JSON не использует — только этот офлайн-скрипт читает файлы из docs/...
 *
 * Запуск:
 *   npm run seed:supabase
 *   npm run seed:supabase:dry   — только посчитать строки, без Supabase
 *
 * Переменные в .env:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   WORKOUT_IMPORT_USER_ID или NEXT_PUBLIC_WORKOUT_USER_ID — UUID из `users`. Если не задан —
 *     создаётся новая строка `users`, id печатается в консоль.
 *
 * Повторный запуск удаляет все тренировки этого user_id (и связанные gym_exercises / swim_series),
 * затем записывает каталог из CSV заново.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import {
  parseGymCsv,
  parseSwimCsv,
  type ParsedGymWorkout,
  type ParsedSwimWorkout,
} from "../src/lib/features/workouts/csvImport";
import { totalTonnage } from "../src/lib/features/workouts/tonnage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const IMPORT_NOTE = "__seed:workout-catalog__";

const GYM_FILES: Record<string, string> = {
  pn: "тренировки.xlsx - пн (2).csv",
  sr: "тренировки.xlsx - ср (1).csv",
  pt: "тренировки.xlsx - пт (1).csv",
};

const SWIM_FILES: Record<string, string> = {
  vt: "тренировки.xlsx - вт (1).csv",
  cht: "тренировки.xlsx - чт (1).csv",
  sb: "тренировки.xlsx - сб (1).csv",
};

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

function loadCatalogFromRepoCsv(): { gymList: ParsedGymWorkout[]; swimList: ParsedSwimWorkout[] } {
  const res = join(
    root,
    "docs/features/workout-tracker/current_stat/resources"
  );
  if (!existsSync(res)) {
    console.error(`Нет каталога CSV: ${res}`);
    process.exit(1);
  }

  const gymChunks: ParsedGymWorkout[] = [];
  for (const fname of Object.values(GYM_FILES)) {
    const fp = join(res, fname);
    if (!existsSync(fp)) {
      console.error(`Нет файла: ${fp}`);
      process.exit(1);
    }
    const text = readFileSync(fp, "utf-8");
    const parsed = parseGymCsv(text);
    gymChunks.push(...parsed);
    console.log(`прочитано ${fname}: ${parsed.length} блоков`);
  }

  const swimChunks: ParsedSwimWorkout[] = [];
  for (const fname of Object.values(SWIM_FILES)) {
    const fp = join(res, fname);
    if (!existsSync(fp)) {
      console.error(`Нет файла: ${fp}`);
      process.exit(1);
    }
    const text = readFileSync(fp, "utf-8");
    const parsed = parseSwimCsv(text);
    swimChunks.push(...parsed);
    console.log(`прочитано ${fname}: ${parsed.length} блоков`);
  }

  gymChunks.sort((a, b) => a.date.localeCompare(b.date));
  swimChunks.sort((a, b) => a.date.localeCompare(b.date));
  return { gymList: gymChunks, swimList: swimChunks };
}

type UserInsert = Database["public"]["Tables"]["users"]["Insert"];

function blankUserRow(): UserInsert {
  return {
    telegram_id: null,
    weight: null,
    height: null,
    age: null,
    gender: null,
    activity_level: null,
    body_fat_pct: null,
    swim_equipment: null,
  };
}

loadEnvFromDotenv();

const dryRun = process.argv.includes("--dry-run");
const { gymList, swimList } = loadCatalogFromRepoCsv();

if (dryRun) {
  console.log(
    `dry-run: силовых ${gymList.length}, плавание ${swimList.length} (Supabase не вызывается)`
  );
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
let userId =
  process.env.WORKOUT_IMPORT_USER_ID?.trim() ||
  process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim();

if (!url || !key) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в .env");
  process.exit(1);
}

const supabase = createClient<Database>(url, key);

async function resolveUserId(): Promise<string> {
  if (userId && userId.length > 0) return userId;

  const { data, error } = await supabase
    .from("users")
    .insert(blankUserRow())
    .select("id")
    .single();

  if (error || !data) {
    console.error("Не удалось создать пользователя:", error?.message);
    process.exit(1);
  }
  userId = data.id;
  console.log(
    "\nСоздан новый users.id — добавьте в .env для того же аккаунта, что и в браузере:\n" +
      `  NEXT_PUBLIC_WORKOUT_USER_ID=${userId}\n` +
      `  WORKOUT_IMPORT_USER_ID=${userId}\n`
  );
  return userId;
}

async function wipeAllWorkoutsForUser(uid: string) {
  const { error } = await supabase.from("workouts").delete().eq("user_id", uid);
  if (error) {
    console.error("Не удалось удалить тренировки пользователя:", error.message);
    process.exit(1);
  }
}

async function main() {
  const uid = await resolveUserId();
  console.log(`user_id: ${uid}`);
  console.log(`К импорту: силовых ${gymList.length}, плавание ${swimList.length}`);

  await wipeAllWorkoutsForUser(uid);
  console.log("Удалены все существующие тренировки для user_id (дочерние строки — каскадом).");

  for (const w of gymList) {
    const summaries = w.exercises.map((e) => ({ sets: e.sets }));
    const total =
      w.totalTonnage != null
        ? w.totalTonnage
        : Math.round(totalTonnage(summaries) * 10) / 10;

    const { data: workout, error: wErr } = await supabase
      .from("workouts")
      .insert({
        user_id: uid,
        date: w.date,
        type: "gym",
        body_weight: w.bodyWeight,
        total_tonnage: total > 0 ? total : null,
        total_distance: null,
        calories_estimated: null,
        notes: IMPORT_NOTE,
      })
      .select("id")
      .single();

    if (wErr || !workout) {
      console.error("Ошибка вставки силовой", w.date, wErr?.message);
      process.exit(1);
    }

    const gymRows = w.exercises.map((ex, order_index) => ({
      workout_id: workout.id,
      exercise_name: ex.name,
      order_index,
      sets: ex.sets,
      tonnage: Math.round(ex.tonnage * 10) / 10,
    }));

    const { error: gErr } = await supabase.from("gym_exercises").insert(gymRows);
    if (gErr) {
      console.error("Ошибка gym_exercises", w.date, gErr.message);
      process.exit(1);
    }
  }

  for (const w of swimList) {
    const total_distance =
      w.totalDistance != null
        ? w.totalDistance
        : w.series.reduce((s, x) => s + x.distance, 0);

    const { data: workout, error: wErr } = await supabase
      .from("workouts")
      .insert({
        user_id: uid,
        date: w.date,
        type: "swim",
        body_weight: null,
        total_tonnage: null,
        total_distance,
        calories_estimated: null,
        notes: IMPORT_NOTE,
      })
      .select("id")
      .single();

    if (wErr || !workout) {
      console.error("Ошибка вставки плавания", w.date, wErr?.message);
      process.exit(1);
    }

    const swimRows = w.series.map((s, order_index) => ({
      workout_id: workout.id,
      order_index,
      distance: s.distance,
      description: s.description,
    }));

    const { error: sErr } = await supabase.from("swim_series").insert(swimRows);
    if (sErr) {
      console.error("Ошибка swim_series", w.date, sErr.message);
      process.exit(1);
    }
  }

  console.log("Готово: импорт записан в Supabase.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
