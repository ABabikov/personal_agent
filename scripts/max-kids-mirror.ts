/**
 * Зеркало двух чатов Max → kid_chat_messages.
 *
 *   npm run mirror:max-kids
 *
 * Первый запуск: QR в терминале (или SMS, если задан MAX_PHONE).
 * Сессия пишется в .max-session.json. Дальше переподключается сам.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { MaxClient, type IncomingMessage, type MaxChat, type MaxMessage } from "max-account-api";
import type { Database } from "../src/types/database";
import type { KidId } from "../src/lib/features/kids-schedule/config";

const SESSION_FILE = resolve(process.cwd(), ".max-session.json");

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnv();

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function envChat(key: "MAX_CHAT_ID_BOY" | "MAX_CHAT_ID_GIRL") {
  const raw = process.env[key]?.trim();
  return raw && raw.length > 0 ? raw : "";
}

function writeEnvChatIds(boyId: string, girlId: string) {
  const path = resolve(process.cwd(), ".env");
  let text = readFileSync(path, "utf8");
  text = text.replace(/MAX_CHAT_ID_BOY=.*/g, `MAX_CHAT_ID_BOY=${boyId}`);
  text = text.replace(/MAX_CHAT_ID_GIRL=.*/g, `MAX_CHAT_ID_GIRL=${girlId}`);
  writeFileSync(path, text, "utf8");
}

function chatTitle(chat: MaxChat) {
  return chat.title?.trim() || `${chat.type} ${chat.id}`;
}

function printChats(chats: MaxChat[]) {
  const groups = chats.filter((c) => c.type === "CHAT" || c.type === "CHANNEL");
  console.log("\nГруппы и каналы:");
  for (const chat of groups) {
    console.log(`  ${chat.id}\t${chatTitle(chat)}\t(${chat.participantsCount ?? "?"} чел.)`);
  }
  return groups;
}

function incomingToMessage(incoming: IncomingMessage): { chatId: number; msg: MaxMessage } {
  const raw = incoming as IncomingMessage & { message?: MaxMessage; id?: string };
  const msg = raw.message ?? (incoming as unknown as MaxMessage);
  return { chatId: Number(incoming.chatId), msg };
}

function attachLabel(attach: { _type?: string; name?: string; fileName?: string }) {
  const kind =
    attach._type === "PHOTO" || attach._type === "IMAGE"
      ? "photo"
      : attach._type === "FILE"
        ? "file"
        : "other";
  const name = String(attach.name ?? attach.fileName ?? attach._type ?? "вложение");
  return { kind: kind as "photo" | "file" | "other", name };
}

async function saveMessage(childId: KidId, chatId: string, msg: MaxMessage) {
  const status =
    msg.status === "EDITED" ? "edited" : msg.status === "REMOVED" ? "removed" : null;
  const sentAt = msg.time
    ? new Date(msg.time > 1e12 ? msg.time : msg.time * 1000).toISOString()
    : new Date().toISOString();

  const { data, error } = await supabase
    .from("kid_chat_messages")
    .upsert(
      {
        child_id: childId,
        max_chat_id: chatId,
        message_id: String(msg.id),
        from_id: msg.sender != null ? String(msg.sender) : null,
        from_name: msg.sender != null ? String(msg.sender) : "",
        body: msg.text ?? "",
        sent_at: sentAt,
        status,
        raw: msg as unknown as Record<string, unknown>,
      },
      { onConflict: "max_chat_id,message_id" },
    )
    .select("id")
    .single();
  if (error) {
    console.error("save", error.message);
    return;
  }

  const attaches = msg.attaches ?? [];
  if (data?.id && attaches.length > 0) {
    await supabase.from("kid_chat_attachments").delete().eq("message_id", data.id);
    const rows = attaches.map((attach) => {
      const meta = attachLabel(attach);
      return { message_id: data.id, kind: meta.kind, name: meta.name, storage_path: null };
    });
    const ins = await supabase.from("kid_chat_attachments").insert(rows);
    if (ins.error) console.error("attach", ins.error.message);
  }

  const mark = msg.text?.slice(0, 80) || (attaches.length ? `[${attaches.length} влож.]` : "");
  console.log(`${childId} ${sentAt.slice(0, 16)} ${mark}`);
}

async function backfill(client: MaxClient, allowed: Map<string, KidId>) {
  for (const [chatId, childId] of allowed) {
    try {
      await client.subscribeChat(Number(chatId), true);
      const history = await client.getHistory(Number(chatId), { backward: 80 });
      const list = [...history].reverse();
      for (const msg of list) {
        await saveMessage(childId, chatId, msg);
      }
      console.log(`история ${childId}: ${list.length} сообщений`);
    } catch (err) {
      console.error(`история ${childId}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function login(rl: ReturnType<typeof createInterface>) {
  if (existsSync(SESSION_FILE)) {
    const client = new MaxClient({ sessionFile: SESSION_FILE, printQr: false });
    await client.start();
    return client;
  }

  const phone = process.env.MAX_PHONE?.trim();
  if (phone) {
    return MaxClient.loginWithPhone({
      phone,
      getSmsCode: () => rl.question("SMS-код из Max: "),
      getPassword: (challenge) =>
        rl.question(`Облачный пароль Max (подсказка: ${challenge.hint ?? "—"}): `),
      sessionFile: SESSION_FILE,
    });
  }

  console.log("Сессии нет. Сканируйте QR в Max (или задайте MAX_PHONE в .env).");
  const client = new MaxClient({ sessionFile: SESSION_FILE });
  await client.start();
  return client;
}

async function pickTwoChats(chats: MaxChat[], rl: ReturnType<typeof createInterface>) {
  let boyId = envChat("MAX_CHAT_ID_BOY");
  let girlId = envChat("MAX_CHAT_ID_GIRL");
  if (boyId && girlId) return { boyId, girlId };

  const groups = printChats(chats);
  if (groups.length === 0) {
    throw new Error("Групп не видно. Откройте классные чаты в Max и перезапустите.");
  }
  boyId = (await rl.question("\nchat_id чата мальчика: ")).trim();
  girlId = (await rl.question("chat_id чата девочки: ")).trim();
  if (!boyId || !girlId) throw new Error("Нужны оба chat_id");
  writeEnvChatIds(boyId, girlId);
  console.log("Записал MAX_CHAT_ID_BOY / MAX_CHAT_ID_GIRL в .env");
  return { boyId, girlId };
}

async function rememberChatIds(boyId: string, girlId: string) {
  await supabase.from("kids").update({ max_chat_id: boyId }).eq("id", "boy");
  await supabase.from("kids").update({ max_chat_id: girlId }).eq("id", "girl");
}

async function main() {
  const rl = createInterface({ input, output });
  const client = await login(rl);
  const me = client.getMe();
  console.log("Max:", me?.names?.[0]?.name ?? me?.id ?? "ok");

  const { boyId, girlId } = await pickTwoChats(client.getChats(), rl);
  rl.close();

  const allowed = new Map<string, KidId>([
    [boyId, "boy"],
    [girlId, "girl"],
  ]);
  await rememberChatIds(boyId, girlId);
  await backfill(client, allowed);

  client.on("message", (incoming) => {
    const { chatId, msg } = incomingToMessage(incoming);
    const childId = allowed.get(String(chatId));
    if (!childId || !msg?.id) return;
    void saveMessage(childId, String(chatId), msg);
  });

  const session = existsSync(SESSION_FILE)
    ? (JSON.parse(readFileSync(SESSION_FILE, "utf8")) as {
        deviceId?: string;
        loginToken?: string;
      })
    : {};
  if (session.deviceId && session.loginToken) {
    console.log("\nДля Vercel (Environment Variables):");
    console.log(`MAX_DEVICE_ID=${session.deviceId}`);
    console.log(`MAX_LOGIN_TOKEN=${session.loginToken}`);
    console.log(`MAX_CHAT_ID_BOY=${boyId}`);
    console.log(`MAX_CHAT_ID_GIRL=${girlId}`);
  }

  if (process.argv.includes("--setup")) {
    console.log("\n--setup: сессия готова, демон не держу. Добавьте переменные на Vercel и задеплойте.");
    await client.stop();
    return;
  }

  console.log(`Слушаю только ${boyId} (мальчик) и ${girlId} (девочка). Не закрывайте окно.`);
  await new Promise(() => undefined);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
