"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";
import {
  listTravelBookings,
  listTripPlans,
  saveTravelBooking,
  saveTripPlan,
  type TravelBooking,
  type TripPlan,
} from "@/lib/db/travel";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";

type SearchKind = "flight" | "hotel" | "tour";

type Offer = {
  id: string;
  title: string;
  detail: string;
  priceRub: number | null;
  url: string | null;
  kind: SearchKind;
  startsAt: string | null;
  endsAt: string | null;
};

const fieldClass =
  "h-8 w-full rounded-lg border border-glow-primary/30 bg-card/30 px-2.5 text-sm outline-none focus-visible:border-glow-primary/60";

function rub(n: number | null): string {
  if (n == null) return "цена по ссылке";
  return `${n.toLocaleString("ru-RU")} ₽`;
}

export function TravelPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [plans, setPlans] = useState<TripPlan[]>([]);
  const [bookings, setBookings] = useState<TravelBooking[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [kind, setKind] = useState<SearchKind>("flight");
  const [origin, setOrigin] = useState("Новосибирск");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [searchUrl, setSearchUrl] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  const summary = useMemo(() => {
    const lines = plans.slice(0, 6).map((p) => {
      const when = [p.startDate, p.endDate].filter(Boolean).join(" — ");
      return `${p.title} → ${p.destination}${when ? `, ${when}` : ""}, ${p.status}`;
    });
    return lines.join("\n");
  }, [plans]);
  useRegisterPageChatContext("Поездки", summary);

  const reload = useCallback(async (uid: string, planId: string | null) => {
    const [planRes, bookingRes] = await Promise.all([
      listTripPlans(uid),
      listTravelBookings(uid, planId),
    ]);
    if ("error" in planRes) {
      setError(planRes.error);
      return;
    }
    setPlans(planRes.plans);
    if ("error" in bookingRes) {
      setError(bookingRes.error);
      return;
    }
    setBookings(bookingRes.bookings);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getWorkoutUserId().then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setUserId(result.userId);
      void reload(result.userId, null);
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!userId) return;
    void reload(userId, selectedId);
  }, [userId, selectedId, reload]);

  async function createPlan() {
    if (!userId) return;
    setBusy(true);
    const res = await saveTripPlan(userId, {
      title: title || destination,
      destination,
      startDate: startDate || null,
      endDate: endDate || null,
    });
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setTitle("");
    setSelectedId(res.plan.id);
    await reload(userId, res.plan.id);
  }

  async function runSearch() {
    setBusy(true);
    setOffers([]);
    setSearchUrl(null);
    const res = await fetch("/api/travel/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        kind === "hotel"
          ? { kind, city: target, checkIn: startDate, checkOut: endDate, adults: 1 }
          : kind === "tour"
            ? { kind, destination: target, departureCity: origin, dateFrom: startDate, dateTo: endDate, adults: 1 }
            : { kind, origin, destination: target, departDate: startDate, returnDate: endDate || undefined }
      ),
    });
    const json = (await res.json()) as {
      error?: string;
      note?: string;
      searchUrl?: string | null;
      offers?: Record<string, unknown>[];
    };
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Поиск не удался");
      return;
    }
    setNote(json.note ?? "");
    setSearchUrl(json.searchUrl ?? null);
    setOffers(
      (json.offers ?? []).map((row) => ({
        id: String(row.id ?? ""),
        title: String(row.hotel ?? row.name ?? `${row.origin ?? ""} → ${row.destination ?? ""}`),
        detail: [row.airline, row.region, row.operator, row.departsAt].filter(Boolean).join(" · "),
        priceRub: typeof row.priceRub === "number" ? row.priceRub : null,
        url: typeof row.url === "string" ? row.url : null,
        kind,
        startsAt: startDate || null,
        endsAt: endDate || null,
      }))
    );
  }

  async function keep(offer: Offer) {
    if (!userId) return;
    const res = await saveTravelBooking(userId, {
      tripPlanId: selectedId,
      kind: offer.kind,
      title: offer.title,
      priceRub: offer.priceRub,
      url: offer.url,
      startsAt: offer.startsAt,
      endsAt: offer.endsAt,
      status: "draft",
    });
    if ("error" in res) {
      setError(res.error);
      return;
    }
    await reload(userId, selectedId);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4">
      <header className="flex items-center gap-2">
        <Plane className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Поездки</h1>
      </header>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Новый план</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Input className={fieldClass} placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input className={fieldClass} placeholder="Куда" value={destination} onChange={(e) => setDestination(e.target.value)} />
          <Input className={fieldClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input className={fieldClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <Button disabled={busy || !destination.trim()} onClick={() => void createPlan()}>
            Сохранить план
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelectedId(plan.id)}
            className={`rounded-full border px-3 py-1 text-sm ${
              plan.id === selectedId ? "border-primary text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {plan.destination}
            {plan.startDate ? ` · ${plan.startDate}` : ""}
          </button>
        ))}
        {plans.length === 0 && <p className="text-sm text-muted-foreground">Планов пока нет.</p>}
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected.title} · {selected.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {bookings.length === 0 && <p className="text-muted-foreground">В этом плане ещё нет билетов и отелей.</p>}
            {bookings.map((b) => (
              <div key={b.id} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
                <span>
                  {b.kind}: {b.title} · {b.status}
                </span>
                <span className="shrink-0 text-muted-foreground">{rub(b.priceRub)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Поиск</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex gap-2">
            {(["flight", "hotel", "tour"] as const).map((item) => (
              <Button key={item} variant={kind === item ? "default" : "outline"} onClick={() => setKind(item)}>
                {item === "flight" ? "Билеты" : item === "hotel" ? "Отели" : "Туры"}
              </Button>
            ))}
          </div>
          {kind !== "hotel" && (
            <Input className={fieldClass} placeholder="Откуда" value={origin} onChange={(e) => setOrigin(e.target.value)} />
          )}
          <Input
            className={fieldClass}
            placeholder={kind === "tour" ? "Страна" : "Куда"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Button disabled={busy || !target.trim() || !startDate} onClick={() => void runSearch()}>
            {busy ? "Ищу…" : "Найти"}
          </Button>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
          {searchUrl && (
            <a className="text-sm text-primary underline" href={searchUrl} target="_blank" rel="noreferrer">
              Открыть поиск у провайдера
            </a>
          )}
          {offers.map((offer) => (
            <div key={offer.id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <div>{offer.title}</div>
                <div className="text-muted-foreground">{offer.detail || rub(offer.priceRub)}</div>
              </div>
              <Button variant="outline" disabled={!selectedId} onClick={() => void keep(offer)}>
                В план
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
