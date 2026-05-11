import { supabase } from "@/lib/db/supabase";
import type { Database } from "@/types/database";

const STORAGE_KEY = "personal_agent_workout_user_id";

type UserInsert = Database["public"]["Tables"]["users"]["Insert"];

function envUserId(): string | null {
  const v = process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim();
  return v && v.length > 0 ? v : null;
}

/** Minimal row so PostgREST accepts the insert with strict generated types */
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

/**
 * Resolves `users.id` for workout inserts: env override, then localStorage,
 * then creates an empty `users` row (needs INSERT policy for `anon` on `users`).
 */
export async function getWorkoutUserId(): Promise<
  { userId: string } | { error: string }
> {
  const fromEnv = envUserId();
  if (fromEnv) return { userId: fromEnv };

  if (typeof window === "undefined") {
    return { error: "Сохранение только в браузере." };
  }

  const cached = window.localStorage.getItem(STORAGE_KEY);
  if (cached) return { userId: cached };

  const { data, error } = await supabase
    .from("users")
    .insert(blankUserRow())
    .select("id")
    .single();

  if (error || !data) {
    const hint =
      "Проверь RLS/политики для `users` (INSERT для anon) или задай UUID строки в .env: NEXT_PUBLIC_WORKOUT_USER_ID.";
    return {
      error: error?.message
        ? `${error.message}. ${hint}`
        : `Не удалось создать пользователя. ${hint}`,
    };
  }

  window.localStorage.setItem(STORAGE_KEY, data.id);
  return { userId: data.id };
}
