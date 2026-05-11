import { NextResponse } from "next/server";

/**
 * Единый UUID пользователя для всех клиентов (десктоп, мобильный), без дублирования
 * NEXT_PUBLIC в бандле. Задаётся в Vercel как WORKOUT_USER_ID (строка из Supabase `users.id`).
 */
export async function GET() {
  const id =
    process.env.WORKOUT_USER_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim() ||
    "";
  if (!id) {
    return NextResponse.json({ userId: null as string | null });
  }
  return NextResponse.json({ userId: id });
}
