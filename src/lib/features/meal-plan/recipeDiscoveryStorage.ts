import {
  DEFAULT_RECIPE_SEARCH_PREFERENCES,
  DEFAULT_RECIPE_SOURCES,
  HISTORY_TAIL_AGENT,
  MAX_HISTORY_ENTRIES,
  MAX_RECIPE_SOURCES,
  STORAGE_RECIPE_HISTORY,
  STORAGE_RECIPE_PREFS,
  STORAGE_RECIPE_SOURCES,
  type RecipeDiscoveryForAgent,
  type RecipeDiscoveryState,
  type RecipeHistoryEntry,
  type RecipeSearchPreferences,
  type RecipeSource,
} from "./recipeDiscoveryTypes";

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Нормализация hostname из ввода пользователя. */
export function normalizeSourceHost(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  s = s.replace(/^www\./, "");
  if (s.length > 200) return null;
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(s)) return null;
  return s;
}

export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "";
    return `${u.hostname.toLowerCase()}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function parseSources(raw: unknown): RecipeSource[] {
  if (!Array.isArray(raw)) return [...DEFAULT_RECIPE_SOURCES];
  const out: RecipeSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim().slice(0, 64) : "";
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 120) : "";
    const hostRaw = typeof o.host === "string" ? o.host : "";
    const host = normalizeSourceHost(hostRaw);
    if (!id || !label || !host) continue;
    out.push({
      id,
      label,
      host,
      enabled: o.enabled === false ? false : true,
    });
  }
  if (out.length < 1) return [...DEFAULT_RECIPE_SOURCES];
  return out.slice(0, MAX_RECIPE_SOURCES);
}

function parsePreferences(raw: unknown): RecipeSearchPreferences {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RECIPE_SEARCH_PREFERENCES };
  const o = raw as Record<string, unknown>;
  const notes = typeof o.notes === "string" ? o.notes.slice(0, 4000) : "";
  const novelty =
    typeof o.novelty === "number" && Number.isFinite(o.novelty)
      ? Math.min(1, Math.max(0, o.novelty))
      : DEFAULT_RECIPE_SEARCH_PREFERENCES.novelty;
  const excludeRecent =
    typeof o.excludeRecent === "number" && Number.isFinite(o.excludeRecent)
      ? Math.min(80, Math.max(0, Math.round(o.excludeRecent)))
      : DEFAULT_RECIPE_SEARCH_PREFERENCES.excludeRecent;
  return { notes, novelty, excludeRecent };
}

function parseHistory(raw: unknown): RecipeHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim().slice(0, 80) : "";
    const url = typeof o.url === "string" ? o.url.trim().slice(0, 2000) : "";
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 500) : "";
    const at = typeof o.at === "string" ? o.at.trim() : "";
    const kind = o.kind === "user_marked" ? "user_marked" : "search_hit";
    if (!id || !url || !at) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    const host = urlHost(url) || (typeof o.host === "string" ? o.host : "");
    out.push({ id, url, title: title || url, host, at, kind });
  }
  return out.slice(-MAX_HISTORY_ENTRIES);
}

export function loadRecipeDiscoveryState(): RecipeDiscoveryState {
  if (typeof window === "undefined") {
    return {
      sources: [...DEFAULT_RECIPE_SOURCES],
      preferences: { ...DEFAULT_RECIPE_SEARCH_PREFERENCES },
      history: [],
    };
  }
  try {
    const sources = parseSources(safeJsonParse(localStorage.getItem(STORAGE_RECIPE_SOURCES), null));
    const preferences = parsePreferences(safeJsonParse(localStorage.getItem(STORAGE_RECIPE_PREFS), null));
    const history = parseHistory(safeJsonParse(localStorage.getItem(STORAGE_RECIPE_HISTORY), null));
    return { sources, preferences, history };
  } catch {
    return {
      sources: [...DEFAULT_RECIPE_SOURCES],
      preferences: { ...DEFAULT_RECIPE_SEARCH_PREFERENCES },
      history: [],
    };
  }
}

export function saveRecipeSources(sources: RecipeSource[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_RECIPE_SOURCES, JSON.stringify(parseSources(sources)));
  } catch {
    /* ignore */
  }
}

export function saveRecipePreferences(preferences: RecipeSearchPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_RECIPE_PREFS, JSON.stringify(parsePreferences(preferences)));
  } catch {
    /* ignore */
  }
}

export function saveRecipeHistory(history: RecipeHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = parseHistory(history);
    localStorage.setItem(STORAGE_RECIPE_HISTORY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

export function toAgentRecipeDiscovery(state: RecipeDiscoveryState): RecipeDiscoveryForAgent {
  const sorted = [...state.history].sort((a, b) => b.at.localeCompare(a.at));
  const tail = sorted.slice(0, HISTORY_TAIL_AGENT);
  return {
    sources: state.sources,
    preferences: state.preferences,
    historyRecent: tail.map((h) => ({
      url: h.url,
      title: h.title,
      at: h.at,
      host: h.host || urlHost(h.url),
    })),
  };
}

export function exclusionUrlKeys(history: RecipeHistoryEntry[], max: number): string[] {
  const sorted = [...history].sort((a, b) => b.at.localeCompare(a.at));
  const keys = new Set<string>();
  for (const h of sorted) {
    if (keys.size >= max) break;
    keys.add(normalizeUrlKey(h.url));
  }
  return [...keys];
}

export function appendRecipeHistoryEntries(
  prev: RecipeHistoryEntry[],
  entries: { url: string; title: string; kind: "search_hit" | "user_marked" }[]
): RecipeHistoryEntry[] {
  const now = new Date().toISOString();
  const next = [...prev];
  for (const e of entries) {
    try {
      new URL(e.url);
    } catch {
      continue;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `h-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
    next.push({
      id,
      url: e.url,
      title: e.title?.trim() || e.url,
      host: urlHost(e.url),
      at: now,
      kind: e.kind,
    });
  }
  return next.slice(-MAX_HISTORY_ENTRIES);
}

function parseHistoryRecent(raw: unknown): RecipeDiscoveryForAgent["historyRecent"] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeDiscoveryForAgent["historyRecent"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim().slice(0, 2000) : "";
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 500) : "";
    const at = typeof o.at === "string" ? o.at.trim() : "";
    if (!url || !at) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    const host = typeof o.host === "string" && o.host.length > 0 ? o.host : urlHost(url);
    out.push({ url, title: title || url, at, host });
  }
  return out.slice(0, HISTORY_TAIL_AGENT);
}

export function defaultAgentDiscovery(): RecipeDiscoveryForAgent {
  return {
    sources: [...DEFAULT_RECIPE_SOURCES],
    preferences: { ...DEFAULT_RECIPE_SEARCH_PREFERENCES },
    historyRecent: [],
  };
}

/** Разбор поля mealPlan.recipeDiscovery из тела чата (сервер). */
export function parseRecipeDiscoveryForAgentPayload(raw: unknown): RecipeDiscoveryForAgent {
  if (!raw || typeof raw !== "object") return defaultAgentDiscovery();
  const o = raw as Record<string, unknown>;
  return {
    sources: o.sources !== undefined ? parseSources(o.sources) : [...DEFAULT_RECIPE_SOURCES],
    preferences:
      o.preferences !== undefined ? parsePreferences(o.preferences) : { ...DEFAULT_RECIPE_SEARCH_PREFERENCES },
    historyRecent: parseHistoryRecent(o.historyRecent),
  };
}

export function mergeAgentDiscoveryPatch(
  base: RecipeDiscoveryForAgent,
  patch: { sources?: unknown; preferences?: unknown }
): RecipeDiscoveryForAgent {
  return {
    historyRecent: base.historyRecent,
    sources: patch.sources !== undefined ? parseSources(patch.sources) : base.sources,
    preferences: patch.preferences !== undefined ? parsePreferences(patch.preferences) : base.preferences,
  };
}

export function resetRecipeSourcesToDefault(): RecipeSource[] {
  const s = [...DEFAULT_RECIPE_SOURCES];
  saveRecipeSources(s);
  return s;
}

export function createRecipeSourceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `src-${crypto.randomUUID()}`;
  }
  return `src-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
