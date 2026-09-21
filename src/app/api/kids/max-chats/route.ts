import { NextResponse } from "next/server";
import { bindKidChatIds, summarizeChats, withMaxClient } from "@/lib/integrations/max/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const chats = await withMaxClient(async (client) => summarizeChats(client.getChats()));
    return NextResponse.json({ ok: true, chats });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Не удалось получить чаты" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { boyChatId?: string; girlChatId?: string };
    const boyChatId = String(body.boyChatId ?? "").trim();
    const girlChatId = String(body.girlChatId ?? "").trim();
    if (!boyChatId || !girlChatId) {
      return NextResponse.json({ ok: false, error: "Нужны оба чата" }, { status: 400 });
    }
    if (boyChatId === girlChatId) {
      return NextResponse.json({ ok: false, error: "Это один и тот же чат" }, { status: 400 });
    }
    await bindKidChatIds(boyChatId, girlChatId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Не удалось сохранить чаты" }, { status: 400 });
  }
}
