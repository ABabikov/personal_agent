"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";
import {
  addNearbyInterest,
  deleteNearbyInterest,
  hideNearbyEvent,
  loadNearby,
  saveNearbyCity,
  setNearbyInterestEnabled,
} from "@/lib/db/nearby";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import { NEARBY_CITIES } from "@/lib/features/nearby/cities";
import type { NearbyEventView, NearbyInterestView, NearbySettingsView } from "@/lib/features/nearby/types";

const fieldClass =
  "h-8 w-full rounded-lg border border-glow-primary/30 bg-card/30 px-2.5 text-sm outline-none focus-visible:border-glow-primary/60";

function formatStarts(iso: string | null): string {
  if (!iso) return "дата не указана";
  const date = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" }).format(date);
}

function formatRefreshed(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function NearbyPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<NearbySettingsView | null>(null);
  const [interests, setInterests] = useState<NearbyInterestView[]>([]);
  const [events, setEvents] = useState<NearbyEventView[]>([]);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [draftInterest, setDraftInterest] = useState("");

  const summary = useMemo(() => {
    const city = settings?.cityLabel ?? "город не выбран";
    const labels = interests.filter((interest) => interest.enabled).map((interest) => interest.label);
    const nearest = events[0]?.title;
    return `Город: ${city}. Интересы: ${labels.join(", ") || "нет"}. В ленте ${events.length}. ${
      nearest ? `Ближайшее: ${nearest}.` : ""
    }`;
  }, [settings?.cityLabel, interests, events]);

  useRegisterPageChatContext("Рядом", summary);

  const reload = useCallback(async (uid: string) => {
    const loaded = await loadNearby(uid);
    if ("error" in loaded) {
      setError(loaded.error);
      return;
    }
    setError(null);
    setSettings(loaded.feed.settings);
    setInterests(loaded.feed.interests);
    setEvents(loaded.feed.events);
    setStale(loaded.feed.stale);
    setCustomOpen(!loaded.feed.settings.citySlug && Boolean(loaded.feed.settings.cityLabel));
    setCustomLabel(loaded.feed.settings.citySlug ? "" : (loaded.feed.settings.cityLabel ?? ""));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getWorkoutUserId().then(async (result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setUserId(result.userId);
      await reload(result.userId);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function persistCity(slug: string | null, label: string | null) {
    if (!userId) return;
    const saved = await saveNearbyCity(userId, slug, label);
    if ("error" in saved) {
      setError(saved.error);
      return;
    }
    await reload(userId);
  }

  async function refresh() {
    if (!userId) return;
    setRefreshing(true);
    setError(null);
    setNotes([]);
    try {
      const res = await fetch("/api/nearby/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = (await res.json()) as { error?: string; notes?: string[]; feed?: { events: NearbyEventView[] } };
      if (!res.ok || json.error) {
        setError(json.error ?? "Не удалось обновить ленту.");
        return;
      }
      setNotes(json.notes ?? []);
      await reload(userId);
    } catch {
      setError("Не удалось обновить ленту.");
    } finally {
      setRefreshing(false);
    }
  }

  async function addInterest() {
    if (!userId) return;
    const saved = await addNearbyInterest(userId, draftInterest);
    if ("error" in saved) {
      setError(saved.error);
      return;
    }
    setDraftInterest("");
    await reload(userId);
  }

  const enabledCount = interests.filter((interest) => interest.enabled).length;
  const canRefresh = Boolean(settings?.cityLabel) && enabledCount > 0 && !refreshing;
  const selectValue = customOpen ? "custom" : (settings?.citySlug ?? "");

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold">Рядом</h1>
        <p className="text-sm text-muted-foreground">
          События в выбранном городе на {settings?.horizonDays ?? 21} дней: фестивали, старты, забеги. Короткий разбор и ссылка.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Город</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <select
            className={fieldClass}
            value={selectValue}
            disabled={loading || !userId}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "custom") {
                setCustomOpen(true);
                return;
              }
              setCustomOpen(false);
              const city = NEARBY_CITIES.find((item) => item.slug === value);
              if (city) void persistCity(city.slug, city.label);
            }}
          >
            <option value="">Выбери город</option>
            {NEARBY_CITIES.map((city) => (
              <option key={city.slug} value={city.slug}>
                {city.label}
              </option>
            ))}
            <option value="custom">Другой город</option>
          </select>
          {customOpen ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void persistCity(null, customLabel);
              }}
            >
              <Input
                value={customLabel}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder="Название города"
              />
              <Button type="submit" disabled={!userId || customLabel.trim().length < 2}>
                Сохранить
              </Button>
            </form>
          ) : null}
          <p className="text-xs text-muted-foreground">Пока это весь город, без радиуса в километрах.</p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Интересы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {interests.map((interest) => (
              <span key={interest.id} className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={interest.enabled ? "default" : "outline"}
                  disabled={!userId}
                  onClick={() =>
                    userId &&
                    void setNearbyInterestEnabled(userId, interest.id, !interest.enabled).then((result) => {
                      if ("error" in result) setError(result.error);
                      else void reload(userId);
                    })
                  }
                >
                  {interest.label}
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Удалить ${interest.label}`}
                  disabled={!userId}
                  onClick={() =>
                    userId &&
                    void deleteNearbyInterest(userId, interest.id).then((result) => {
                      if ("error" in result) setError(result.error);
                      else void reload(userId);
                    })
                  }
                >
                  <X />
                </Button>
              </span>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addInterest();
            }}
          >
            <Input
              value={draftInterest}
              onChange={(event) => setDraftInterest(event.target.value)}
              placeholder="Например, открытая вода"
            />
            <Button type="submit" disabled={!userId || draftInterest.trim().length < 2}>
              Добавить
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" disabled={!canRefresh} onClick={() => void refresh()}>
          {refreshing ? "Ищу события…" : "Обновить ленту"}
        </Button>
        {settings?.refreshedAt ? (
          <span className="text-xs text-muted-foreground">
            {stale ? "Старше 12 часов · " : ""}
            {formatRefreshed(settings.refreshedAt)}
          </span>
        ) : null}
      </div>

      {settings?.lastDigest ? (
        <Card size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Что стоит внимания</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{settings.lastDigest}</p>
          </CardContent>
        </Card>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Загружаю…</p> : null}

      {!loading && settings?.cityLabel && events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Лента пустая. Нажми «Обновить ленту» — соберу события по включённым интересам.
        </p>
      ) : null}

      {events.map((event) => (
        <Card key={event.id} size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base leading-snug">{event.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {formatStarts(event.startsOn)}
              {event.place ? ` · ${event.place}` : ""}
              {event.interestLabel ? ` · ${event.interestLabel}` : ""}
            </p>
            {event.why ? <p className="text-sm leading-relaxed">{event.why}</p> : null}
            <div className="flex items-center justify-between gap-2">
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                Подробнее
                <ExternalLink className="size-3.5" />
              </a>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!userId}
                onClick={() =>
                  userId &&
                  void hideNearbyEvent(userId, event.id).then((result) => {
                    if ("error" in result) setError(result.error);
                    else setEvents((current) => current.filter((item) => item.id !== event.id));
                  })
                }
              >
                Не интересно
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
