/**
 * Прямой клиент OpenRouter с цепочкой фоллбеков по моделям.
 * Логика повторяет PD_Questions: на retryable-статусах/любой ошибке/невалидном ответе
 * идём к следующей модели; падаем только если упали все.
 */

import {
  RETRYABLE_STATUSES,
  buildLlmChain,
  getApiKey,
  getLlmBaseUrl,
  getAgentMaxCompletionTokens,
  llmProvidersToTry,
  pickMaxTokens,
  DEFAULT_HTTP_TIMEOUT_MS,
  type LlmProvider,
} from "@/lib/agent/llm/models";
import type { ToolCallDescriptor } from "@/types/database";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessageForApi {
  role: ChatRole;
  content: string | null;
  /** Для assistant — массив tool_calls (если модель решила позвать инструмент) */
  tool_calls?: ToolCallDescriptor[];
  /** Для tool — id вызова из assistant.tool_calls */
  tool_call_id?: string;
  /** Для tool — имя функции */
  name?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionInput {
  messages: ChatMessageForApi[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  maxTokens?: number;
  /** Если задан — пробуем эту модель первой (поверх PRIMARY_LLM_MODEL). */
  model?: string | null;
}

export interface ChatCompletionResult {
  /** Текст финального ответа модели (null, если ассистент только позвал tools). */
  content: string | null;
  toolCalls: ToolCallDescriptor[];
  modelUsed: string;
  /** Trace всех попыток для отладки. */
  attempts: { model: string; status: number | null; error?: string }[];
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** Универсальный логгер для server-side — печатает в stdout Vercel/Next.js. */
function log(level: "info" | "warn" | "error", message: string, meta?: unknown) {
  const line = meta ? `[agent.llm] ${message} ${JSON.stringify(meta)}` : `[agent.llm] ${message}`;
  if (level === "warn") console.warn(line);
  else if (level === "error") console.error(line);
  else console.log(line);
}

/** Не ужимаем ниже этого порога — иначе ответ бессмысленно короткий, лучше сменить модель. */
const MIN_AFFORDABLE_TOKENS = 256;

/**
 * OpenRouter резервирует кредиты по `max_tokens` заранее и при нехватке отвечает 402
 * с текстом "...can only afford 1304". Вытаскиваем это число, чтобы повторить запрос под бюджет.
 */
function parseAffordableTokens(errText: string): number | null {
  const m = /can only afford (\d+)/i.exec(errText);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Модели с исчерпанной бесплатной квотой не дёргаем снова в этом процессе. */
const quotaExhaustedUntil = new Map<string, number>();
const QUOTA_SKIP_MS = 10 * 60 * 1000;

function isFreeQuotaExhausted(text: string): boolean {
  return /FreeTierOnly|free quota/i.test(text);
}

function skipModelForQuota(model: string): void {
  quotaExhaustedUntil.set(model, Date.now() + QUOTA_SKIP_MS);
}

function isQuotaSkipped(model: string): boolean {
  return (quotaExhaustedUntil.get(model) ?? 0) > Date.now();
}

function shortProviderError(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 220);
  } catch {
    // не JSON — отдаём ужатый сырой текст
  }
  return compact.slice(0, 220);
}

function failureSummary(attempts: ChatCompletionResult["attempts"]): string {
  const lines = attempts
    .filter((attempt) => attempt.error)
    .map((attempt) => {
      const status = attempt.status == null ? "ошибка" : `HTTP ${attempt.status}`;
      return `${attempt.model} → ${status}: ${shortProviderError(attempt.error ?? "")}`;
    });
  const blob = attempts.map((attempt) => attempt.error ?? "").join("\n");
  const hint = /FreeTierOnly|free quota/i.test(blob)
    ? " Бесплатная квота Qwen кончилась. В Model Studio отключи «use free tier only» или добавь оплату."
    : "";
  return `Все LLM-модели упали.${hint} ${lines.join(" | ") || "unknown"}`;
}

export async function chatCompletion(
  input: ChatCompletionInput
): Promise<ChatCompletionResult> {
  const temperature = input.temperature ?? 0.3;
  const maxTokens = input.maxTokens ?? getAgentMaxCompletionTokens();
  const providers = llmProvidersToTry();

  const attempts: ChatCompletionResult["attempts"] = [];

  for (const provider of providers) {
    const apiKey = getApiKey(provider);
    const baseUrl = getLlmBaseUrl(provider);
    const chain =
      provider === providers[0]
        ? buildLlmChain(input.model ?? null, provider)
        : buildLlmChain(null, provider);
    if (provider !== providers[0]) {
      log("warn", `provider ${providers[0]} исчерпан — пробую ${provider}`, { chain });
    }

    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      if (isQuotaSkipped(model)) {
        log("warn", `model ${model} пропущена: бесплатная квота уже кончилась в этом процессе`);
        attempts.push({
          model,
          status: 403,
          error: "бесплатная квота кончилась, модель пропущена",
        });
        continue;
      }
      const outcome = await attemptModel({
        provider,
        model,
        index: i,
        chainLength: chain.length,
        apiKey,
        baseUrl,
        input,
        temperature,
        maxTokens,
        attempts,
      });
      if (outcome) return outcome;
    }
  }

  throw new Error(failureSummary(attempts));
}

async function attemptModel(args: {
  provider: LlmProvider;
  model: string;
  index: number;
  chainLength: number;
  apiKey: string;
  baseUrl: string;
  input: ChatCompletionInput;
  temperature: number;
  maxTokens: number;
  attempts: ChatCompletionResult["attempts"];
}): Promise<ChatCompletionResult | null> {
  const { model, input, temperature, attempts } = args;
  let effectiveMaxTokens = pickMaxTokens(model, args.maxTokens);
  let reducedForAfford = false;

  // Внутренний повтор: при 402 «can only afford N» ужимаем max_tokens под бюджет
  // и пробуем ТУ ЖЕ модель ещё раз, прежде чем уходить на фоллбек.
  for (let localTry = 0; localTry < 2; localTry++) {
    log(
      "info",
      `chat trying ${args.provider}/${model} (${args.index + 1}/${args.chainLength})` +
        (localTry > 0 ? ` [retry @ ${effectiveMaxTokens} tok]` : "")
    );

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS);

      const body: Record<string, unknown> = {
        model,
        temperature,
        max_tokens: effectiveMaxTokens,
        messages: input.messages.map(toApiMessage),
      };
      if (input.tools && input.tools.length > 0) {
        body.tools = input.tools;
        body.tool_choice = input.toolChoice ?? "auto";
      }

      const response = await fetch(`${args.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://personal-agent.local",
          "X-Title": "Personal Agent (Jarvis)",
        },
        body: JSON.stringify(body),
      });

      clearTimeout(timer);

      if (response.status === 402 && !reducedForAfford) {
        const errText = await safeText(response);
        const afford = parseAffordableTokens(errText);
        if (afford != null && afford >= MIN_AFFORDABLE_TOKENS && afford < effectiveMaxTokens) {
          reducedForAfford = true;
          effectiveMaxTokens = afford;
          log("warn", `model ${model} 402 — повтор с max_tokens=${effectiveMaxTokens} (под бюджет)`);
          continue;
        }
        log("warn", `model ${model} 402 — бюджета не хватает даже на минимум, следующая модель`, {
          errText,
        });
        attempts.push({ model, status: 402, error: errText.slice(0, 300) });
        return null;
      }

      if (RETRYABLE_STATUSES.has(response.status) || !response.ok) {
        const errText = await safeText(response);
        if (isFreeQuotaExhausted(errText)) skipModelForQuota(model);
        log("warn", `model ${model} returned ${response.status} — trying next`, { errText });
        attempts.push({ model, status: response.status, error: errText.slice(0, 300) });
        return null;
      }

      const data = await response.json();
      const choices = data?.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        log("warn", `model ${model} returned no choices`);
        attempts.push({ model, status: response.status, error: "no choices" });
        return null;
      }
      const msg = choices[0].message ?? {};
      const content: string | null = typeof msg.content === "string" ? msg.content : null;
      const toolCalls: ToolCallDescriptor[] = Array.isArray(msg.tool_calls)
        ? msg.tool_calls.map((tc: ToolCallDescriptor) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }))
        : [];

      const finishReason: string | undefined = choices[0].finish_reason;
      const usage = data?.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined;

      if (content == null && toolCalls.length === 0) {
        log("warn", `model ${model} returned empty content+tool_calls`);
        attempts.push({ model, status: response.status, error: "empty response" });
        return null;
      }

      attempts.push({ model, status: response.status });
      log("info", `chat success with ${model}`, {
        contentLen: content?.length ?? 0,
        toolCalls: toolCalls.length,
        finishReason,
        maxTokens: effectiveMaxTokens,
      });
      return {
        content,
        toolCalls,
        modelUsed: model,
        attempts,
        finishReason,
        usage,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("warn", `model ${model} threw ${msg}`);
      attempts.push({ model, status: null, error: msg });
      return null;
    }
  }

  return null;
}

function toApiMessage(m: ChatMessageForApi): Record<string, unknown> {
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content ?? "",
      ...(m.tool_calls && m.tool_calls.length > 0
        ? { tool_calls: m.tool_calls }
        : {}),
    };
  }
  if (m.role === "tool") {
    return {
      role: "tool",
      content: m.content ?? "",
      tool_call_id: m.tool_call_id ?? "",
      name: m.name,
    };
  }
  return { role: m.role, content: m.content ?? "" };
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}
