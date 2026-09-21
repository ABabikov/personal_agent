import { NextResponse } from "next/server";
import { sendMaxSms, verifyMaxSms } from "@/lib/integrations/max/login";

export const runtime = "nodejs";
export const maxDuration = 60;

type LoginBody = {
  action?: "phone" | "verify";
  phone?: string;
  code?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный запрос" }, { status: 400 });
  }

  if (body.action === "phone") {
    try {
      return NextResponse.json(await sendMaxSms(body.phone ?? ""));
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "SMS не отправилась" },
        { status: 400 },
      );
    }
  }

  if (body.action === "verify") {
    try {
      return NextResponse.json(await verifyMaxSms(body.code ?? "", body.password));
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Код не подошёл" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
}
