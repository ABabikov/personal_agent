/**
 * Health-check LLM-обвязки агента (Фаза 0 рефакторинга, см. docs/features/agent-core/refactor-plan.md).
 *
 * Проверяет три вещи, из-за которых чат «тупит» (audit.md #2, #3):
 *   1) баланс/лимит ключа OpenRouter (не упёрлись ли в 402);
 *   2) реально ли отвечает ОСНОВНАЯ модель (а не молчаливый фоллбек);
 *   3) живы ли эмбеддинги (без них у агента нет долговременной памяти).
 *
 * Запуск:
 *   npm run diagnose:llm
 *
 * .env: OPENROUTER_API_KEY (обязателен). Опционально OPENROUTER_LLM_MODEL / *_EMBEDDING_MODEL.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFromDotenv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf-8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFromDotenv();

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const ok = (s: string) => `${GREEN}✓${RESET} ${s}`;
const bad = (s: string) => `${RED}✗${RESET} ${s}`;
const warn = (s: string) => `${YELLOW}!${RESET} ${s}`;

async function main(): Promise<number> {
  // Импортируем после загрузки .env (consts PRIMARY_* читают process.env при загрузке модуля).
  const {
    PRIMARY_LLM_MODEL,
    PRIMARY_EMBEDDING_MODEL,
    OPENROUTER_BASE_URL,
    getAgentMaxCompletionTokens,
    getAgentTemperature,
  } = await import("../src/lib/agent/llm/models");
  const { chatCompletion } = await import("../src/lib/agent/llm/openrouter");
  const { embedText } = await import("../src/lib/agent/llm/embeddings");

  let problems = 0;

  console.log(`\n${DIM}=== Конфигурация ===${RESET}`);
  console.log(`  Основная модель:    ${PRIMARY_LLM_MODEL}`);
  console.log(`  Модель эмбеддингов: ${PRIMARY_EMBEDDING_MODEL}`);
  console.log(`  max_tokens:         ${getAgentMaxCompletionTokens()}`);
  console.log(`  temperature:        ${getAgentTemperature()}`);

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.log(`\n${bad("OPENROUTER_API_KEY не задан в .env — агент работать не будет.")}`);
    return 1;
  }

  // 1) Баланс ключа.
  console.log(`\n${DIM}=== 1. Баланс OpenRouter ===${RESET}`);
  try {
    const r = await fetch(`${OPENROUTER_BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      console.log(bad(`GET /key → HTTP ${r.status}. Ключ невалиден или нет доступа.`));
      problems++;
    } else {
      const j = (await r.json()) as {
        data?: {
          label?: string;
          usage?: number;
          limit?: number | null;
          limit_remaining?: number | null;
          is_free_tier?: boolean;
        };
      };
      const d = j.data ?? {};
      const limit = d.limit == null ? "без лимита" : `$${d.limit}`;
      const remaining = d.limit_remaining == null ? "—" : `$${d.limit_remaining}`;
      console.log(ok(`Ключ валиден${d.label ? ` (${d.label})` : ""}.`));
      console.log(`  Потрачено: $${d.usage ?? 0} · Лимит: ${limit} · Остаток: ${remaining}`);
      if (d.is_free_tier) console.log(warn("Ключ на free-tier — основные платные модели могут давать 402."));
      if (d.limit_remaining != null && d.limit_remaining <= 0) {
        console.log(bad("Остаток ≤ 0 — это и есть причина молчаливого даунгрейда на дешёвые модели."));
        problems++;
      }
    }
  } catch (e) {
    console.log(bad(`Не удалось запросить /key: ${e instanceof Error ? e.message : String(e)}`));
    problems++;
  }

  // 2) Реально отвечает основная модель?
  console.log(`\n${DIM}=== 2. Чат: какая модель отвечает ===${RESET}`);
  try {
    const res = await chatCompletion({
      messages: [
        { role: "system", content: "Ты — тестовый пинг. Ответь одним словом." },
        { role: "user", content: "Скажи 'понг'." },
      ],
      temperature: 0,
      maxTokens: 16,
    });
    if (res.modelUsed === PRIMARY_LLM_MODEL) {
      console.log(ok(`Ответила основная модель: ${res.modelUsed}`));
    } else {
      console.log(bad(`Ответила РЕЗЕРВНАЯ модель: ${res.modelUsed} (основная ${PRIMARY_LLM_MODEL} недоступна).`));
      problems++;
    }
    if (res.attempts.length > 1) {
      console.log(`  Попытки до успеха:`);
      for (const a of res.attempts) {
        const tag = a.error ? `${RED}${a.status ?? "throw"}${RESET}` : `${GREEN}ok${RESET}`;
        console.log(`    - ${a.model}: ${tag}${a.error ? ` ${DIM}${a.error.slice(0, 120)}${RESET}` : ""}`);
      }
    }
    console.log(`  ${DIM}finish_reason=${res.finishReason ?? "—"}, content="${(res.content ?? "").trim().slice(0, 40)}"${RESET}`);
  } catch (e) {
    console.log(bad(`Чат не ответил ни одной моделью: ${e instanceof Error ? e.message : String(e)}`));
    problems++;
  }

  // 3) Эмбеддинги (память).
  console.log(`\n${DIM}=== 3. Эмбеддинги (долговременная память) ===${RESET}`);
  try {
    const emb = await embedText("проверка эмбеддингов агента");
    if (!emb) {
      console.log(bad("embedText вернул null — память НЕ работает (recall будет пустым)."));
      problems++;
    } else {
      console.log(ok(`Эмбеддинги работают: модель ${emb.modelUsed}, размерность ${emb.embedding.length}.`));
    }
  } catch (e) {
    console.log(bad(`Эмбеддинги упали: ${e instanceof Error ? e.message : String(e)}`));
    problems++;
  }

  console.log("");
  if (problems === 0) {
    console.log(ok("Всё в порядке: основная модель отвечает, баланс есть, память жива.\n"));
    return 0;
  }
  console.log(bad(`Найдено проблем: ${problems}. См. сообщения выше.\n`));
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
