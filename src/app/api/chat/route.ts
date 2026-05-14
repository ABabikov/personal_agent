import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/loop";
import { safeParseClientMealPlanPayload } from "@/lib/features/meal-plan/mealPlanMerge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const obj = body as Record<string, unknown>;
  const userId = typeof obj.userId === "string" ? obj.userId : "";
  const conversationId =
    typeof obj.conversationId === "string" ? obj.conversationId : "";
  const message = typeof obj.message === "string" ? obj.message : "";
  const pageContext =
    typeof obj.pageContext === "string" ? obj.pageContext.trim() : "";
  const mealPlanClient = safeParseClientMealPlanPayload(obj.mealPlan);

  if (!userId || !conversationId || !message.trim()) {
    return NextResponse.json(
      { error: "Нужны поля userId, conversationId, message" },
      { status: 400 }
    );
  }

  try {
    const result = await runAgent({
      userId,
      conversationId,
      userMessage: message,
      pageContext: pageContext || undefined,
      mealPlanClient: mealPlanClient ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat] runAgent failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
