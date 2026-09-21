import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const token = process.env.TELEGRAM_KIDS_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_KIDS_BOT_TOKEN is missing");
  process.exit(1);
}

const webApp =
  process.env.TELEGRAM_KIDS_WEBAPP_URL?.replace(/\/$/, "") ||
  (process.env.NEXT_PUBLIC_SITE_URL
    ? `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/kids`
    : "");
const webhookUrl = process.env.TELEGRAM_KIDS_WEBHOOK_URL?.replace(/\/$/, "");

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description ?? "failed"}`);
  return data.result;
}

await call("setMyName", { name: "Расписание детей" });
await call("setMyDescription", {
  description: "Личное расписание: уроки, кружки, ДЗ и два классных чата из Max.",
});
await call("setMyShortDescription", {
  short_description: "Расписание мальчика и девочки",
});
await call("setMyCommands", {
  commands: [
    { command: "start", description: "Открыть расписание" },
    { command: "app", description: "Открыть миниапп" },
  ],
});

if (webApp) {
  await call("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Расписание",
      web_app: { url: webApp },
    },
  });
  console.log("Menu button ->", webApp);
} else {
  console.log("TELEGRAM_KIDS_WEBAPP_URL пустой — кнопку меню не ставил (нужен HTTPS).");
}

if (webhookUrl) {
  await call("setWebhook", {
    url: webhookUrl,
    secret_token: process.env.TELEGRAM_KIDS_WEBHOOK_SECRET || undefined,
    allowed_updates: ["message"],
  });
  console.log("Webhook ->", webhookUrl);
} else {
  console.log("TELEGRAM_KIDS_WEBHOOK_URL пустой — webhook не ставил.");
}

console.log("Kids bot setup done.");
