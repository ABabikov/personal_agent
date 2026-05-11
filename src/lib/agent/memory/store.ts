/**
 * Сохранение и чтение истории чата в Supabase (`chat_messages`).
 * Embedding пишется только для текстовых сообщений (user/assistant).
 */

import { supabase } from "@/lib/db/supabase";
import { embedText } from "@/lib/agent/llm/embeddings";
import type { ChatMessageForApi } from "@/lib/agent/llm/openrouter";
import type { ChatRole, ToolCallDescriptor } from "@/types/database";

export type StoredMessage = {
  id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  tool_calls: ToolCallDescriptor[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  created_at: string;
};

export async function saveUserMessage(params: {
  userId: string;
  conversationId: string;
  content: string;
}): Promise<{ id: string; embedding: number[] | null } | null> {
  const emb = await embedText(params.content);
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      role: "user",
      content: params.content,
      tool_calls: null,
      tool_call_id: null,
      tool_name: null,
      embedding: emb?.embedding ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[agent.memory] saveUserMessage failed:", error?.message);
    return null;
  }
  return { id: data.id, embedding: emb?.embedding ?? null };
}

export async function saveAssistantMessage(params: {
  userId: string;
  conversationId: string;
  content: string;
  toolCalls?: ToolCallDescriptor[] | null;
}): Promise<{ id: string } | null> {
  // Embedding только если есть содержательный текст (а не голый tool_calls).
  const emb = params.content.trim().length > 0 ? await embedText(params.content) : null;
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      role: "assistant",
      content: params.content,
      tool_calls: params.toolCalls ?? null,
      tool_call_id: null,
      tool_name: null,
      embedding: emb?.embedding ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[agent.memory] saveAssistantMessage failed:", error?.message);
    return null;
  }
  return { id: data.id };
}

export async function saveToolMessage(params: {
  userId: string;
  conversationId: string;
  toolCallId: string;
  toolName: string;
  content: string;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      role: "tool",
      content: params.content,
      tool_calls: null,
      tool_call_id: params.toolCallId,
      tool_name: params.toolName,
      embedding: null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[agent.memory] saveToolMessage failed:", error?.message);
    return null;
  }
  return { id: data.id };
}

/** Полная история одного разговора (по conversation_id) в хронологическом порядке. */
export async function loadConversation(
  userId: string,
  conversationId: string
): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, conversation_id, role, content, tool_calls, tool_call_id, tool_name, created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[agent.memory] loadConversation failed:", error.message);
    return [];
  }
  return (data ?? []) as StoredMessage[];
}

export function toApiMessages(stored: StoredMessage[]): ChatMessageForApi[] {
  return stored.map((m) => {
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content,
        ...(m.tool_calls && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
      };
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.tool_call_id ?? "",
        name: m.tool_name ?? undefined,
      };
    }
    return { role: m.role, content: m.content };
  });
}
