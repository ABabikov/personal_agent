import { AFISHA_LANES, searchPhrase } from "@/lib/features/nearby/defaults";
import type { NearbyCandidate } from "@/lib/features/nearby/types";
import {
  eventFallsInWindow,
  mentionsOnlyPastYears,
  moscowMonthYear,
  type DateRange,
} from "@/lib/features/nearby/window";

const TAVILY_URL = "https://api.tavily.com/search";
const KUDAGO = "https://kudago.com/public-api/v1.4";

const BLOCKED_HOSTS = [
  "wikipedia.org",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "ok.ru",
];

export type CollectInput = {
  cityLabel: string;
  citySlug: string | null;
  today: string;
  until: string;
  interests: { label: string; terms: string[] }[];
};

export type CollectResult = {
  candidates: NearbyCandidate[];
  notes: string[];
  webSearch: boolean;
};

export async function collectNearbyCandidates(input: CollectInput): Promise<CollectResult> {
  const notes: string[] = [];
  const { month, year } = moscowMonthYear(input.today);
  const yearNum = Number(year);
  const webSearch = Boolean(process.env.TAVILY_API_KEY?.trim());
  if (!webSearch) {
    notes.push("Веб-поиск не настроен (нет TAVILY_API_KEY). Спортивные старты вне KudaGo в ленту не попадут.");
  }
  if (!input.citySlug) {
    notes.push("Этого города нет в KudaGo, смотрю только веб.");
  }

  const perInterest = await Promise.all([
    ...AFISHA_LANES.map((lane) =>
      collectQuery(`${lane.phrase} ${input.cityLabel} ${month} ${year}`, lane.label, input, yearNum, webSearch, false)
    ),
    ...input.interests.slice(0, 4).map((interest) =>
      collectInterest(interest, input, yearNum, webSearch)
    ),
  ]);

  const kudagoIds = new Map<number, { interestLabel: string }>();
  const web: NearbyCandidate[] = [];
  for (const part of perInterest) {
    notes.push(...part.notes);
    web.push(...part.web);
    for (const id of part.kudagoIds) {
      if (!kudagoIds.has(id)) kudagoIds.set(id, { interestLabel: part.interestLabel });
    }
  }

  const fromKudago = input.citySlug
    ? await loadKudagoDetails([...kudagoIds.entries()].slice(0, 16), input.today, input.until)
    : [];

  const merged = dedupe([...fromKudago, ...web]).slice(0, 36);
  return { candidates: merged, notes: uniqueNotes(notes), webSearch };
}

async function collectQuery(
  query: string,
  label: string,
  input: CollectInput,
  yearNum: number,
  webSearch: boolean,
  withKudago: boolean
): Promise<{ interestLabel: string; web: NearbyCandidate[]; kudagoIds: number[]; notes: string[] }> {
  const [web, kudagoIds] = await Promise.all([
    webSearch ? searchWeb(query, label, yearNum) : Promise.resolve({ items: [], note: null }),
    withKudago && input.citySlug ? searchKudago(searchPhrase(label), input.citySlug) : Promise.resolve([]),
  ]);
  return {
    interestLabel: label,
    web: web.items,
    kudagoIds,
    notes: web.note ? [web.note] : [],
  };
}

async function collectInterest(
  interest: { label: string; terms: string[] },
  input: CollectInput,
  yearNum: number,
  webSearch: boolean
): Promise<{ interestLabel: string; web: NearbyCandidate[]; kudagoIds: number[]; notes: string[] }> {
  const phrase = searchPhrase(interest.label);
  const { month, year } = moscowMonthYear(input.today);
  return collectQuery(
    `${phrase} ${input.cityLabel} ${month} ${year}`,
    interest.label,
    input,
    yearNum,
    webSearch,
    true
  );
}

async function searchWeb(
  query: string,
  interestLabel: string,
  year: number
): Promise<{ items: NearbyCandidate[]; note: string | null }> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return { items: [], note: null };
  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
      }),
    });
    const raw = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const detail = typeof raw.detail === "string" ? raw.detail : res.statusText;
      return { items: [], note: `Поиск «${interestLabel}» не удался: ${detail}` };
    }
    const results = Array.isArray(raw.results) ? raw.results : [];
    const items: NearbyCandidate[] = [];
    for (const row of results) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const title = cleanText(record.title, 180);
      const url = typeof record.url === "string" ? record.url.trim() : "";
      const snippet = cleanText(record.content ?? record.snippet, 500);
      if (!title || !url || blockedUrl(url)) continue;
      if (mentionsOnlyPastYears(`${title} ${snippet}`, year)) continue;
      items.push({
        key: normalizeUrl(url),
        source: "web",
        title,
        url,
        snippet,
        place: null,
        startsOn: null,
        interestLabel,
      });
    }
    return { items, note: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { items: [], note: `Поиск «${interestLabel}» не удался: ${message}` };
  }
}

async function searchKudago(phrase: string, citySlug: string): Promise<number[]> {
  const url =
    `${KUDAGO}/search/?lang=ru&ctype=event&page_size=4&location=${encodeURIComponent(citySlug)}` +
    `&q=${encodeURIComponent(phrase)}`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return [];
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const ids: number[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "number") ids.push(id);
  }
  return ids;
}

async function loadKudagoDetails(
  entries: [number, { interestLabel: string }][],
  today: string,
  until: string
): Promise<NearbyCandidate[]> {
  const loaded = await Promise.all(
    entries.map(async ([id, meta]): Promise<NearbyCandidate | null> => {
      const json = await fetchJson(
        `${KUDAGO}/events/${id}/?lang=ru&expand=place,dates&fields=id,title,description,dates,place,site_url&text_format=text`
      );
      if (!json || typeof json !== "object") return null;
      const row = json as {
        title?: unknown;
        description?: unknown;
        site_url?: unknown;
        dates?: unknown;
        place?: unknown;
      };
      const title = cleanText(row.title, 180);
      const url = typeof row.site_url === "string" ? row.site_url.trim() : "";
      if (!title || !url) return null;
      const startsOn = eventFallsInWindow(readRanges(row.dates), today, until);
      if (!startsOn) return null;
      return {
        key: normalizeUrl(url),
        source: "kudago",
        title,
        url,
        snippet: cleanText(row.description, 500),
        place: placeLabel(row.place),
        startsOn,
        interestLabel: meta.interestLabel,
      };
    })
  );
  return loaded.flatMap((item) => (item ? [item] : []));
}

function readRanges(value: unknown): DateRange[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (!row || typeof row !== "object") return { start: null, end: null };
    const range = row as { start_date?: unknown; end_date?: unknown };
    return {
      start: typeof range.start_date === "string" ? range.start_date : null,
      end: typeof range.end_date === "string" ? range.end_date : null,
    };
  });
}

function placeLabel(place: unknown): string | null {
  if (!place || typeof place !== "object") return null;
  const row = place as { title?: unknown; address?: unknown };
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const address = typeof row.address === "string" ? row.address.trim() : "";
  const text = [title, address].filter(Boolean).join(", ");
  return text || null;
}

function blockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return true;
    if (host === "google.com" || host.endsWith(".google.com")) return true;
    if (host.endsWith("yandex.ru") && parsed.pathname.includes("/search")) return true;
    return false;
  } catch {
    return true;
  }
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dedupe(items: NearbyCandidate[]): NearbyCandidate[] {
  const seen = new Set<string>();
  const out: NearbyCandidate[] = [];
  for (const item of items) {
    if (!item.key || seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

function uniqueNotes(notes: string[]): string[] {
  return [...new Set(notes.filter(Boolean))];
}
