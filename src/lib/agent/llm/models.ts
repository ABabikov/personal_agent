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

/**
 * Цепочка фоллбеков: только стабильные id с OpenRouter (без «:free» — такие модели часто снимают).
 * Переопределение: OPENROUTER_LLM_FALLBACKS=m1,m2,m3
 */
function parseFallbacksFromEnv(): string[] | null {
  const raw = process.env.OPENROUTER_LLM_FALLBACKS?.trim();
  if (!raw) return null;
  const list = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

const DEFAULT_LLM_FALLBACKS: string[] = [
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-001",
  "deepseek/deepseek-chat",
];

export const LLM_FALLBACKS: string[] =
  parseFallbacksFromEnv() ?? DEFAULT_LLM_FALLBACKS;

/** Потолок completion-токенов на один запрос (меньше — меньше списание при малом балансе OpenRouter). */
const DEFAULT_MAX_COMPLETION_TOKENS = 1024;

export function getAgentMaxCompletionTokens(): number {
  const raw = process.env.OPENROUTER_MAX_COMPLETION_TOKENS?.trim();
  if (!raw) return DEFAULT_MAX_COMPLETION_TOKENS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_COMPLETION_TOKENS;
  return Math.min(8192, Math.max(64, n));
}

export const PRIMARY_EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-large";

export const EMBEDDING_FALLBACKS: string[] = ["openai/text-embedding-3-small"];

export const EMBEDDING_DIMENSIONS = 1536;

/** HTTP-статусы, при которых уходим на следующую модель и НЕ падаем. */
export const RETRYABLE_STATUSES = new Set([402, 404, 429, 503]);

/** Потолок max_tokens на запрос (учитывает OPENROUTER_MAX_COMPLETION_TOKENS и суффикс :free). */
export function pickMaxTokens(model: string, requested: number): number {
  const budget = getAgentMaxCompletionTokens();
  let cap = Math.min(requested, budget);
  if (/:free\b/i.test(model)) {
    cap = Math.min(cap, 512);
  }
  return Math.max(64, cap);
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
