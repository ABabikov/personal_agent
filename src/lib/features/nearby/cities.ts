export const NEARBY_CITIES = [
  { slug: "msk", label: "Москва" },
  { slug: "spb", label: "Санкт-Петербург" },
  { slug: "ekb", label: "Екатеринбург" },
  { slug: "kzn", label: "Казань" },
  { slug: "nnv", label: "Нижний Новгород" },
] as const;

export type NearbyCitySlug = (typeof NEARBY_CITIES)[number]["slug"];

export function cityBySlug(slug: string | null | undefined): (typeof NEARBY_CITIES)[number] | null {
  if (!slug) return null;
  return NEARBY_CITIES.find((city) => city.slug === slug) ?? null;
}

export function resolveNearbyCity(
  slug: string | null | undefined,
  label: string | null | undefined
): { slug: string | null; label: string } | { error: string } {
  const known = cityBySlug(slug);
  if (slug && !known) return { error: "Неизвестный город из списка KudaGo." };
  if (known) return { slug: known.slug, label: known.label };
  const text = label?.trim() ?? "";
  if (text.length < 2 || text.length > 40) return { error: "Название города: от 2 до 40 символов." };
  return { slug: null, label: text };
}
