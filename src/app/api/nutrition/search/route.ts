import { searchLocalProducts } from "@/lib/db/nutrition";
import { searchMagnit } from "@/lib/features/nutrition/magnitCatalog";
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

  const local = await searchLocalProducts(userId, query, 8);
  const magnit = await searchMagnit(query, 4);

  return NextResponse.json({
    local: "error" in local ? [] : local.products,
    localError: "error" in local ? local.error : null,
    magnit,
    yarcheNote:
      "Каталог Ярче с сервера не открывается. Продукт оттуда можно внести с упаковки.",
  });
}
