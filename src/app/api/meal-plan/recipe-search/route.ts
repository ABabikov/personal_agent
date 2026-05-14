import { NextResponse } from "next/server";
import { normalizeSourceHost, normalizeUrlKey } from "@/lib/features/meal-plan/recipeDiscoveryStorage";
import { simplifyTavilyResults, tavilySearchJson } from "@/lib/features/meal-plan/tavilyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DOMAINS = 12;
const MAX_EXCLUDE = 80;

function buildQuery(parts: {
  focus: string;
  notes: string;
  novelty: number;
}): string {
  const bits: string[] = ["простой рецепт", "пошагово", "русский язык"];
  if (parts.focus.trim()) bits.unshift(parts.focus.trim());
  if (parts.notes.trim()) bits.push(`пожелания: ${parts.notes.trim().slice(0, 600)}`);
  if (parts.novelty >= 0.35) {
    const salt = Math.floor(Math.random() * 1_000_000);
    bits.push(`вариант ${salt}`);
  }
  return bits.join(". ").slice(0, 380);
}

export async function POST(req: Request) {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Поиск рецептов не настроен: задайте TAVILY_API_KEY на сервере (тот же ключ, что для web_search в агенте).",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Пустое тело" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;

  const domainsRaw = Array.isArray(o.domains) ? o.domains : [];
  const domains: string[] = [];
  for (const d of domainsRaw) {
    if (typeof d !== "string") continue;
    const h = normalizeSourceHost(d);
    if (h && !domains.includes(h)) domains.push(h);
    if (domains.length >= MAX_DOMAINS) break;
  }
  if (domains.length < 1) {
    return NextResponse.json(
      { ok: false, error: "Передайте domains: непустой массив hostname включённых источников." },
      { status: 400 }
    );
  }

  const excludeRaw = Array.isArray(o.excludeUrlKeys) ? o.excludeUrlKeys : [];
  const exclude = new Set<string>();
  for (const x of excludeRaw) {
    if (typeof x !== "string") continue;
    const k = x.trim().toLowerCase();
    if (k.length > 0 && k.length < 2000) exclude.add(k);
    if (exclude.size >= MAX_EXCLUDE) break;
  }

  const focus = typeof o.focusQuery === "string" ? o.focusQuery.slice(0, 200) : "";
  const notes = typeof o.preferencesNotes === "string" ? o.preferencesNotes.slice(0, 2000) : "";
  const novelty =
    typeof o.novelty === "number" && Number.isFinite(o.novelty) ? Math.min(1, Math.max(0, o.novelty)) : 0.4;

  const query = buildQuery({ focus, notes, novelty });

  const { ok, status, json } = await tavilySearchJson({
    api_key: apiKey,
    query,
    max_results: 8,
    search_depth: "basic",
    include_answer: false,
    include_domains: domains,
  });

  if (!ok) {
    const detail =
      typeof json.detail === "string"
        ? json.detail
        : typeof json.message === "string"
          ? json.message
          : `HTTP ${status}`;
    return NextResponse.json({ ok: false, error: `Tavily: ${detail}` }, { status: 502 });
  }

  const simplified = simplifyTavilyResults(json);
  const filtered = simplified.filter((r) => {
    if (!r.url) return false;
    try {
      const u = new URL(r.url);
      if (!domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) {
        return false;
      }
    } catch {
      return false;
    }
    const key = normalizeUrlKey(r.url);
    if (exclude.has(key)) return false;
    return true;
  });

  return NextResponse.json({
    ok: true,
    data: {
      queryUsed: query,
      domains,
      count: filtered.length,
      results: filtered,
    },
  });
}
