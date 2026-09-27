import { searchLocalProducts } from "@/lib/db/nutrition";
import { searchMagnit } from "@/lib/features/nutrition/magnitCatalog";
import { searchReferenceFoods } from "@/lib/features/nutrition/referenceCatalog";
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

  const [local, magnitAll] = await Promise.all([
    searchLocalProducts(userId, query, 8),
    searchMagnit(query, 4),
  ]);
  const magnit = magnitAll.filter((hit) => hit.kcalPer100 != null);
  const reference = searchReferenceFoods(query, 12);

  return NextResponse.json({
    local: "error" in local ? [] : local.products,
    localError: "error" in local ? local.error : null,
    reference,
    magnit,
    magnitNote:
      magnitAll.length > 0 && magnit.length === 0
        ? "В Магните нашлись товары без пищевой ценности на карточке. Для мяса и крупы бери справочник."
        : null,
    yarcheNote:
      "Каталог Ярче с сервера не открывается. Продукт оттуда можно внести с упаковки.",
  });
}
