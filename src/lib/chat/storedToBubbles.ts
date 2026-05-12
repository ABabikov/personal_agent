import type {
  ConversationSummary,
  StoredMessage,
} from "@/lib/agent/memory/store";
import type { ChatBubble } from "@/components/chat/chat-message-view";

/** Сообщения из БД → пузыри UI (tool и «пустые» assistant с tool_calls не показываем). */
export function storedMessagesToDisplayBubbles(messages: StoredMessage[]): ChatBubble[] {
  const out: ChatBubble[] = [];
  for (const m of messages) {
    if (m.role === "tool" || m.role === "system") continue;
    if (m.role === "user") {
      out.push({ role: "user", text: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const hasTools = m.tool_calls && m.tool_calls.length > 0;
      const text = m.content.trim();
      if (hasTools && !text) continue;
      out.push({ role: "assistant", text: m.content });
    }
  }
  return out;
}

export type ChatHistoryBootstrap = {
  conversationId: string | null;
  bubbles: ChatBubble[];
};

export async function fetchChatHistoryFromApi(
  userId: string,
  preferredConversationId: string | null
): Promise<ChatHistoryBootstrap> {
  const params = new URLSearchParams({ userId });
  if (preferredConversationId) params.set("conversationId", preferredConversationId);
  const res = await fetch(`/api/chat/history?${params}`);
  const data = (await res.json()) as {
    conversationId?: string | null;
    messages?: StoredMessage[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const conversationId =
    typeof data.conversationId === "string" && data.conversationId.length > 0
      ? data.conversationId
      : null;
  const raw = Array.isArray(data.messages) ? data.messages : [];
  return {
    conversationId,
    bubbles: storedMessagesToDisplayBubbles(raw as StoredMessage[]),
  };
}

export async function fetchConversationsListFromApi(
  userId: string
): Promise<ConversationSummary[]> {
  const params = new URLSearchParams({ userId });
  const res = await fetch(`/api/chat/conversations?${params}`);
  const data = (await res.json()) as {
    conversations?: ConversationSummary[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return Array.isArray(data.conversations) ? data.conversations : [];
}
