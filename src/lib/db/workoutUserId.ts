import { supabase } from "@/lib/db/supabase";
import type { Database } from "@/types/database";

const STORAGE_KEY = "personal_agent_workout_user_id";

type UserInsert = Database["public"]["Tables"]["users"]["Insert"];

function envUserId(): string | null {
  const v = process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim();
  return v && v.length > 0 ? v : null;
}

function readStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredUserId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // приватный режим / ITP — работаем без кэша, данные всё равно подтянутся с сервера
  }
}

/** Ответ /api/workout-user за сессию вкладки (не дергать на каждый экран). */
let serverUserIdMemo: string | null | undefined;

/** Серверный WORKOUT_USER_ID — один UUID для всех устройств (см. /api/workout-user). */
async function fetchServerWorkoutUserId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (serverUserIdMemo !== undefined) return serverUserIdMemo;
  try {
    const r = await fetch("/api/workout-user", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) {
      serverUserIdMemo = null;
      return null;
    }
    const j: unknown = await r.json();
    if (
      j &&
      typeof j === "object" &&
      "userId" in j &&
      typeof (j as { userId: unknown }).userId === "string"
    ) {
      const id = (j as { userId: string }).userId.trim();
      serverUserIdMemo = id.length > 0 ? id : null;
      return serverUserIdMemo;
    }
    serverUserIdMemo = null;
    return null;
  } catch {
    serverUserIdMemo = null;
    return null;
  }
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

  const fromServer = await fetchServerWorkoutUserId();
  if (fromServer) {
    writeStoredUserId(fromServer);
    return { userId: fromServer };
  }

  const cached = readStoredUserId();
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

  writeStoredUserId(data.id);
  return { userId: data.id };
}
