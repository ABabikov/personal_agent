// @ts-nocheck
/**
 * Зеркало двух чатов Max → kid_chat_messages.
 * Логин один раз (SMS), дальше сессия в .max-session.json.
 *
 *   npm i max-account-api
 *   npx tsx scripts/max-kids-mirror.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "../src/types/database";

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

const boyChat = process.env.MAX_CHAT_ID_BOY?.trim();
const girlChat = process.env.MAX_CHAT_ID_GIRL?.trim();
if (!boyChat || !girlChat) {
  console.error("Задайте MAX_CHAT_ID_BOY и MAX_CHAT_ID_GIRL в .env");
  process.exit(1);
}

const allowed = new Map<string, "boy" | "girl">([
  [boyChat, "boy"],
  [girlChat, "girl"],
]);

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Incoming = {
  chatId: string | number | bigint;
  id?: string | number;
  messageId?: string | number;
  fromId?: string | number;
  fromName?: string;
  text?: string;
  raw?: { status?: string };
};

async function save(message: Incoming) {
  const chatId = String(message.chatId);
  const childId = allowed.get(chatId);
  if (!childId) return;
  const messageId = String(message.messageId ?? message.id ?? "");
  if (!messageId) return;
  const status =
    message.raw?.status === "EDITED"
      ? "edited"
      : message.raw?.status === "REMOVED"
        ? "removed"
        : null;
  const { error } = await supabase.from("kid_chat_messages").upsert(
    {
      child_id: childId,
      max_chat_id: chatId,
      message_id: messageId,
      from_id: message.fromId != null ? String(message.fromId) : null,
      from_name: message.fromName ?? "",
      body: message.text ?? "",
      sent_at: new Date().toISOString(),
      status,
      raw: (message as unknown as Record<string, unknown>) ?? null,
    },
    { onConflict: "max_chat_id,message_id" },
  );
  if (error) console.error(error.message);
  else console.log(childId, messageId, message.text?.slice(0, 80) ?? "");
}

async function main() {
  const mod = await import("max-account-api").catch(() => {
    console.error("Сначала: npm i max-account-api");
    process.exit(1);
  });
  const MaxClient = (mod as { MaxClient: { loginWithPhone: Function } }).MaxClient;
  const readline = await import("node:readline/promises");
  const { stdin: input, stdout: output } = await import("node:process");
  const rl = readline.createInterface({ input, output });

  const client = await MaxClient.loginWithPhone({
    phone: process.env.MAX_PHONE ?? (await rl.question("Телефон Max (+7…): ")),
    getSmsCode: async () => process.env.MAX_SMS ?? (await rl.question("SMS-код: ")),
    sessionFile: "./.max-session.json",
  });
  rl.close();

  client.on("message", (message: Incoming) => {
    void save(message);
  });
  console.log("Слушаю чаты", boyChat, girlChat);
  await new Promise(() => undefined);
}

void main();
