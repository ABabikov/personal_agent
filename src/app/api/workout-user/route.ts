import { NextResponse } from "next/server";
import { getConfiguredWorkoutUserIdFromEnv } from "@/lib/auth/workout-user-env";

export const dynamic = "force-dynamic";

/**
 * Единый UUID пользователя для всех клиентов (десктоп, мобильный), без дублирования
 * NEXT_PUBLIC в бандле. Задаётся в Vercel как WORKOUT_USER_ID (строка из Supabase `users.id`).
 */
export async function GET() {
  const id = getConfiguredWorkoutUserIdFromEnv();
  if (!id) {
    return NextResponse.json({ userId: null as string | null });
  }
  return NextResponse.json({ userId: id });
}
