import { NextResponse } from "next/server";
import { listRecentConversationsForUser } from "@/lib/agent/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?userId= — список недавних диалогов (id, время последнего сообщения, превью). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim() ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Нужен query userId" }, { status: 400 });
  }
  const conversations = await listRecentConversationsForUser(userId);
  return NextResponse.json({ conversations });
}
