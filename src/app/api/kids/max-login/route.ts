import { NextResponse } from "next/server";
import { loginMaxByLink, sendMaxSms, verifyMaxSms } from "@/lib/integrations/max/login";

export const runtime = "nodejs";
export const maxDuration = 60;

type LoginBody = {
  action?: "phone" | "verify" | "link";
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

  if (body.action === "link") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          const result = await loginMaxByLink((link) => send({ type: "link", link }), body.password);
          send({ type: "ok", ...result });
        } catch (err) {
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Не удалось привязать Max",
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return NextResponse.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
}
