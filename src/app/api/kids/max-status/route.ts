import { NextResponse } from "next/server";
import { getMaxSessionStatus } from "@/lib/integrations/max/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getMaxSessionStatus());
  } catch (err) {
    return NextResponse.json(
      { connected: false, ownerName: null, boyChatId: "", girlChatId: "", error: err instanceof Error ? err.message : "status failed" },
      { status: 500 },
    );
  }
}
