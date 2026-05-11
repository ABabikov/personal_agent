/**
 * Конфиг LLM/embedding-моделей и цепочки фоллбеков для OpenRouter.
 * Идейно повторяет систему фоллбеков из PD_Questions (services/estimator/app/extraction/llm_client.py).
 */

export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

export function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return key;
}

/** Primary LLM-модель для агента (Sonnet — лучше для tool-calling и сложных диалогов). */
export const PRIMARY_LLM_MODEL =
  process.env.OPENROUTER_LLM_MODEL?.trim() || "anthropic/claude-sonnet-4";

/** Цепочка фоллбеков: если primary упал — пытаемся по очереди. */
export const LLM_FALLBACKS: string[] = [
  "google/gemini-2.5-flash",
  "deepseek/deepseek-chat-v3-0324:free",
  "meta-llama/llama-4-maverick:free",
];

export const PRIMARY_EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-large";

export const EMBEDDING_FALLBACKS: string[] = ["openai/text-embedding-3-small"];

export const EMBEDDING_DIMENSIONS = 1536;

/** HTTP-статусы, при которых уходим на следующую модель и НЕ падаем. */
export const RETRYABLE_STATUSES = new Set([402, 404, 429, 503]);

/** Жёсткий потолок max_tokens для бюджетных моделей. */
export function pickMaxTokens(_model: string, requested: number): number {
  if (requested > 4096) return 4096;
  return requested;
}

/** Полная цепочка моделей (primary + фоллбеки без дублей) */
export function buildLlmChain(primary?: string | null): string[] {
  const p = primary?.trim() || PRIMARY_LLM_MODEL;
  return [p, ...LLM_FALLBACKS.filter((m) => m !== p)];
}

export function buildEmbeddingChain(primary?: string | null): string[] {
  const p = primary?.trim() || PRIMARY_EMBEDDING_MODEL;
  return [p, ...EMBEDDING_FALLBACKS.filter((m) => m !== p)];
}

export const DEFAULT_HTTP_TIMEOUT_MS = 180_000;
