/**
 * Embeddings: по умолчанию OpenRouter (1536d под pgvector).
 * Чат может идти через Qwen — см. getEmbeddingEndpoint().
 */

import {
  RETRYABLE_STATUSES,
  buildEmbeddingChain,
  getEmbeddingEndpoint,
  EMBEDDING_DIMENSIONS,
  DEFAULT_HTTP_TIMEOUT_MS,
} from "@/lib/agent/llm/models";

export async function embedText(
  text: string,
  primary?: string | null
): Promise<{ embedding: number[]; modelUsed: string } | null> {
  if (!text || !text.trim()) return null;

  let endpoint: { baseUrl: string; apiKey: string };
  try {
    endpoint = getEmbeddingEndpoint();
  } catch (e) {
    console.warn(
      `[agent.emb] no embedding endpoint: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }

  const chain = buildEmbeddingChain(primary ?? null);
  let lastError: string | null = null;

  for (const model of chain) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS);

      const body: Record<string, unknown> = {
        model,
        input: text,
      };
      // 3-large / 3-small поддерживают параметр dimensions.
      if (model.includes("text-embedding-3")) {
        body.dimensions = EMBEDDING_DIMENSIONS;
      }

      const r = await fetch(`${endpoint.baseUrl}/embeddings`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${endpoint.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      clearTimeout(timer);

      if (RETRYABLE_STATUSES.has(r.status)) {
        const errText = await safeText(r);
        console.warn(`[agent.emb] ${model} → HTTP ${r.status}: ${errText.slice(0, 200)}`);
        lastError = `${model} → HTTP ${r.status}`;
        continue;
      }
      if (!r.ok) {
        const errText = await safeText(r);
        console.warn(`[agent.emb] ${model} → HTTP ${r.status}: ${errText.slice(0, 200)}`);
        lastError = `${model} → HTTP ${r.status}`;
        continue;
      }

      const data = await r.json();
      const vec: unknown = data?.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) {
        console.warn(`[agent.emb] ${model} → empty embedding`);
        lastError = `${model} → empty embedding`;
        continue;
      }
      if (vec.length !== EMBEDDING_DIMENSIONS) {
        console.warn(
          `[agent.emb] ${model} returned ${vec.length} dims, expected ${EMBEDDING_DIMENSIONS}`
        );
      }
      return { embedding: vec as number[], modelUsed: model };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[agent.emb] ${model} threw ${msg}`);
      lastError = `${model} → ${msg}`;
      continue;
    }
  }

  console.error(`[agent.emb] all embedding models failed: ${lastError}`);
  return null;
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}
