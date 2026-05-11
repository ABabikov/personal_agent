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

/**
 * Успешный ответ /api/workout-user кэшируем; ошибки сети/401 — нет (иначе после логина
 * остаётся «пустой» кэш и снова берётся старый localStorage с другого устройства).
 */
type ServerUserCache =
  | undefined
  | { ok: true; userId: string | null };

let serverUserCache: ServerUserCache;

/** Сброс после входа по паролю (на случай SPA без полной перезагрузки модулей). */
export function invalidateWorkoutUserIdCache(): void {
  serverUserCache = undefined;
}

/** Серверный WORKOUT_USER_ID — один UUID для всех устройств (см. /api/workout-user). */
async function fetchServerWorkoutUserId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (serverUserCache?.ok) {
    return serverUserCache.userId && serverUserCache.userId.length > 0
      ? serverUserCache.userId
      : null;
  }
  try {
    const r = await fetch("/api/workout-user", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) {
      return null;
    }
    const j: unknown = await r.json();
    if (j && typeof j === "object" && "userId" in j) {
      const raw = (j as { userId: unknown }).userId;
      if (raw === null) {
        serverUserCache = { ok: true, userId: null };
        return null;
      }
      if (typeof raw === "string") {
        const id = raw.trim();
        serverUserCache = { ok: true, userId: id.length > 0 ? id : null };
        return id.length > 0 ? id : null;
      }
    }
    serverUserCache = { ok: true, userId: null };
    return null;
  } catch {
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
 * Resolves `users.id`: сначала сервер (WORKOUT_USER_ID на Vercel), затем NEXT_PUBLIC_* из билда,
 * затем localStorage, затем создание строки в `users`.
 */
export async function getWorkoutUserId(): Promise<
  { userId: string } | { error: string }
> {
  if (typeof window === "undefined") {
    return { error: "Сохранение только в браузере." };
  }

  const fromServer = await fetchServerWorkoutUserId();
  if (fromServer) {
    writeStoredUserId(fromServer);
    return { userId: fromServer };
  }

  const fromEnv = envUserId();
  if (fromEnv) return { userId: fromEnv };

  const cached = readStoredUserId();
  if (cached) return { userId: cached };

  const { data, error } = await supabase
    .from("users")
    .insert(blankUserRow())
    .select("id")
    .single();

  if (error || !data) {
    const hint =
      "Проверь RLS/политики для `users` (INSERT для anon) или задай WORKOUT_USER_ID / NEXT_PUBLIC_WORKOUT_USER_ID в Vercel.";
    return {
      error: error?.message
        ? `${error.message}. ${hint}`
        : `Не удалось создать пользователя. ${hint}`,
    };
  }

  writeStoredUserId(data.id);
  return { userId: data.id };
}
