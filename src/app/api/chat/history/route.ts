import { NextResponse } from "next/server";
import {
  getLatestConversationIdForUser,
  loadConversation,
} from "@/lib/agent/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?userId=&conversationId=
 * — если conversationId задан: грузим историю этого диалога;
 * — если нет: подставляем последний диалог пользователя (по последнему сообщению).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim() ?? "";
  let conversationId = url.searchParams.get("conversationId")?.trim() ?? "";

  if (!userId) {
    return NextResponse.json({ error: "Нужен query userId" }, { status: 400 });
  }

  if (!conversationId) {
    conversationId = (await getLatestConversationIdForUser(userId)) ?? "";
  }

  if (!conversationId) {
    return NextResponse.json({ conversationId: null, messages: [] });
  }

  const messages = await loadConversation(userId, conversationId);
  return NextResponse.json({
    conversationId,
    messages,
  });
}
