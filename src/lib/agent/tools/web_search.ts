/**
 * Поиск в интернете для актуальной информации (исследования, нормы, события).
 * Требует TAVILY_API_KEY в окружении сервера.
 */

import type { AgentTool } from "@/lib/agent/tools/types";

const TAVILY_URL = "https://api.tavily.com/search";

export const webSearchTool: AgentTool = {
  name: "web_search",
  description: [
    "Поиск актуальной информации в интернете (краткие выдержки из страниц).",
    "Используй для вопросов, где важны свежие данные вне приложения: медицинские рекомендации общего характера,",
    "новости, методики тренировок из открытых источников, нормативы. НЕ подставляй результаты поиска вместо",
    "данных из БД приложения — для своих тренировок и профиля всегда вызывай соответствующие тулы.",
    "Запрос формулируй коротко и по-русски или по-английски — как лучше для темы.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Поисковый запрос (1–400 символов)",
      },
      max_results: {
        type: "integer",
        minimum: 1,
        maximum: 8,
        description: "Сколько результатов вернуть (по умолчанию 5)",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "Веб-поиск не настроен: задайте TAVILY_API_KEY на сервере (https://tavily.com).",
      };
    }

    const query = String(args.query ?? "").trim();
    if (!query || query.length > 400) {
      return { ok: false, error: "Укажи query длиной 1–400 символов." };
    }

    const maxResults =
      typeof args.max_results === "number"
        ? Math.min(8, Math.max(1, Math.floor(args.max_results)))
        : 5;

    try {
      const res = await fetch(TAVILY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: false,
        }),
      });

      const raw = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const detail =
          typeof raw.detail === "string"
            ? raw.detail
            : typeof raw.message === "string"
              ? raw.message
              : res.statusText;
        return { ok: false, error: `Tavily HTTP ${res.status}: ${detail}` };
      }

      const results = Array.isArray(raw.results) ? raw.results : [];
      const simplified = results.map((r: Record<string, unknown>, i: number) => ({
        rank: i + 1,
        title: typeof r.title === "string" ? r.title : "",
        url: typeof r.url === "string" ? r.url : "",
        snippet:
          typeof r.content === "string"
            ? r.content.slice(0, 900)
            : typeof r.snippet === "string"
              ? r.snippet.slice(0, 900)
              : "",
      }));

      return {
        ok: true,
        data: {
          query,
          count: simplified.length,
          results: simplified,
          hint: "Перескажи пользователю своими словами и при необходимости дай ссылки из поля url.",
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
