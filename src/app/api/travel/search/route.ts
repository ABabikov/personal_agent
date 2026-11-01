import { NextResponse } from "next/server";
import { searchFlights, searchHotels, searchTours } from "@/lib/features/travel/search";

export const runtime = "nodejs";

type Body = {
  kind?: string;
  origin?: string;
  destination?: string;
  departDate?: string;
  returnDate?: string;
  city?: string;
  checkIn?: string;
  checkOut?: string;
  departureCity?: string;
  dateFrom?: string;
  dateTo?: string;
  nightsFrom?: number;
  nightsTo?: number;
  adults?: number;
  priceTo?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Нужен JSON." }, { status: 400 });
  }
  try {
    if (body.kind === "flight") {
      const data = await searchFlights({
        origin: body.origin ?? "",
        destination: body.destination ?? "",
        departDate: body.departDate ?? "",
        returnDate: body.returnDate,
        adults: body.adults,
      });
      return NextResponse.json(data);
    }
    if (body.kind === "hotel") {
      const data = await searchHotels({
        city: body.city ?? body.destination ?? "",
        checkIn: body.checkIn ?? "",
        checkOut: body.checkOut ?? "",
        adults: body.adults,
      });
      return NextResponse.json(data);
    }
    if (body.kind === "tour") {
      const data = await searchTours({
        destination: body.destination ?? "",
        departureCity: body.departureCity,
        dateFrom: body.dateFrom ?? body.departDate ?? "",
        dateTo: body.dateTo,
        nightsFrom: body.nightsFrom,
        nightsTo: body.nightsTo,
        adults: body.adults,
        priceTo: body.priceTo,
      });
      return NextResponse.json(data);
    }
    return NextResponse.json({ error: "kind: flight, hotel или tour." }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Поиск не удался." },
      { status: 502 }
    );
  }
}
