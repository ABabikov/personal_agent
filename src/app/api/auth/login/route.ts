import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getConfiguredWorkoutUserIdFromEnv } from "@/lib/auth/workout-user-env";
import { issueSessionToken, SITE_AUTH_COOKIE } from "@/lib/auth/site-session";

export const runtime = "nodejs";

function passwordOk(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const sitePassword = process.env.SITE_PASSWORD?.trim();
  const secret = process.env.SITE_AUTH_SECRET?.trim();

  if (!sitePassword || !secret) {
    return NextResponse.json(
      { error: "Вход по паролю не настроен на сервере." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const pw =
    body && typeof body === "object" && typeof (body as { password?: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";

  if (!pw || !passwordOk(pw, sitePassword)) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const token = await issueSessionToken(secret);
  const workoutUserId = getConfiguredWorkoutUserIdFromEnv();
  const res = NextResponse.json({
    ok: true as const,
    workoutUserId,
  });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SITE_AUTH_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
