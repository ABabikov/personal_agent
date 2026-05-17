import { NextResponse } from "next/server";
import { getHuaweiConfig } from "@/lib/integrations/huawei/config";
import { getOAuthTokenRow } from "@/lib/integrations/huawei/storage";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const configured = !!getHuaweiConfig();
  const url = new URL(req.url);
  const userId = resolveIntegrationUserId(url.searchParams.get("userId"));

  if (!userId) {
    return NextResponse.json({
      configured,
      connected: false,
      scope: null,
      expiresAt: null,
    });
  }

  const row = await getOAuthTokenRow(userId).catch(() => null);

  return NextResponse.json({
    configured,
    connected: !!row,
    scope: row?.scope ?? null,
    expiresAt: row?.expires_at ?? null,
  });
}
