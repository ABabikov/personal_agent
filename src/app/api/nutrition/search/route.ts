import { searchLocalProducts } from "@/lib/db/nutrition";
import { searchMagnit } from "@/lib/features/nutrition/magnitCatalog";
import { searchReferenceFoods } from "@/lib/features/nutrition/referenceCatalog";
import { searchYarche } from "@/lib/features/nutrition/yarcheCatalog";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SearchBody = {
  userId?: string;
  query?: string;
};

export async function POST(request: Request) {
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 });
  }
  const userId = body.userId?.trim() ?? "";
  const query = body.query?.trim() ?? "";
  if (!userId) return NextResponse.json({ error: "Нет userId." }, { status: 400 });
  if (query.length < 2) return NextResponse.json({ error: "Запрос короче 2 символов." }, { status: 400 });

  const [local, magnitAll, yarche] = await Promise.all([
    searchLocalProducts(userId, query, 8),
    searchMagnit(query, 4),
    searchYarche(query, 8),
  ]);
  const magnit = magnitAll.filter((hit) => hit.kcalPer100 != null);
  const yarcheHits = yarche.hits.filter((hit) => hit.kcalPer100 != null);
  const reference = searchReferenceFoods(query, 24);

  return NextResponse.json({
    local: "error" in local ? [] : local.products,
    localError: "error" in local ? local.error : null,
    reference,
    magnit,
    yarche: yarcheHits,
    magnitNote:
      magnitAll.length > 0 && magnit.length === 0
        ? "В Магните нашлись товары без пищевой ценности на карточке. Для мяса и крупы бери справочник."
        : null,
    yarcheNote: yarche.unavailable
      ? "Каталог Ярче сейчас не ответил. Продукт оттуда можно внести с упаковки."
      : yarche.hits.length > 0 && yarcheHits.length === 0
        ? "В Ярче нашлись товары без КБЖУ на карточке."
        : null,
  });
}
