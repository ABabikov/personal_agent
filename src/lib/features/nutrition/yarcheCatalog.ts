const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type YarcheHit = {
  externalId: string;
  name: string;
  kcalPer100: number | null;
  proteinPer100: number | null;
  fatPer100: number | null;
  carbsPer100: number | null;
  packageGrams: number | null;
  url: string;
};

function decodeBasic(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function num(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function packageGrams(weight: string | null): number | null {
  if (!weight) return null;
  const text = weight.replace(/\u00a0/g, " ");
  const kg = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*кг/i);
  if (kg) {
    const n = Number(kg[1].replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
  }
  const g = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*г/i);
  if (!g) return null;
  const n = Number(g[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function parseYarcheSearch(html: string, limit: number): { id: string; code: string; name: string }[] {
  const re = /href="\/product\/([a-z0-9-]+)-(\d+)"[\s\S]{0,2500}?alt="([^"]+)"/g;
  const seen = new Set<string>();
  const out: { id: string; code: string; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const name = decodeBasic(m[3]).replace(/\s+/g, " ").trim();
    if (!name) continue;
    out.push({ id: m[2], code: m[1], name });
  }
  return out;
}

function prop(html: string, name: string): string | null {
  const m = html.match(new RegExp(`"name":"${name}"[\\s\\S]{0,220}?"strValue":"([^"]*)"`));
  return m ? decodeBasic(m[1]) : null;
}

export function parseYarcheProduct(
  html: string,
  card: { id: string; code: string; name: string }
): YarcheHit {
  const fromJson = html.match(/"product":\{"data":\{"id":\d+,"code":"[^"]+","name":"([^"]+)"/);
  const name = fromJson ? decodeBasic(fromJson[1]).replace(/\s+/g, " ").trim() : card.name;
  return {
    externalId: card.id,
    name: name || card.name,
    kcalPer100: num(prop(html, "energy_value")),
    proteinPer100: num(prop(html, "protein_content")),
    fatPer100: num(prop(html, "fat_content")),
    carbsPer100: num(prop(html, "carbohydrate_content")),
    packageGrams: packageGrams(prop(html, "weight_unit")),
    url: `https://yarcheplus.ru/product/${card.code}-${card.id}`,
  };
}

/** Поиск по витрине Ярче и КБЖУ с карточки. Цифры на карточке — на 100 г. */
export async function searchYarche(
  query: string,
  limit = 8
): Promise<{ hits: YarcheHit[]; unavailable: boolean }> {
  const q = query.trim();
  if (q.length < 2) return { hits: [], unavailable: false };
  const searchUrl = `https://yarcheplus.ru/search?${new URLSearchParams({ query: q })}`;
  const html = await fetchText(searchUrl, 8000);
  if (!html) return { hits: [], unavailable: true };
  const cards = parseYarcheSearch(html, limit);
  const hits = await Promise.all(
    cards.map(async (card): Promise<YarcheHit | null> => {
      const page = await fetchText(`https://yarcheplus.ru/product/${card.code}-${card.id}`, 7000);
      if (!page) return { ...parseYarcheProduct("", card), kcalPer100: null, proteinPer100: null, fatPer100: null, carbsPer100: null };
      return parseYarcheProduct(page, card);
    })
  );
  return { hits: hits.filter((hit): hit is YarcheHit => hit != null), unavailable: false };
}
