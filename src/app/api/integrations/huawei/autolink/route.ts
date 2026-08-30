import { NextResponse } from "next/server";
import {
  autoLinkSessionsForUser,
  materializeOrphanDeviceSessions,
  materializeOutdoorDeviceSessions,
} from "@/lib/integrations/huawei/linkSessions";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * body: { userId, materialize?: boolean, materializeOutdoor?: boolean }
 */
export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // empty ok
  }

  const userId = resolveIntegrationUserId(
    body && typeof body === "object" && "userId" in body
      ? String((body as { userId?: unknown }).userId ?? "")
      : null
  );
  if (!userId) {
    return NextResponse.json({ error: "Нужен userId" }, { status: 400 });
  }

  const b = body as {
    materialize?: unknown;
    materializeOutdoor?: unknown;
  };
  const materialize = b.materialize === true;
  const materializeOutdoor = b.materializeOutdoor === true;

  try {
    const linked = await autoLinkSessionsForUser(userId);
    let materialized: Awaited<
      ReturnType<typeof materializeOrphanDeviceSessions>
    > | null = null;
    let outdoor: Awaited<
      ReturnType<typeof materializeOutdoorDeviceSessions>
    > | null = null;
    if (materialize) {
      materialized = await materializeOrphanDeviceSessions(userId);
    }
    if (materializeOutdoor) {
      outdoor = await materializeOutdoorDeviceSessions(userId);
    }
    return NextResponse.json({
      ok: true,
      linked,
      materialized,
      outdoor,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "autolink failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
