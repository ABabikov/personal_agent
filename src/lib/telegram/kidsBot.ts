const API = "https://api.telegram.org";

function token() {
  const value = process.env.TELEGRAM_KIDS_BOT_TOKEN;
  if (!value) throw new Error("TELEGRAM_KIDS_BOT_TOKEN is not set");
  return value;
}

export async function kidsBotCall<T>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram ${method} failed`);
  return data.result as T;
}

export function kidsWebAppUrl() {
  const raw = process.env.TELEGRAM_KIDS_WEBAPP_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return `${site.replace(/\/$/, "")}/kids`;
  return "";
}

export async function sendKidsStartMessage(chatId: number) {
  const url = kidsWebAppUrl();
  await kidsBotCall("sendMessage", {
    chat_id: chatId,
    text: "Расписание мальчика и девочки: уроки, кружки, ДЗ и два чата.",
    reply_markup: url
      ? { inline_keyboard: [[{ text: "Открыть расписание", web_app: { url } }]] }
      : undefined,
  });
}
