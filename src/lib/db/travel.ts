import { supabase } from "@/lib/db/supabase";
import type {
  Database,
  TravelBookingKind,
  TravelBookingStatus,
  TripPlanStatus,
} from "@/types/database";

type PlanRow = Database["public"]["Tables"]["trip_plans"]["Row"];
type BookingRow = Database["public"]["Tables"]["travel_bookings"]["Row"];

export type TripEventType = "flight" | "hotel" | "activity" | "transport";

export type TripEvent = {
  id: string;
  date: string;
  title: string;
  description: string;
  location: string;
  time: string;
  duration: number;
  type: TripEventType;
};

export type TripPlan = {
  id: string;
  title: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  budgetRub: number | null;
  travelers: number;
  notes: string;
  events: TripEvent[];
  status: TripPlanStatus;
  updatedAt: string;
};

export type TravelBooking = {
  id: string;
  tripPlanId: string | null;
  kind: TravelBookingKind;
  title: string;
  provider: string | null;
  externalRef: string | null;
  status: TravelBookingStatus;
  priceRub: number | null;
  currency: string;
  startsAt: string | null;
  endsAt: string | null;
  url: string | null;
};

function dbError(message: string): string {
  if (/trip_plans|travel_bookings|schema cache|does not exist/i.test(message)) {
    return "Таблицы поездок ещё нет. Примени в Supabase миграцию supabase/migrations/022_travel.sql.";
  }
  return message;
}

const EVENT_TYPES: TripEventType[] = ["flight", "hotel", "activity", "transport"];

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function notesOf(raw: PlanRow["plan_data"]): string {
  const notes = asRecord(raw).notes;
  return typeof notes === "string" ? notes : "";
}

function eventsOf(raw: PlanRow["plan_data"]): TripEvent[] {
  const list = asRecord(raw).events;
  if (!Array.isArray(list)) return [];
  const out: TripEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const type = EVENT_TYPES.includes(row.type as TripEventType)
      ? (row.type as TripEventType)
      : "activity";
    const duration = typeof row.duration === "number" && row.duration > 0 ? row.duration : 60;
    out.push({
      id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
      date,
      title,
      description: typeof row.description === "string" ? row.description : "",
      location: typeof row.location === "string" ? row.location : "",
      time: typeof row.time === "string" ? row.time : "",
      duration,
      type,
    });
  }
  return out;
}

function toPlan(row: PlanRow): TripPlan {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    budgetRub: row.budget_rub,
    travelers: row.travelers_count,
    notes: notesOf(row.plan_data),
    events: eventsOf(row.plan_data),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function toBooking(row: BookingRow): TravelBooking {
  return {
    id: row.id,
    tripPlanId: row.trip_plan_id,
    kind: row.kind,
    title: row.title,
    provider: row.provider,
    externalRef: row.external_ref,
    status: row.status,
    priceRub: row.price_rub == null ? null : Number(row.price_rub),
    currency: row.currency,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    url: row.url,
  };
}

export async function listTripPlans(userId: string): Promise<{ plans: TripPlan[] } | { error: string }> {
  const { data, error } = await supabase
    .from("trip_plans")
    .select("*")
    .eq("user_id", userId)
    .order("start_date", { ascending: true, nullsFirst: false });
  if (error) return { error: dbError(error.message) };
  return { plans: (data ?? []).map(toPlan) };
}

export async function saveTripPlan(
  userId: string,
  input: {
    title: string;
    destination: string;
    startDate?: string | null;
    endDate?: string | null;
    budgetRub?: number | null;
    travelers?: number | null;
    notes?: string | null;
    status?: TripPlanStatus | null;
  }
): Promise<{ plan: TripPlan } | { error: string }> {
  const title = input.title.trim();
  const destination = input.destination.trim();
  if (!title || !destination) return { error: "Нужны название и направление." };
  const { data, error } = await supabase
    .from("trip_plans")
    .insert({
      user_id: userId,
      title,
      destination,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      budget_rub: input.budgetRub ?? null,
      travelers_count: input.travelers && input.travelers > 0 ? input.travelers : 1,
      plan_data: { notes: input.notes?.trim() || "", events: [] },
      status: input.status ?? "draft",
    })
    .select("*")
    .single();
  if (error || !data) return { error: dbError(error?.message ?? "не записалось") };
  return { plan: toPlan(data) };
}

export async function updateTripPlan(
  userId: string,
  id: string,
  patch: {
    title?: string | null;
    destination?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    budgetRub?: number | null;
    travelers?: number | null;
    notes?: string | null;
    status?: TripPlanStatus | null;
  }
): Promise<{ plan: TripPlan } | { error: string }> {
  const update: Database["public"]["Tables"]["trip_plans"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title != null) update.title = patch.title.trim();
  if (patch.destination != null) update.destination = patch.destination.trim();
  if (patch.startDate !== undefined) update.start_date = patch.startDate;
  if (patch.endDate !== undefined) update.end_date = patch.endDate;
  if (patch.budgetRub !== undefined) update.budget_rub = patch.budgetRub;
  if (patch.travelers != null) update.travelers_count = patch.travelers;
  if (patch.status != null) update.status = patch.status;
  if (patch.notes != null) {
    const existing = await supabase
      .from("trip_plans")
      .select("plan_data")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (existing.error) return { error: dbError(existing.error.message) };
    const current = asRecord(existing.data?.plan_data ?? null);
    update.plan_data = { ...current, notes: patch.notes.trim() };
  }
  const { data, error } = await supabase
    .from("trip_plans")
    .update(update)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { error: dbError(error.message) };
  if (!data) return { error: "План не найден." };
  return { plan: toPlan(data) };
}

export async function listTravelBookings(
  userId: string,
  tripPlanId?: string | null
): Promise<{ bookings: TravelBooking[] } | { error: string }> {
  let q = supabase.from("travel_bookings").select("*").eq("user_id", userId).order("starts_at", { ascending: true });
  if (tripPlanId) q = q.eq("trip_plan_id", tripPlanId);
  const { data, error } = await q;
  if (error) return { error: dbError(error.message) };
  return { bookings: (data ?? []).map(toBooking) };
}

export async function saveTravelBooking(
  userId: string,
  input: {
    tripPlanId?: string | null;
    kind: TravelBookingKind;
    title: string;
    provider?: string | null;
    externalRef?: string | null;
    status?: TravelBookingStatus | null;
    priceRub?: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
    url?: string | null;
  }
): Promise<{ booking: TravelBooking } | { error: string }> {
  const title = input.title.trim();
  if (!title) return { error: "Нужно название брони." };
  const { data, error } = await supabase
    .from("travel_bookings")
    .insert({
      user_id: userId,
      trip_plan_id: input.tripPlanId || null,
      kind: input.kind,
      title,
      provider: input.provider?.trim() || null,
      external_ref: input.externalRef?.trim() || null,
      status: input.status ?? "draft",
      price_rub: input.priceRub ?? null,
      starts_at: input.startsAt || null,
      ends_at: input.endsAt || null,
      url: input.url?.trim() || null,
      payload: {},
    })
    .select("*")
    .single();
  if (error || !data) return { error: dbError(error?.message ?? "не записалось") };
  return { booking: toBooking(data) };
}

export async function updateTravelBooking(
  userId: string,
  id: string,
  patch: {
    status?: TravelBookingStatus | null;
    title?: string | null;
    priceRub?: number | null;
    url?: string | null;
    externalRef?: string | null;
    tripPlanId?: string | null;
  }
): Promise<{ booking: TravelBooking } | { error: string }> {
  const update: Database["public"]["Tables"]["travel_bookings"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status != null) update.status = patch.status;
  if (patch.title != null) update.title = patch.title.trim();
  if (patch.priceRub !== undefined) update.price_rub = patch.priceRub;
  if (patch.url !== undefined) update.url = patch.url;
  if (patch.externalRef !== undefined) update.external_ref = patch.externalRef;
  if (patch.tripPlanId !== undefined) update.trip_plan_id = patch.tripPlanId;
  const { data, error } = await supabase
    .from("travel_bookings")
    .update(update)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { error: dbError(error.message) };
  if (!data) return { error: "Бронь не найдена." };
  return { booking: toBooking(data) };
}

export type TripEventInput = {
  date: string;
  title: string;
  description?: string | null;
  location?: string | null;
  time?: string | null;
  duration?: number | null;
  type?: TripEventType | null;
};

async function writeEvents(
  userId: string,
  planId: string,
  events: TripEvent[]
): Promise<{ plan: TripPlan } | { error: string }> {
  const existing = await supabase
    .from("trip_plans")
    .select("plan_data")
    .eq("user_id", userId)
    .eq("id", planId)
    .maybeSingle();
  if (existing.error) return { error: dbError(existing.error.message) };
  if (!existing.data) return { error: "План не найден." };
  const current = asRecord(existing.data.plan_data);
  const { data, error } = await supabase
    .from("trip_plans")
    .update({
      plan_data: { ...current, events },
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", planId)
    .select("*")
    .maybeSingle();
  if (error) return { error: dbError(error.message) };
  if (!data) return { error: "План не найден." };
  return { plan: toPlan(data) };
}

function normalizeEvent(input: TripEventInput, id: string): TripEvent | { error: string } {
  const title = input.title.trim();
  const date = input.date.trim().slice(0, 10);
  if (!title) return { error: "Нужно название пункта." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Дата пункта — в формате YYYY-MM-DD." };
  const type = input.type && EVENT_TYPES.includes(input.type) ? input.type : "activity";
  const duration = input.duration && input.duration > 0 ? Math.round(input.duration) : 60;
  return {
    id,
    date,
    title,
    description: input.description?.trim() || "",
    location: input.location?.trim() || "",
    time: input.time?.trim() || "",
    duration,
    type,
  };
}

export async function addTripEvent(
  userId: string,
  planId: string,
  input: TripEventInput
): Promise<{ plan: TripPlan; event: TripEvent } | { error: string }> {
  const event = normalizeEvent(input, crypto.randomUUID());
  if ("error" in event) return event;
  const existing = await supabase
    .from("trip_plans")
    .select("plan_data")
    .eq("user_id", userId)
    .eq("id", planId)
    .maybeSingle();
  if (existing.error) return { error: dbError(existing.error.message) };
  if (!existing.data) return { error: "План не найден." };
  const events = [...eventsOf(existing.data.plan_data), event].sort(bySchedule);
  const saved = await writeEvents(userId, planId, events);
  if ("error" in saved) return saved;
  return { plan: saved.plan, event };
}

export async function updateTripEvent(
  userId: string,
  planId: string,
  eventId: string,
  patch: Partial<TripEventInput>
): Promise<{ plan: TripPlan } | { error: string }> {
  const existing = await supabase
    .from("trip_plans")
    .select("plan_data")
    .eq("user_id", userId)
    .eq("id", planId)
    .maybeSingle();
  if (existing.error) return { error: dbError(existing.error.message) };
  if (!existing.data) return { error: "План не найден." };
  const events = eventsOf(existing.data.plan_data);
  const current = events.find((event) => event.id === eventId);
  if (!current) return { error: "Пункт расписания не найден." };
  const next = normalizeEvent(
    {
      date: patch.date ?? current.date,
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      location: patch.location ?? current.location,
      time: patch.time ?? current.time,
      duration: patch.duration ?? current.duration,
      type: patch.type ?? current.type,
    },
    current.id
  );
  if ("error" in next) return next;
  return writeEvents(
    userId,
    planId,
    events.map((event) => (event.id === eventId ? next : event)).sort(bySchedule)
  );
}

export async function deleteTripEvent(
  userId: string,
  planId: string,
  eventId: string
): Promise<{ plan: TripPlan } | { error: string }> {
  const existing = await supabase
    .from("trip_plans")
    .select("plan_data")
    .eq("user_id", userId)
    .eq("id", planId)
    .maybeSingle();
  if (existing.error) return { error: dbError(existing.error.message) };
  if (!existing.data) return { error: "План не найден." };
  const events = eventsOf(existing.data.plan_data);
  if (!events.some((event) => event.id === eventId)) return { error: "Пункт расписания не найден." };
  return writeEvents(
    userId,
    planId,
    events.filter((event) => event.id !== eventId)
  );
}

function bySchedule(a: TripEvent, b: TripEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time || "99:99").localeCompare(b.time || "99:99");
}
