import type { MaxMessage } from "max-account-api";
import { supabase } from "@/lib/db/supabase";
import type { KidId } from "@/lib/features/kids-schedule/config";
import { childChatPairs, resolveKidChatIds, withMaxClient } from "./session";

export type KidsMaxSyncResult = {
  ok: boolean;
  error?: string;
  pulled?: { boy: number; girl: number };
};

function attachMeta(attach: { _type?: string; name?: string; fileName?: string }) {
  const kind =
    attach._type === "PHOTO" || attach._type === "IMAGE"
      ? "photo"
      : attach._type === "FILE"
        ? "file"
        : "other";
  return {
    kind: kind as "photo" | "file" | "other",
    name: String(attach.name ?? attach.fileName ?? attach._type ?? "вложение"),
  };
}

async function persist(childId: KidId, chatId: string, msg: MaxMessage) {
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
  if (error) throw new Error(error.message);

  const attaches = msg.attaches ?? [];
  if (data?.id && attaches.length > 0) {
    await supabase.from("kid_chat_attachments").delete().eq("message_id", data.id);
    const rows = attaches.map((attach) => {
      const meta = attachMeta(attach);
      return {
        message_id: data.id,
        kind: meta.kind,
        name: meta.name,
        storage_path: null,
      };
    });
    const ins = await supabase.from("kid_chat_attachments").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
  }
}

export async function syncKidsMaxChats(): Promise<KidsMaxSyncResult> {
  const { boy, girl } = await resolveKidChatIds();
  if (!boy || !girl) {
    return { ok: false, error: "Чаты ещё не выбраны. Подключите Max и отметьте два классных чата." };
  }

  try {
    const pulled = await withMaxClient(async (client) => {
      const counts = { boy: 0, girl: 0 };
      for (const [chatId, childId] of childChatPairs(boy, girl)) {
        const history = await client.getHistory(Number(chatId), { backward: 80 });
        for (const msg of history) {
          await persist(childId, chatId, msg);
        }
        counts[childId] = history.length;
      }
      return counts;
    });
    return { ok: true, pulled };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Max sync failed" };
  }
}
