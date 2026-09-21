import { NextResponse } from "next/server";
import { sendKidsStartMessage } from "@/lib/telegram/kidsBot";

export const runtime = "nodejs";

type Update = {
  message?: {
    chat?: { id: number };
    text?: string;
  };
};

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_KIDS_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const update = (await request.json()) as Update;
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  if (chatId && (text === "/start" || text === "/app")) {
    await sendKidsStartMessage(chatId);
  }
  return NextResponse.json({ ok: true });
}
