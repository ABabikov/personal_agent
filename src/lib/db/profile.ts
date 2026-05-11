import { supabase } from "@/lib/db/supabase";
import type { Database } from "@/types/database";

export type Gender = "male" | "female";

export type ProfileForm = {
  weight: number | null;
  height: number | null;
  age: number | null;
  gender: Gender | null;
  activity_level: number;
  body_fat_pct: number | null;
};

type UserRow = Database["public"]["Tables"]["users"]["Row"];

export const DEFAULT_PROFILE: ProfileForm = {
  weight: null,
  height: null,
  age: null,
  gender: null,
  activity_level: 1.55,
  body_fat_pct: null,
};

function rowToProfile(row: UserRow): ProfileForm {
  return {
    weight: row.weight != null ? Number(row.weight) : null,
    height: row.height != null ? Number(row.height) : null,
    age: row.age != null ? Number(row.age) : null,
    gender: row.gender,
    activity_level: row.activity_level != null ? Number(row.activity_level) : 1.55,
    body_fat_pct: row.body_fat_pct != null ? Number(row.body_fat_pct) : null,
  };
}

const USER_PROFILE_SELECT =
  "id, telegram_id, weight, height, age, gender, activity_level, body_fat_pct, swim_equipment, created_at, updated_at" as const;

/**
 * Читает строку `users` и возвращает заполненную форму.
 * Если строки нет — `data: null` (форма покажет дефолты).
 */
export async function loadUserProfile(
  userId: string
): Promise<{ data: ProfileForm | null } | { error: string }> {
  const { data, error } = await supabase
    .from("users")
    .select(USER_PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { data: null };
  return { data: rowToProfile(data) };
}

/**
 * Сохраняет профиль: обновление существующей строки или вставка с заданным id,
 * если строки ещё нет (например, UUID из .env, но пользователь не создан в БД).
 *
 * Возвращает сохранённую строку (то, что реально лежит в БД после операции).
 * Telegram и swim_equipment при вставке задаём в null; при обновлении не трогаем.
 */
export async function saveUserProfile(
  userId: string,
  profile: ProfileForm
): Promise<{ ok: true; data: ProfileForm } | { error: string }> {
  const { data: existing, error: selErr } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (selErr) return { error: selErr.message };

  const patch: Database["public"]["Tables"]["users"]["Update"] = {
    weight: profile.weight,
    height: profile.height,
    age: profile.age,
    gender: profile.gender,
    activity_level: profile.activity_level,
    body_fat_pct: profile.body_fat_pct,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("users")
      .update(patch)
      .eq("id", userId)
      .select(USER_PROFILE_SELECT)
      .single();

    if (error) return { error: error.message };
    if (!data) {
      return {
        error: "Сохранение вернуло пустую строку — проверь RLS-политики таблицы `users`.",
      };
    }
    return { ok: true, data: rowToProfile(data) };
  }

  type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
  const newRow = {
    id: userId,
    telegram_id: null,
    weight: profile.weight,
    height: profile.height,
    age: profile.age,
    gender: profile.gender,
    activity_level: profile.activity_level,
    body_fat_pct: profile.body_fat_pct,
    swim_equipment: null,
  };

  const { data, error } = await supabase
    .from("users")
    /** PostgREST принимает id для явного UUID; тип Insert из генератора без поля id */
    .insert(newRow as unknown as UserInsert)
    .select(USER_PROFILE_SELECT)
    .single();

  if (error) return { error: error.message };
  if (!data) {
    return {
      error: "Сохранение вернуло пустую строку — проверь RLS-политики таблицы `users`.",
    };
  }
  return { ok: true, data: rowToProfile(data) };
}
