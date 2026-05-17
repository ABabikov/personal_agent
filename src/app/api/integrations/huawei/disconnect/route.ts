import { NextResponse } from "next/server";
import { deleteOAuthTokens } from "@/lib/integrations/huawei/storage";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // ok
  }

  const userId = resolveIntegrationUserId(
    body && typeof body === "object" && "userId" in body
      ? String((body as { userId?: unknown }).userId ?? "")
      : null
  );
  if (!userId) {
    return NextResponse.json({ error: "Нужен userId" }, { status: 400 });
  }

  await deleteOAuthTokens(userId);
  return NextResponse.json({ ok: true });
}
