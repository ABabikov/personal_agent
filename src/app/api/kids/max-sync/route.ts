import { NextResponse } from "next/server";
import { syncKidsMaxChats } from "@/lib/integrations/max/kidsSync";

export const runtime = "nodejs";
export const maxDuration = 60;

async function run() {
  try {
    const result = await syncKidsMaxChats();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Max sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return run();
}

export async function POST() {
  return run();
}
