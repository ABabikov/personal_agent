/**
 * Поиск в интернете для актуальной информации (исследования, нормы, события).
 * Требует TAVILY_API_KEY в окружении сервера.
 */

import type { AgentTool } from "@/lib/agent/tools/types";

const TAVILY_URL = "https://api.tavily.com/search";

export const webSearchTool: AgentTool = {
  name: "web_search",
  description: [
    "Поиск в интернете: техника, состав блюда которого нет в справочнике, общие нормы.",
    "Не заменяет тулы приложения: свои тренировки, профиль, дневник и траты отсюда не бери.",
    "КБЖУ из сниппета — оценка, в дневник не пиши, пока человек не подтвердил цифры.",
    "Запрос короткий, по-русски или по-английски — как лучше ищется тема.",
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
          search_depth: "advanced",
          include_answer: true,
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

      const answer = typeof raw.answer === "string" ? raw.answer.slice(0, 1200) : "";
      return {
        ok: true,
        data: {
          query,
          answer: answer || null,
          count: simplified.length,
          results: simplified,
          hint: "answer — черновая выжимка поиска, проверь её по results. Перескажи своими словами и дай url.",
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
