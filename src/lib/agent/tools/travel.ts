import type { AgentTool } from "@/lib/agent/tools/types";
import {
  addTripEvent,
  deleteTripEvent,
  listTravelBookings,
  listTripPlans,
  saveTravelBooking,
  saveTripPlan,
  updateTravelBooking,
  updateTripEvent,
  updateTripPlan,
  type TripEventType,
} from "@/lib/db/travel";
import { searchFlights, searchHotels, searchTours } from "@/lib/features/travel/search";
import type { TravelBookingKind, TravelBookingStatus, TripPlanStatus } from "@/types/database";

const PLAN_STATUS = ["draft", "confirmed", "completed", "cancelled"] as const;
const BOOKING_KIND = ["flight", "hotel", "tour", "cruise", "other"] as const;
const BOOKING_STATUS = ["draft", "held", "booked", "cancelled"] as const;
const EVENT_TYPE = ["flight", "hotel", "activity", "transport"] as const;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = str(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

export const listTripPlansTool: AgentTool = {
  name: "list_trip_plans",
  description:
    "Планы поездок и расписание по дням (events: дата, время, длительность, тип flight|hotel|activity|transport). Ничего не ищет у авиакомпаний.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const res = await listTripPlans(ctx.userId);
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: { plans: res.plans } };
  },
};

export const saveTripPlanTool: AgentTool = {
  name: "save_trip_plan",
  description:
    "Создаёт план поездки. Только после явного «да» / «записывай» / «подтверждаю». Сначала покажи направление, даты, людей и бюджет.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Короткое название, например «Дубай, ноябрь»." },
      destination: { type: "string", description: "Город или страна." },
      startDate: { type: "string", description: "YYYY-MM-DD" },
      endDate: { type: "string", description: "YYYY-MM-DD" },
      budgetRub: { type: "number" },
      travelers: { type: "number" },
      notes: { type: "string" },
    },
    required: ["title", "destination"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const res = await saveTripPlan(ctx.userId, {
      title: str(args.title),
      destination: str(args.destination),
      startDate: str(args.startDate) || null,
      endDate: str(args.endDate) || null,
      budgetRub: num(args.budgetRub),
      travelers: num(args.travelers),
      notes: str(args.notes) || null,
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: res.plan };
  },
};

export const updateTripPlanTool: AgentTool = {
  name: "update_trip_plan",
  description:
    "Меняет план поездки: даты, бюджет, заметку или статус (draft, confirmed, completed, cancelled). Только после явного «да».",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      destination: { type: "string" },
      startDate: { type: "string" },
      endDate: { type: "string" },
      budgetRub: { type: "number" },
      travelers: { type: "number" },
      notes: { type: "string" },
      status: { type: "string", enum: [...PLAN_STATUS] },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = str(args.id);
    if (!id) return { ok: false, error: "Нужен id плана." };
    const res = await updateTripPlan(ctx.userId, id, {
      title: args.title == null ? null : str(args.title),
      destination: args.destination == null ? null : str(args.destination),
      startDate: args.startDate === undefined ? undefined : str(args.startDate) || null,
      endDate: args.endDate === undefined ? undefined : str(args.endDate) || null,
      budgetRub: args.budgetRub === undefined ? undefined : num(args.budgetRub),
      travelers: args.travelers === undefined ? null : num(args.travelers),
      notes: args.notes === undefined ? null : str(args.notes),
      status: oneOf<TripPlanStatus>(args.status, PLAN_STATUS),
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: res.plan };
  },
};

export const listTravelBookingsTool: AgentTool = {
  name: "list_travel_bookings",
  description:
    "Сохранённые билеты, отели и туры. status: draft — выбрано, но не оплачено; booked — пользователь подтвердил, что купил; cancelled — отменено у нас. Не выдумывай номер брони.",
  parameters: {
    type: "object",
    properties: {
      tripPlanId: { type: "string", description: "Если пусто — все брони." },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const res = await listTravelBookings(ctx.userId, str(args.tripPlanId) || null);
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: { bookings: res.bookings } };
  },
};

export const saveTravelBookingTool: AgentTool = {
  name: "save_travel_booking",
  description:
    "Кладёт билет, отель или тур в план. Не оплачивает и не выписывает билет: сохраняет выбор и ссылку. Только после явного «да». status=booked ставь, только если человек сказал, что уже купил.",
  parameters: {
    type: "object",
    properties: {
      tripPlanId: { type: "string" },
      kind: { type: "string", enum: [...BOOKING_KIND] },
      title: { type: "string" },
      provider: { type: "string" },
      externalRef: { type: "string", description: "Номер брони, если человек его назвал." },
      status: { type: "string", enum: [...BOOKING_STATUS] },
      priceRub: { type: "number" },
      startsAt: { type: "string", description: "ISO-дата или YYYY-MM-DD." },
      endsAt: { type: "string" },
      url: { type: "string" },
    },
    required: ["kind", "title"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const kind = oneOf<TravelBookingKind>(args.kind, BOOKING_KIND);
    if (!kind) return { ok: false, error: "kind: flight, hotel, tour, cruise или other." };
    const res = await saveTravelBooking(ctx.userId, {
      tripPlanId: str(args.tripPlanId) || null,
      kind,
      title: str(args.title),
      provider: str(args.provider) || null,
      externalRef: str(args.externalRef) || null,
      status: oneOf<TravelBookingStatus>(args.status, BOOKING_STATUS) ?? "draft",
      priceRub: num(args.priceRub),
      startsAt: str(args.startsAt) || null,
      endsAt: str(args.endsAt) || null,
      url: str(args.url) || null,
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: res.booking };
  },
};

export const updateTravelBookingTool: AgentTool = {
  name: "update_travel_booking",
  description:
    "Меняет сохранённую бронь: статус, цену, ссылку, номер. Отмена здесь снимает запись у нас, у авиакомпании сама не отменяется. Только после явного «да».",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: [...BOOKING_STATUS] },
      title: { type: "string" },
      priceRub: { type: "number" },
      url: { type: "string" },
      externalRef: { type: "string" },
      tripPlanId: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const id = str(args.id);
    if (!id) return { ok: false, error: "Нужен id брони." };
    const res = await updateTravelBooking(ctx.userId, id, {
      status: oneOf<TravelBookingStatus>(args.status, BOOKING_STATUS),
      title: args.title === undefined ? null : str(args.title),
      priceRub: args.priceRub === undefined ? undefined : num(args.priceRub),
      url: args.url === undefined ? undefined : str(args.url) || null,
      externalRef: args.externalRef === undefined ? undefined : str(args.externalRef) || null,
      tripPlanId: args.tripPlanId === undefined ? undefined : str(args.tripPlanId) || null,
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: res.booking };
  },
};

export const searchFlightsTool: AgentTool = {
  name: "search_flights",
  description:
    "Ищет авиабилеты. Город или IATA (Новосибирск/OVB). С ключом AVIASALES_API_KEY возвращает цены, без ключа — ссылку на Aviasales. Не покупает билет.",
  parameters: {
    type: "object",
    properties: {
      origin: { type: "string" },
      destination: { type: "string" },
      departDate: { type: "string", description: "YYYY-MM-DD" },
      returnDate: { type: "string", description: "YYYY-MM-DD, пусто для одной стороны." },
      adults: { type: "number" },
    },
    required: ["origin", "destination", "departDate"],
    additionalProperties: false,
  },
  execute: async (args) => {
    try {
      const data = await searchFlights({
        origin: str(args.origin),
        destination: str(args.destination),
        departDate: str(args.departDate),
        returnDate: str(args.returnDate) || null,
        adults: num(args.adults) ?? 1,
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const searchHotelsTool: AgentTool = {
  name: "search_hotels",
  description:
    "Ищет отели. С ключами AMADEUS_API_KEY и AMADEUS_API_SECRET — цены Amadeus, иначе ссылка на Booking.com. Сам номер не бронирует и карту не списывает.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
      checkIn: { type: "string", description: "YYYY-MM-DD" },
      checkOut: { type: "string", description: "YYYY-MM-DD" },
      adults: { type: "number" },
    },
    required: ["city", "checkIn", "checkOut"],
    additionalProperties: false,
  },
  execute: async (args) => {
    try {
      const data = await searchHotels({
        city: str(args.city),
        checkIn: str(args.checkIn),
        checkOut: str(args.checkOut),
        adults: num(args.adults) ?? 1,
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const addTripEventTool: AgentTool = {
  name: "add_trip_event",
  description:
    "Добавляет пункт в расписание поездки: день, время, длительность в минутах, место. Тип: flight, hotel, activity, transport. Только после явного «да». planId — из list_trip_plans.",
  parameters: {
    type: "object",
    properties: {
      planId: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" },
      title: { type: "string" },
      time: { type: "string", description: "HH:MM, можно пусто" },
      duration: { type: "number", description: "Минуты, по умолчанию 60" },
      location: { type: "string" },
      description: { type: "string" },
      type: { type: "string", description: "flight | hotel | activity | transport" },
    },
    required: ["planId", "date", "title"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const res = await addTripEvent(ctx.userId, str(args.planId), {
      date: str(args.date),
      title: str(args.title),
      time: str(args.time) || null,
      duration: num(args.duration),
      location: str(args.location) || null,
      description: str(args.description) || null,
      type: oneOf<TripEventType>(args.type, EVENT_TYPE),
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: { event: res.event, planId: res.plan.id } };
  },
};

export const updateTripEventTool: AgentTool = {
  name: "update_trip_event",
  description:
    "Меняет пункт расписания поездки. Только после явного «да». eventId бери из events плана в list_trip_plans.",
  parameters: {
    type: "object",
    properties: {
      planId: { type: "string" },
      eventId: { type: "string" },
      date: { type: "string" },
      title: { type: "string" },
      time: { type: "string" },
      duration: { type: "number" },
      location: { type: "string" },
      description: { type: "string" },
      type: { type: "string" },
    },
    required: ["planId", "eventId"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const res = await updateTripEvent(ctx.userId, str(args.planId), str(args.eventId), {
      date: str(args.date) || undefined,
      title: str(args.title) || undefined,
      time: str(args.time) || undefined,
      duration: num(args.duration) ?? undefined,
      location: str(args.location) || undefined,
      description: str(args.description) || undefined,
      type: oneOf<TripEventType>(args.type, EVENT_TYPE) ?? undefined,
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: { planId: res.plan.id, events: res.plan.events } };
  },
};

export const deleteTripEventTool: AgentTool = {
  name: "delete_trip_event",
  description: "Удаляет пункт расписания поездки. Только после явного «да».",
  parameters: {
    type: "object",
    properties: {
      planId: { type: "string" },
      eventId: { type: "string" },
    },
    required: ["planId", "eventId"],
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const res = await deleteTripEvent(ctx.userId, str(args.planId), str(args.eventId));
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, data: { planId: res.plan.id, events: res.plan.events } };
  },
};

export const searchToursTool: AgentTool = {
  name: "search_tours",
  description:
    "Ищет пакетные туры в Турвизоре (TOURVISOR_LOGIN и TOURVISOR_PASSWORD). Вылет по умолчанию — Новосибирск. Не выписывает путёвку.",
  parameters: {
    type: "object",
    properties: {
      destination: { type: "string", description: "Страна, как в Турвизоре: Турция, ОАЭ, Таиланд." },
      departureCity: { type: "string" },
      dateFrom: { type: "string", description: "YYYY-MM-DD" },
      dateTo: { type: "string" },
      nightsFrom: { type: "number" },
      nightsTo: { type: "number" },
      adults: { type: "number" },
      priceTo: { type: "number" },
    },
    required: ["destination", "dateFrom"],
    additionalProperties: false,
  },
  execute: async (args) => {
    try {
      const data = await searchTours({
        destination: str(args.destination),
        departureCity: str(args.departureCity) || null,
        dateFrom: str(args.dateFrom),
        dateTo: str(args.dateTo) || null,
        nightsFrom: num(args.nightsFrom),
        nightsTo: num(args.nightsTo),
        adults: num(args.adults),
        priceTo: num(args.priceTo),
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
