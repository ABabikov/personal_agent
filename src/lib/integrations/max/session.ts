import { MaxClient, MemorySessionStore, type MaxChat, type StoredSession } from "max-account-api";
import { supabase } from "@/lib/db/supabase";
import type { KidId } from "@/lib/features/kids-schedule/config";
import type { MaxChatOption, MaxSessionStatus } from "./types";

export type { MaxChatOption, MaxSessionStatus };

type SessionRow = {
  device_id: string | null;
  login_token: string | null;
  mobile_device_id: string | null;
  mt_instance_id: string | null;
  mobile_login_token: string | null;
  sms_token: string | null;
  owner_name: string | null;
};

function isMissingTable(message: string) {
  return /kid_max_session|schema cache|Could not find|relation/i.test(message);
}

export function normalizeMaxPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function summarizeChats(chats: MaxChat[]): MaxChatOption[] {
  return chats
    .filter((chat) => chat.type === "CHAT" || chat.type === "CHANNEL")
    .map((chat) => ({
      id: String(chat.id),
      title: chat.title?.trim() || `${chat.type} ${chat.id}`,
      type: String(chat.type ?? "CHAT"),
      participants: chat.participantsCount ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

async function readRow(): Promise<SessionRow | null> {
  const { data, error } = await supabase.from("kid_max_session").select("*").eq("id", 1).maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data as SessionRow | null;
}

async function writeRow(patch: Partial<SessionRow>) {
  const { error } = await supabase.from("kid_max_session").upsert(
    {
      id: 1,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    if (isMissingTable(error.message)) {
      throw new Error("Нет таблицы kid_max_session. Примените миграцию 018_kid_max_session.sql в Supabase.");
    }
    throw new Error(error.message);
  }
}

export async function loadMaxStoredSession(): Promise<StoredSession | null> {
  const envDevice = process.env.MAX_DEVICE_ID?.trim();
  const envToken = process.env.MAX_LOGIN_TOKEN?.trim();
  if (envDevice && envToken) {
    return { deviceId: envDevice, loginToken: envToken };
  }

  const row = await readRow();
  if (!row?.device_id || !row.login_token) return null;
  return {
    deviceId: row.device_id,
    loginToken: row.login_token,
    mobileDeviceId: row.mobile_device_id ?? undefined,
    mtInstanceId: row.mt_instance_id ?? undefined,
    mobileLoginToken: row.mobile_login_token ?? undefined,
  };
}

export async function saveMaxSession(session: StoredSession, ownerName?: string | null) {
  await writeRow({
    device_id: session.deviceId,
    login_token: session.loginToken ?? null,
    mobile_device_id: session.mobileDeviceId ?? null,
    mt_instance_id: session.mtInstanceId ?? null,
    mobile_login_token: session.mobileLoginToken ?? null,
    sms_token: null,
    owner_name: ownerName ?? null,
  });
}

export async function savePendingSms(input: {
  smsToken: string;
  deviceId: string;
  mobileDeviceId: string;
  mtInstanceId: string;
}) {
  await writeRow({
    sms_token: input.smsToken,
    device_id: input.deviceId,
    mobile_device_id: input.mobileDeviceId,
    mt_instance_id: input.mtInstanceId,
  });
}

export async function loadPendingSms() {
  const row = await readRow();
  if (!row?.sms_token || !row.device_id || !row.mobile_device_id || !row.mt_instance_id) {
    return null;
  }
  return {
    smsToken: row.sms_token,
    deviceId: row.device_id,
    mobileDeviceId: row.mobile_device_id,
    mtInstanceId: row.mt_instance_id,
  };
}

export async function resolveKidChatIds() {
  let boy = process.env.MAX_CHAT_ID_BOY?.trim() ?? "";
  let girl = process.env.MAX_CHAT_ID_GIRL?.trim() ?? "";
  if (!boy || !girl) {
    const { data } = await supabase.from("kids").select("id, max_chat_id");
    for (const row of data ?? []) {
      if (row.id === "boy" && row.max_chat_id) boy = boy || row.max_chat_id;
      if (row.id === "girl" && row.max_chat_id) girl = girl || row.max_chat_id;
    }
  }
  return { boy, girl };
}

export async function bindKidChatIds(boyChatId: string, girlChatId: string) {
  const boy = await supabase.from("kids").update({ max_chat_id: boyChatId }).eq("id", "boy");
  if (boy.error) throw new Error(boy.error.message);
  const girl = await supabase.from("kids").update({ max_chat_id: girlChatId }).eq("id", "girl");
  if (girl.error) throw new Error(girl.error.message);
}

export async function getMaxSessionStatus(): Promise<MaxSessionStatus> {
  const probe = await supabase.from("kid_max_session").select("id").eq("id", 1).maybeSingle();
  if (probe.error && isMissingTable(probe.error.message)) {
    return { connected: false, ownerName: null, boyChatId: "", girlChatId: "", needMigration: true };
  }
  const session = await loadMaxStoredSession();
  const chats = await resolveKidChatIds();
  const row = await readRow();
  return {
    connected: Boolean(session?.loginToken),
    ownerName: row?.owner_name ?? null,
    boyChatId: chats.boy,
    girlChatId: chats.girl,
  };
}

export async function withMaxClient<T>(fn: (client: MaxClient) => Promise<T>): Promise<T> {
  const creds = await loadMaxStoredSession();
  if (!creds?.deviceId || !creds.loginToken) {
    throw new Error("Max ещё не подключён. Откройте вкладку Чаты и войдите.");
  }

  const store = new MemorySessionStore(creds);
  const client = new MaxClient({
    session: store,
    printQr: false,
    printCredentialsAfterLogin: false,
    autoRead: false,
    chatsCount: 80,
  });

  await client.start();
  try {
    const next = await store.load();
    if (next.loginToken && next.loginToken !== creds.loginToken) {
      await saveMaxSession(next, client.getMe()?.names?.[0]?.name ?? null);
    }
    return await fn(client);
  } finally {
    await client.stop();
  }
}

export function childChatPairs(boy: string, girl: string): Array<[string, KidId]> {
  return [
    [boy, "boy"],
    [girl, "girl"],
  ];
}
