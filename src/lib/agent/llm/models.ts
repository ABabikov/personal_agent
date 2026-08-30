/**
 * Конфиг LLM/embedding-моделей и цепочки фоллбеков.
 * Провайдер: OpenRouter или Qwen (DashScope OpenAI-compatible).
 */

export type LlmProvider = "openrouter" | "dashscope";

/** Явно: LLM_PROVIDER=qwen|dashscope|openrouter; иначе авто по ключу/URL. */
export function getLlmProvider(): LlmProvider {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "qwen" || explicit === "dashscope") return "dashscope";
  if (explicit === "openrouter") return "openrouter";

  if (process.env.DASHSCOPE_API_KEY?.trim() || process.env.QWEN_API_KEY?.trim()) {
    return "dashscope";
  }
  const base =
    process.env.LLM_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim() || "";
  if (/dashscope|aliyuncs|qwen/i.test(base)) return "dashscope";
  return "openrouter";
}

const DASHSCOPE_INTL_BASE =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";

/** Base URL без завершающего слэша (…/v1). */
export function getLlmBaseUrl(): string {
  const override =
    process.env.LLM_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return getLlmProvider() === "dashscope"
    ? DASHSCOPE_INTL_BASE
    : OPENROUTER_DEFAULT_BASE;
}

/** @deprecated используй getLlmBaseUrl() — оставлен для старых импортов. */
export const OPENROUTER_BASE_URL = getLlmBaseUrl();

export function getApiKey(): string {
  const provider = getLlmProvider();
  if (provider === "dashscope") {
    const key =
      process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "QWEN_API_KEY (или DASHSCOPE_API_KEY) is not set — нужен ключ Qwen/DashScope"
      );
    }
    return key;
  }
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return key;
}

export function hasLlmApiKey(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

function defaultPrimaryLlm(): string {
  return getLlmProvider() === "dashscope"
    ? "qwen-plus"
    : "anthropic/claude-sonnet-4";
}

function defaultLlmFallbacks(): string[] {
  return getLlmProvider() === "dashscope"
    ? ["qwen-turbo", "qwen-max"]
    : ["openai/gpt-4o-mini", "google/gemini-2.0-flash-001", "deepseek/deepseek-chat"];
}

function defaultEmbeddingModel(): string {
  // pgvector в проекте = 1536. У Qwen доступен text-embedding-v3 (≤1024) —
  // для совместимости эмбеддинги по умолчанию остаются на OpenRouter.
  return "openai/text-embedding-3-large";
}

/**
 * Эндпоинт для embeddings. При чате через Qwen память всё равно идёт через OpenRouter
 * (нужны 1536 dims под существующий pgvector), если есть OPENROUTER_API_KEY.
 */
export function getEmbeddingEndpoint(): { baseUrl: string; apiKey: string } {
  const force = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

  const useOpenRouter =
    force === "openrouter" ||
    (force !== "dashscope" &&
      getLlmProvider() === "dashscope" &&
      Boolean(openrouterKey));

  if (useOpenRouter) {
    if (!openrouterKey) {
      throw new Error(
        "OPENROUTER_API_KEY нужен для embeddings (1536d). Либо задай ключ, либо EMBEDDING_PROVIDER=dashscope"
      );
    }
    return { baseUrl: OPENROUTER_DEFAULT_BASE, apiKey: openrouterKey };
  }

  return { baseUrl: getLlmBaseUrl(), apiKey: getApiKey() };
}

export const EMBEDDING_FALLBACKS: string[] = [
  "openai/text-embedding-3-small",
];

/** Primary LLM-модель для агента. */
export const PRIMARY_LLM_MODEL =
  process.env.OPENROUTER_LLM_MODEL?.trim() || defaultPrimaryLlm();

/**
 * Цепочка фоллбеков.
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

export const LLM_FALLBACKS: string[] =
  parseFallbacksFromEnv() ?? defaultLlmFallbacks();

/**
 * Потолок completion-токенов на один запрос. 4096 — чтобы развёрнутый тренерский разбор не
 * обрезался по finish_reason="length".
 * При малом балансе можно уменьшить через OPENROUTER_MAX_COMPLETION_TOKENS.
 */
const DEFAULT_MAX_COMPLETION_TOKENS = 4096;

export function getAgentMaxCompletionTokens(): number {
  const raw = process.env.OPENROUTER_MAX_COMPLETION_TOKENS?.trim();
  if (!raw) return DEFAULT_MAX_COMPLETION_TOKENS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_COMPLETION_TOKENS;
  return Math.min(8192, Math.max(64, n));
}

const DEFAULT_AGENT_TEMPERATURE = 0.4;

export function getAgentTemperature(): number {
  const raw = process.env.OPENROUTER_TEMPERATURE?.trim();
  if (!raw) return DEFAULT_AGENT_TEMPERATURE;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULT_AGENT_TEMPERATURE;
  return Math.min(2, Math.max(0, n));
}

export const PRIMARY_EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || defaultEmbeddingModel();

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
