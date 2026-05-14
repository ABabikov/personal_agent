const TAVILY_URL = "https://api.tavily.com/search";

export type TavilySearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export async function tavilySearchJson(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export function simplifyTavilyResults(raw: Record<string, unknown>): TavilySearchResult[] {
  const results = Array.isArray(raw.results) ? raw.results : [];
  return results.map((r: Record<string, unknown>) => ({
    title: typeof r.title === "string" ? r.title : "",
    url: typeof r.url === "string" ? r.url : "",
    snippet:
      typeof r.content === "string"
        ? r.content.slice(0, 900)
        : typeof r.snippet === "string"
          ? r.snippet.slice(0, 900)
          : "",
  }));
}
