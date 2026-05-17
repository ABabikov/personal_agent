import { NextResponse } from "next/server";
import { getHuaweiConfig } from "@/lib/integrations/huawei/config";
import {
  defaultSyncRange,
  importHuaweiSessions,
} from "@/lib/integrations/huawei/importSessions";
import { getOAuthTokenRow } from "@/lib/integrations/huawei/storage";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const config = getHuaweiConfig();
  if (!config) {
    return NextResponse.json({ error: "Huawei Health не настроен" }, { status: 503 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // empty body ok
  }

  const userId = resolveIntegrationUserId(
    body && typeof body === "object" && "userId" in body
      ? String((body as { userId?: unknown }).userId ?? "")
      : null
  );
  if (!userId) {
    return NextResponse.json({ error: "Нужен userId" }, { status: 400 });
  }

  const token = await getOAuthTokenRow(userId);
  if (!token) {
    return NextResponse.json({ error: "Huawei не подключён" }, { status: 400 });
  }

  let from: Date;
  let to: Date;
  const b = body as { from?: string; to?: string; days?: number };
  if (b.from && b.to) {
    from = new Date(b.from);
    to = new Date(b.to);
  } else {
    const range = defaultSyncRange(typeof b.days === "number" ? b.days : 30);
    from = range.from;
    to = range.to;
  }

  try {
    const result = await importHuaweiSessions(config, userId, from, to);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
