/**
 * Поиск билетов, отелей и туров.
 * Живые цены — только если в .env есть ключ провайдера.
 * Без ключа остаётся прямая ссылка на поиск, чтобы бронь можно было открыть руками.
 */

export type FlightOffer = {
  id: string;
  airline: string;
  origin: string;
  destination: string;
  departsAt: string | null;
  returnsAt: string | null;
  priceRub: number | null;
  transfers: number | null;
  url: string;
};

export type HotelOffer = {
  id: string;
  name: string;
  city: string;
  checkIn: string;
  checkOut: string;
  priceRub: number | null;
  stars: number | null;
  url: string;
};

export type TourOffer = {
  id: string;
  hotel: string;
  country: string;
  region: string | null;
  nights: number | null;
  priceRub: number | null;
  operator: string | null;
  url: string | null;
};

export type TravelSearch<T> = {
  configured: boolean;
  missing: string[];
  note: string;
  searchUrl: string | null;
  offers: T[];
};

const CITIES: Record<string, string> = {
  новосибирск: "OVB",
  москва: "MOW",
  "санкт-петербург": "LED",
  петербург: "LED",
  питер: "LED",
  сочи: "AER",
  казань: "KZN",
  екатеринбург: "SVX",
  владивосток: "VVO",
  калининград: "KGD",
  минск: "MSQ",
  алматы: "ALA",
  ереван: "EVN",
  стамбул: "IST",
  анталья: "AYT",
  дубай: "DXB",
  бангкок: "BKK",
  пхукет: "HKT",
  бали: "DPS",
  денпасар: "DPS",
  барселона: "BCN",
  париж: "PAR",
  рим: "ROM",
  тбилиси: "TBS",
};

function cityKey(input: string): string {
  return input.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function toIata(input: string): string | null {
  const raw = input.trim();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  return CITIES[cityKey(raw)] ?? null;
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}${m}`;
}

export function flightSearchUrl(origin: string, destination: string, depart: string, ret?: string | null): string {
  const path = ret
    ? `${origin}${ddmm(depart)}${destination}${ddmm(ret)}1`
    : `${origin}${ddmm(depart)}${destination}1`;
  return `https://www.aviasales.ru/search/${path}`;
}

export function hotelSearchUrl(city: string, checkIn: string, checkOut: string, adults: number): string {
  const q = new URLSearchParams({
    ss: city,
    checkin: checkIn,
    checkout: checkOut,
    group_adults: String(adults),
    no_rooms: "1",
    group_children: "0",
  });
  return `https://www.booking.com/searchresults.ru.html?${q.toString()}`;
}

function rub(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.round(v) : null;
}

export async function searchFlights(input: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string | null;
  adults?: number;
}): Promise<TravelSearch<FlightOffer>> {
  const origin = toIata(input.origin);
  const destination = toIata(input.destination);
  if (!origin || !destination) {
    return {
      configured: false,
      missing: [],
      note: "Нужен город из списка или IATA-код из трёх букв. Например Новосибирск → OVB, Дубай → DXB.",
      searchUrl: null,
      offers: [],
    };
  }
  const searchUrl = flightSearchUrl(origin, destination, input.departDate, input.returnDate);
  const token =
    process.env.AVIASALES_API_KEY?.trim() || process.env.TRAVELPAYOUTS_TOKEN?.trim() || "";
  if (!token) {
    return {
      configured: false,
      missing: ["AVIASALES_API_KEY"],
      note: "Ключа Aviasales нет — живых цен нет, ссылка открывает поиск на Aviasales.",
      searchUrl,
      offers: [],
    };
  }

  const params = new URLSearchParams({
    origin,
    destination,
    departure_at: input.departDate,
    currency: "rub",
    limit: "8",
    sorting: "price",
    token,
    unique: "true",
  });
  if (input.returnDate) params.set("return_at", input.returnDate);
  else params.set("one_way", "true");

  const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`);
  if (!res.ok) {
    return {
      configured: true,
      missing: [],
      note: `Aviasales ответил HTTP ${res.status}. Ссылка на поиск всё равно есть.`,
      searchUrl,
      offers: [],
    };
  }
  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  const rows = Array.isArray(json.data) ? json.data : [];
  const offers: FlightOffer[] = rows.slice(0, 8).map((row, i) => {
    const link = typeof row.link === "string" ? row.link : "";
    const url = link.startsWith("http")
      ? link
      : link.startsWith("/")
        ? `https://www.aviasales.ru${link}`
        : searchUrl;
    return {
      id: String(row.flight_number ?? `${origin}-${destination}-${i}`),
      airline: String(row.airline ?? "рейс"),
      origin: String(row.origin ?? origin),
      destination: String(row.destination ?? destination),
      departsAt: typeof row.departure_at === "string" ? row.departure_at : null,
      returnsAt: typeof row.return_at === "string" ? row.return_at : null,
      priceRub: rub(row.price),
      transfers: typeof row.transfers === "number" ? row.transfers : null,
      url,
    };
  });
  return {
    configured: true,
    missing: [],
    note: offers.length ? "Цены Aviasales, кэш на дату поиска." : "Aviasales не вернул рейсы на эти даты.",
    searchUrl,
    offers,
  };
}

type AmadeusAuth = { token: string; base: string };

let amadeusCache: { token: string; base: string; until: number } | null = null;

async function amadeusAuth(): Promise<AmadeusAuth | null> {
  const key = process.env.AMADEUS_API_KEY?.trim();
  const secret = process.env.AMADEUS_API_SECRET?.trim();
  if (!key || !secret) return null;
  const base = (process.env.AMADEUS_BASE_URL?.trim() || "https://test.api.amadeus.com").replace(/\/+$/, "");
  if (amadeusCache && amadeusCache.base === base && amadeusCache.until > Date.now()) {
    return { token: amadeusCache.token, base };
  }
  const res = await fetch(`${base}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: key,
      client_secret: secret,
    }),
  });
  if (!res.ok) throw new Error(`Amadeus: авторизация HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Amadeus: нет access_token");
  const until = Date.now() + Math.max(30, (json.expires_in ?? 600) - 30) * 1000;
  amadeusCache = { token: json.access_token, base, until };
  return { token: json.access_token, base };
}

export async function searchHotels(input: {
  city: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
}): Promise<TravelSearch<HotelOffer>> {
  const adults = input.adults && input.adults > 0 ? input.adults : 1;
  const searchUrl = hotelSearchUrl(input.city, input.checkIn, input.checkOut, adults);
  const iata = toIata(input.city);
  let auth: AmadeusAuth | null = null;
  try {
    auth = await amadeusAuth();
  } catch (e) {
    return {
      configured: true,
      missing: [],
      note: e instanceof Error ? e.message : "Amadeus не ответил. Ссылка на Booking.com есть.",
      searchUrl,
      offers: [],
    };
  }
  if (!auth || !iata) {
    const missing = [
      !process.env.AMADEUS_API_KEY?.trim() || !process.env.AMADEUS_API_SECRET?.trim()
        ? "AMADEUS_API_KEY и AMADEUS_API_SECRET"
        : "",
      !iata ? "IATA города" : "",
    ].filter(Boolean);
    return {
      configured: false,
      missing,
      note: iata
        ? "Ключей Amadeus нет — живых цен отелей нет. Ссылка открывает Booking.com."
        : "Для живых цен нужен IATA города и ключи Amadeus. Ссылка на Booking.com ищет по названию.",
      searchUrl,
      offers: [],
    };
  }

  const listUrl = new URL(`${auth.base}/v1/reference-data/locations/hotels/by-city`);
  listUrl.searchParams.set("cityCode", iata);
  listUrl.searchParams.set("radius", "8");
  listUrl.searchParams.set("radiusUnit", "KM");
  listUrl.searchParams.set("hotelSource", "ALL");
  const listed = await fetch(listUrl, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!listed.ok) {
    return {
      configured: true,
      missing: [],
      note: `Amadeus (список отелей) HTTP ${listed.status}. Ссылка на Booking.com есть.`,
      searchUrl,
      offers: [],
    };
  }
  const listJson = (await listed.json()) as { data?: { hotelId?: string; name?: string }[] };
  const ids = (listJson.data ?? []).map((h) => h.hotelId).filter((id): id is string => Boolean(id)).slice(0, 8);
  if (ids.length === 0) {
    return {
      configured: true,
      missing: [],
      note: "Amadeus не нашёл отели в этом городе.",
      searchUrl,
      offers: [],
    };
  }
  const offersUrl = new URL(`${auth.base}/v3/shopping/hotel-offers`);
  offersUrl.searchParams.set("hotelIds", ids.join(","));
  offersUrl.searchParams.set("checkInDate", input.checkIn);
  offersUrl.searchParams.set("checkOutDate", input.checkOut);
  offersUrl.searchParams.set("adults", String(adults));
  offersUrl.searchParams.set("currency", "RUB");
  const offered = await fetch(offersUrl, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!offered.ok) {
    return {
      configured: true,
      missing: [],
      note: `Amadeus (цены) HTTP ${offered.status}. Ссылка на Booking.com есть.`,
      searchUrl,
      offers: [],
    };
  }
  const body = (await offered.json()) as {
    data?: {
      hotel?: { hotelId?: string; name?: string; rating?: string };
      offers?: { price?: { total?: string }; checkInDate?: string; checkOutDate?: string }[];
    }[];
  };
  const offers: HotelOffer[] = (body.data ?? []).slice(0, 8).map((row) => ({
    id: row.hotel?.hotelId ?? row.hotel?.name ?? "hotel",
    name: row.hotel?.name ?? "Отель",
    city: input.city,
    checkIn: row.offers?.[0]?.checkInDate ?? input.checkIn,
    checkOut: row.offers?.[0]?.checkOutDate ?? input.checkOut,
    priceRub: rub(row.offers?.[0]?.price?.total),
    stars: row.hotel?.rating ? Number(row.hotel.rating) || null : null,
    url: searchUrl,
  }));
  return {
    configured: true,
    missing: [],
    note: offers.length
      ? "Цены Amadeus. Оплата и ваучер — по ссылке Booking.com, ключ партнёра Booking в проекте не выпускает бронь сам."
      : "На эти даты Amadeus не отдал предложения.",
    searchUrl,
    offers,
  };
}

function tourvisorReady(): { login: string; password: string } | null {
  const login = process.env.TOURVISOR_LOGIN?.trim() || "";
  const password = process.env.TOURVISOR_PASSWORD?.trim() || "";
  if (!login || !password) return null;
  return { login, password };
}

async function tourvisor(endpoint: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const auth = tourvisorReady();
  if (!auth) throw new Error("Tourvisor не настроен");
  const url = new URL(`https://tourvisor.ru/xml/${endpoint}`);
  url.searchParams.set("authlogin", auth.login);
  url.searchParams.set("authpass", auth.password);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  const text = await res.text();
  if (text.trim() === "Authorization Error") throw new Error("Tourvisor: неверный логин или пароль");
  if (!res.ok) throw new Error(`Tourvisor HTTP ${res.status}`);
  return JSON.parse(text) as unknown;
}

function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function matchName(rows: Record<string, unknown>[], name: string): string | null {
  const needle = cityKey(name);
  const hit = rows.find((row) => cityKey(String(row.name ?? row.countryname ?? "")).includes(needle));
  const id = hit?.id ?? hit?.countrycode ?? hit?.departurecode;
  return id == null ? null : String(id);
}

export async function searchTours(input: {
  destination: string;
  departureCity?: string | null;
  dateFrom: string;
  dateTo?: string | null;
  nightsFrom?: number | null;
  nightsTo?: number | null;
  adults?: number | null;
  priceTo?: number | null;
}): Promise<TravelSearch<TourOffer>> {
  if (!tourvisorReady()) {
    return {
      configured: false,
      missing: ["TOURVISOR_LOGIN", "TOURVISOR_PASSWORD"],
      note: "Турвизор не подключён. План поездки можно сохранить и без цен туроператоров.",
      searchUrl: null,
      offers: [],
    };
  }
  const countries = asList(
    ((await tourvisor("list.php", { type: "country" })) as { lists?: { country?: unknown } }).lists?.country
  );
  const departures = asList(
    ((await tourvisor("list.php", { type: "departure" })) as { lists?: { departure?: unknown } }).lists?.departure
  );
  const country = matchName(countries, input.destination);
  const departure = matchName(departures, input.departureCity?.trim() || "Новосибирск");
  if (!country || !departure) {
    return {
      configured: true,
      missing: [],
      note: !country
        ? `Турвизор не знает страну «${input.destination}».`
        : `Турвизор не знает вылет из «${input.departureCity || "Новосибирск"}».`,
      searchUrl: null,
      offers: [],
    };
  }
  const created = (await tourvisor("search.php", {
    departure,
    country,
    datefrom: input.dateFrom.split("-").reverse().join("."),
    dateto: (input.dateTo || input.dateFrom).split("-").reverse().join("."),
    nightsfrom: input.nightsFrom ?? 7,
    nightsto: input.nightsTo ?? input.nightsFrom ?? 10,
    adults: input.adults ?? 1,
    priceto: input.priceTo ?? undefined,
    currency: 0,
  })) as { result?: { requestid?: string } };
  const requestId = created.result?.requestid;
  if (!requestId) {
    return { configured: true, missing: [], note: "Турвизор не выдал номер поиска.", searchUrl: null, offers: [] };
  }

  let payload: unknown = null;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    payload = await tourvisor("result.php", { requestid: requestId, type: "result", page: 1, onpage: 8 });
    const status = (payload as { data?: { status?: { state?: string } } }).data?.status?.state;
    if (status === "finished" || asList((payload as { data?: { result?: { hotel?: unknown } } }).data?.result?.hotel).length > 0) {
      break;
    }
  }
  const hotels = asList((payload as { data?: { result?: { hotel?: unknown } } }).data?.result?.hotel);
  const offers: TourOffer[] = hotels.slice(0, 8).map((hotel) => {
    const tours = asList((hotel.tours as { tour?: unknown } | undefined)?.tour ?? hotel.tour);
    const tour = tours[0] ?? {};
    return {
      id: String(tour.tourid ?? hotel.hotelcode ?? hotel.hotelname ?? "tour"),
      hotel: String(hotel.hotelname ?? hotel.name ?? "Отель"),
      country: input.destination,
      region: hotel.hotelregion ? String(hotel.hotelregion) : hotel.regionname ? String(hotel.regionname) : null,
      nights: rub(tour.nights),
      priceRub: rub(tour.price),
      operator: tour.operatorname ? String(tour.operatorname) : null,
      url: null,
    };
  });
  return {
    configured: true,
    missing: [],
    note: offers.length
      ? "Цены Турвизора. Выписка путёвки у оператора — отдельно, в план можно положить выбранный тур."
      : "Турвизор ещё не собрал туры или на эти даты пусто. Повтори поиск через минуту.",
    searchUrl: null,
    offers,
  };
}
