"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addTripEvent,
  deleteTripEvent,
  updateTripEvent,
  type TripEvent,
  type TripEventType,
  type TripPlan,
} from "@/lib/db/travel";

const TYPES: { id: TripEventType; label: string }[] = [
  { id: "flight", label: "Перелёт" },
  { id: "hotel", label: "Отель" },
  { id: "activity", label: "Дело" },
  { id: "transport", label: "Дорога" },
];

const fieldClass =
  "h-8 w-full rounded-lg border border-glow-primary/30 bg-card/30 px-2.5 text-sm outline-none focus-visible:border-glow-primary/60";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1);
}

function monthCells(anchor: Date): { iso: string; day: number; inMonth: boolean }[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const total = Math.ceil((firstWeekday + days) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const offset = i - firstWeekday;
    const date =
      offset < 0
        ? new Date(year, month - 1, prevDays + offset + 1)
        : offset >= days
          ? new Date(year, month + 1, offset - days + 1)
          : new Date(year, month, offset + 1);
    cells.push({ iso: isoOf(date), day: date.getDate(), inMonth: offset >= 0 && offset < days });
  }
  return cells;
}

function labelOf(type: TripEventType): string {
  return TYPES.find((item) => item.id === type)?.label ?? "Дело";
}

export function TripSchedule({
  userId,
  plan,
  onChanged,
}: {
  userId: string;
  plan: TripPlan;
  onChanged: () => Promise<void>;
}) {
  const initial = plan.startDate || plan.events[0]?.date || isoOf(new Date());
  const [cursor, setCursor] = useState(() => parseIso(initial));
  const [selected, setSelected] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TripEventType>("activity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marked = useMemo(() => new Set(plan.events.map((event) => event.date)), [plan.events]);
  const dayEvents = plan.events.filter((event) => event.date === selected);
  const cells = monthCells(cursor);

  function fill(event: TripEvent) {
    setEditingId(event.id);
    setSelected(event.date);
    setTitle(event.title);
    setTime(event.time);
    setDuration(String(event.duration));
    setLocation(event.location);
    setDescription(event.description);
    setType(event.type);
  }

  function reset() {
    setEditingId(null);
    setTitle("");
    setTime("");
    setDuration("60");
    setLocation("");
    setDescription("");
    setType("activity");
  }

  async function save() {
    setBusy(true);
    const input = {
      date: selected,
      title,
      time,
      duration: Number(duration) || 60,
      location,
      description,
      type,
    };
    const res = editingId
      ? await updateTripEvent(userId, plan.id, editingId, input)
      : await addTripEvent(userId, plan.id, input);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setError(null);
    reset();
    await onChanged();
  }

  async function remove(event: TripEvent) {
    setBusy(true);
    const res = await deleteTripEvent(userId, plan.id, event.id);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if (editingId === event.id) reset();
    await onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Расписание</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Предыдущий месяц"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="text-sm font-medium capitalize">
            {cursor.toLocaleDateString("ru", { month: "long", year: "numeric" })}
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Следующий месяц"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
          {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            const active = cell.iso === selected;
            const has = marked.has(cell.iso);
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => {
                  setSelected(cell.iso);
                  if (!cell.inMonth) setCursor(parseIso(cell.iso));
                }}
                className={`relative h-9 rounded-md text-sm ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : cell.inMonth
                      ? "hover:bg-muted"
                      : "text-muted-foreground/50"
                }`}
              >
                {cell.day}
                {has && (
                  <span
                    className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${
                      active ? "bg-primary-foreground" : "bg-primary"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <p className="text-sm capitalize text-muted-foreground">
          {parseIso(selected).toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        {dayEvents.length === 0 && <p className="text-sm text-muted-foreground">В этот день пусто.</p>}
        <ul className="space-y-2">
          {dayEvents.map((event) => (
            <li key={event.id} className="rounded-lg border border-border/70 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {event.time || "весь день"} · {event.title}
                </span>
                <span className="text-xs text-muted-foreground">{labelOf(event.type)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {event.duration} мин
                {event.location ? ` · ${event.location}` : ""}
                {event.description ? ` · ${event.description}` : ""}
              </p>
              <div className="mt-1 flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => fill(event)}>
                  Изменить
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(event)}>
                  Удалить
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-2">
          <Input className={fieldClass} placeholder="Что делаем" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input className={fieldClass} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Input
            className={fieldClass}
            type="number"
            min={15}
            step={15}
            placeholder="Минуты"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          <select className={fieldClass} value={type} onChange={(e) => setType(e.target.value as TripEventType)}>
            {TYPES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <Input
            className={fieldClass}
            placeholder="Место"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Input
            className={fieldClass}
            placeholder="Заметка"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={busy || !title.trim()} onClick={() => void save()}>
            {editingId ? "Сохранить пункт" : "Добавить в день"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={reset}>
              Отмена
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
