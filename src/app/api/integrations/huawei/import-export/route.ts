import { join } from "node:path";
import { NextResponse } from "next/server";
import { importHuaweiMotionPathExport } from "@/lib/integrations/huawei/importExport";
import { resolveIntegrationUserId } from "@/lib/integrations/huawei/resolveUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EXPORT_DIR = join(process.cwd(), "docs", "huawei", "huawei data");

export async function POST(req: Request) {
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

  const exportDir =
    body &&
    typeof body === "object" &&
    typeof (body as { exportDir?: unknown }).exportDir === "string"
      ? (body as { exportDir: string }).exportDir
      : DEFAULT_EXPORT_DIR;

  try {
    const result = await importHuaweiMotionPathExport(userId, exportDir);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
