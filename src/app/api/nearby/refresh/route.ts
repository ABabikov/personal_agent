import { refreshNearbyFeed } from "@/lib/features/nearby/refresh";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { userId?: string };
  try {
    body = (await request.json()) as { userId?: string };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 });
  }
  const userId = body.userId?.trim() ?? "";
  if (!userId) return NextResponse.json({ error: "Нет userId." }, { status: 400 });

  const refreshed = await refreshNearbyFeed(userId);
  if ("error" in refreshed) {
    return NextResponse.json({ error: refreshed.error }, { status: 400 });
  }
  return NextResponse.json(refreshed.result);
}
