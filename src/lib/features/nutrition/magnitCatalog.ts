const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type MagnitHit = {
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
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function productName(html: string, slug: string): string {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (title) {
    const clean = decodeBasic(title).split("–")[0].split(" - ")[0].trim();
    if (clean) return clean;
  }
  return slug.replace(/_/g, " ");
}

function parseNutrition(html: string): {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
} | null {
  const m = html.match(
    /Пищевая ценность в 100 граммах",\[\d+(?:,\d+)*\],\{"name":\d+,"value":\d+\},"Ккал","([^"]+)",\{"name":\d+,"value":\d+\},"Белки","([^"]+)",\{"name":\d+,"value":\d+\},"Жиры","([^"]+)",\{"name":\d+,"value":\d+\},"Углеводы","([^"]+)"/
  );
  if (!m) return null;
  const nums = m.slice(1, 5).map((x) => Number(x.replace(",", ".")));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return { kcal: nums[0], protein: nums[1], fat: nums[2], carbs: nums[3] };
}

function parsePackageGrams(html: string): number | null {
  const m = html.match(/"Вес, кг","([0-9]+(?:[.,][0-9]+)?)"/);
  if (!m) return null;
  const kg = Number(m[1].replace(",", "."));
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 1000);
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

function searchLinks(html: string, limit: number): { id: string; slug: string }[] {
  const re = /\/product\/(\d+)-([^"'?\\]+)/g;
  const seen = new Set<string>();
  const out: { id: string; slug: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], slug: m[2] });
  }
  return out;
}

/** Поиск по странице каталога Магнита и КБЖУ с карточки товара. */
export async function searchMagnit(query: string, limit = 4): Promise<MagnitHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const searchUrl = `https://magnit.ru/search?${new URLSearchParams({ term: q })}`;
  const html = await fetchText(searchUrl, 12000);
  if (!html) return [];
  const links = searchLinks(html, limit);
  const hits = await Promise.all(
    links.map(async (link): Promise<MagnitHit | null> => {
      const url = `https://magnit.ru/product/${link.id}-${link.slug}`;
      const page = await fetchText(url, 8000);
      if (!page) return null;
      const nut = parseNutrition(page);
      return {
        externalId: link.id,
        name: productName(page, link.slug),
        kcalPer100: nut?.kcal ?? null,
        proteinPer100: nut?.protein ?? null,
        fatPer100: nut?.fat ?? null,
        carbsPer100: nut?.carbs ?? null,
        packageGrams: parsePackageGrams(page),
        url,
      };
    })
  );
  return hits.filter((h): h is MagnitHit => h != null);
}
