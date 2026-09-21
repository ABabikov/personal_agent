"use client";

import { useState } from "react";
import { WEEKDAYS, type KidId } from "@/lib/features/kids-schedule/config";
import { todayInfo } from "@/lib/features/kids-schedule/dates";

export type AddKind = "lesson" | "activity" | "homework" | "grade";

type Props = {
  childId: KidId;
  onClose: () => void;
  onCreate: (kind: AddKind, payload: Record<string, string>) => Promise<void>;
};

const KINDS: { id: AddKind; label: string }[] = [
  { id: "lesson", label: "Урок" },
  { id: "activity", label: "Кружок" },
  { id: "homework", label: "ДЗ" },
  { id: "grade", label: "Оценка" },
];

export function KidsAddSheet({ childId, onClose, onCreate }: Props) {
  const today = todayInfo();
  const [kind, setKind] = useState<AddKind>("lesson");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    weekday: String(today.weekday),
    date: today.iso,
    start: "08:30",
    end: "09:15",
    subject: "",
    room: "",
    title: "",
    place: "",
    value: "5",
    comment: "",
    recurring: "1",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(kind, { ...form, childId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <button className="absolute inset-0" aria-label="Закрыть" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#fbf8f1] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">
            Добавить · {childId === "boy" ? "мальчик" : "девочка"}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-stone-500">
            Закрыть
          </button>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-stone-200/70 p-1">
          {KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setKind(item.id)}
              className={`rounded-xl px-1 py-2 text-xs font-medium ${
                kind === item.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {(kind === "lesson" || (kind === "activity" && form.recurring === "1")) && (
            <Field label="День">
              <select
                className="kids-input"
                value={form.weekday}
                onChange={(e) => set("weekday", e.target.value)}
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.id} value={day.id}>
                    {day.full}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {kind === "activity" && (
            <Field label="Повтор">
              <select
                className="kids-input"
                value={form.recurring}
                onChange={(e) => set("recurring", e.target.value)}
              >
                <option value="1">Каждую неделю</option>
                <option value="0">Разово, на дату</option>
              </select>
            </Field>
          )}

          {(kind === "homework" ||
            kind === "grade" ||
            (kind === "activity" && form.recurring === "0")) && (
            <Field label={kind === "homework" ? "Сдать" : "Дата"}>
              <input
                type="date"
                className="kids-input"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
          )}

          {(kind === "lesson" || kind === "activity") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="С">
                <input
                  type="time"
                  className="kids-input"
                  value={form.start}
                  onChange={(e) => set("start", e.target.value)}
                />
              </Field>
              <Field label="До">
                <input
                  type="time"
                  className="kids-input"
                  value={form.end}
                  onChange={(e) => set("end", e.target.value)}
                />
              </Field>
            </div>
          )}

          {kind !== "activity" && (
            <Field label="Предмет">
              <input
                className="kids-input"
                value={form.subject}
                onChange={(e) => set("subject", e.target.value)}
                required
                placeholder="Математика"
              />
            </Field>
          )}

          {kind === "lesson" && (
            <Field label="Кабинет">
              <input
                className="kids-input"
                value={form.room}
                onChange={(e) => set("room", e.target.value)}
                placeholder="214"
              />
            </Field>
          )}

          {kind === "activity" && (
            <>
              <Field label="Название">
                <input
                  className="kids-input"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  required
                  placeholder="Плавание"
                />
              </Field>
              <Field label="Место">
                <input
                  className="kids-input"
                  value={form.place}
                  onChange={(e) => set("place", e.target.value)}
                  placeholder="Бассейн"
                />
              </Field>
            </>
          )}

          {kind === "homework" && (
            <Field label="Задание">
              <input
                className="kids-input"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                required
                placeholder="стр. 42, №5–8"
              />
            </Field>
          )}

          {kind === "grade" && (
            <>
              <Field label="Оценка">
                <input
                  className="kids-input"
                  value={form.value}
                  onChange={(e) => set("value", e.target.value)}
                  required
                />
              </Field>
              <Field label="Комментарий">
                <input
                  className="kids-input"
                  value={form.comment}
                  onChange={(e) => set("comment", e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-stone-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
