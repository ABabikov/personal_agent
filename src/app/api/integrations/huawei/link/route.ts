import { NextResponse } from "next/server";
import { manualLinkSession } from "@/lib/integrations/huawei/linkSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const workoutId =
    body && typeof body === "object" && typeof (body as { workoutId?: unknown }).workoutId === "string"
      ? (body as { workoutId: string }).workoutId
      : null;
  const deviceSessionId =
    body &&
    typeof body === "object" &&
    typeof (body as { deviceSessionId?: unknown }).deviceSessionId === "string"
      ? (body as { deviceSessionId: string }).deviceSessionId
      : null;

  if (!workoutId || !deviceSessionId) {
    return NextResponse.json(
      { error: "Нужны workoutId и deviceSessionId" },
      { status: 400 }
    );
  }

  try {
    await manualLinkSession(workoutId, deviceSessionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "link failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
