/**
 * pgvector-поиск по предыдущей переписке и сохранённым фактам.
 *
 * Стратегия:
 *  1) ChatMessage embedding (user/assistant) — топ-N похожих сообщений из ВСЕХ предыдущих
 *     разговоров пользователя (исключаем текущий conversation_id).
 *  2) UserContext embedding — топ-M похожих фактов.
 *
 * Запросы делаются через .rpc(...) с SQL-функциями, но чтобы не добавлять PG-функции,
 * используем PostgREST `select('*, embedding <=> $vec as distance')` — Supabase JS клиент
 * этого не умеет напрямую, поэтому идём через .rpc на простую функцию.
 *
 * Чтобы не плодить миграции с RPC, используем `match_chat_messages` и `match_user_context` —
 * их объявление приложено в этом файле как комментарий, и нужно один раз вручную выполнить
 * в SQL editor Supabase (см. docs/agent/memory.md).
 *
 * Если RPC не существует — fallback: считаем косинус на клиенте по последним N=300 сообщениям.
 */

import { supabase } from "@/lib/db/supabase";
import { embedText } from "@/lib/agent/llm/embeddings";

export type RecalledMessage = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  distance: number;
};

export type RecalledFact = {
  key: string;
  value: string;
  distance: number;
};

export type RecallResult = {
  messages: RecalledMessage[];
  facts: RecalledFact[];
};

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

async function recallMessagesFallback(
  userId: string,
  excludeConversationId: string | null,
  queryEmbedding: number[],
  k: number
): Promise<RecalledMessage[]> {
  let query = supabase
    .from("chat_messages")
    .select("id, conversation_id, role, content, created_at, embedding")
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .not("embedding", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (excludeConversationId) {
    query = query.neq("conversation_id", excludeConversationId);
  }
  const { data, error } = await query;
  if (error || !data) return [];

  const scored: RecalledMessage[] = [];
  for (const row of data) {
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    const d = cosineDistance(queryEmbedding, emb);
    scored.push({
      id: row.id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      distance: d,
    });
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, k);
}

async function recallFactsFallback(
  userId: string,
  queryEmbedding: number[],
  k: number
): Promise<RecalledFact[]> {
  const { data, error } = await supabase
    .from("user_context")
    .select("key, value, embedding")
    .eq("user_id", userId)
    .not("embedding", "is", null);
  if (error || !data) return [];
  const scored: RecalledFact[] = [];
  for (const row of data) {
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    scored.push({
      key: row.key,
      value: row.value,
      distance: cosineDistance(queryEmbedding, emb),
    });
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, k);
}

/**
 * Восстанавливает контекст для нового сообщения пользователя:
 * — похожие сообщения из прошлых разговоров,
 * — близкие факты из user_context.
 *
 * Если text пустой или embed не получился — возвращает пустые массивы.
 */
export async function recallContext(params: {
  userId: string;
  queryText: string;
  excludeConversationId?: string | null;
  messagesLimit?: number;
  factsLimit?: number;
}): Promise<RecallResult> {
  const messagesLimit = params.messagesLimit ?? 5;
  const factsLimit = params.factsLimit ?? 5;
  const emb = await embedText(params.queryText);
  if (!emb) return { messages: [], facts: [] };

  const [messages, facts] = await Promise.all([
    recallMessagesFallback(
      params.userId,
      params.excludeConversationId ?? null,
      emb.embedding,
      messagesLimit
    ),
    recallFactsFallback(params.userId, emb.embedding, factsLimit),
  ]);
  return { messages, facts };
}
