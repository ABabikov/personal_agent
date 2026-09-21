"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, MessageCircle, Plus, Sun } from "lucide-react";
import {
  deleteKidItem,
  insertKidActivity,
  insertKidGrade,
  insertKidHomework,
  insertKidLesson,
  loadKidsState,
  setKidHomeworkDone,
  type KidsState,
} from "@/lib/db/kidsSchedule";
import { KIDS, WEEKDAYS, type KidId } from "@/lib/features/kids-schedule/config";
import {
  addDaysIso,
  formatLongDate,
  hhmm,
  todayInfo,
  weekStartMonday,
} from "@/lib/features/kids-schedule/dates";
import { KidsAddSheet, type AddKind } from "./kids-add-sheet";

type Tab = "today" | "week" | "chats";

const empty: KidsState = {
  lessons: [],
  activities: [],
  homework: [],
  grades: [],
  messages: [],
};

export function KidsApp() {
  const [kid, setKid] = useState<KidId>("boy");
  const [tab, setTab] = useState<Tab>("today");
  const [state, setState] = useState<KidsState>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const today = useMemo(() => todayInfo(), []);

  const reload = useCallback(async () => {
    try {
      setState(await loadKidsState());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("kids_selected");
    if (stored === "boy" || stored === "girl") setKid(stored);
    void reload();
  }, [reload]);

  function selectKid(next: KidId) {
    setKid(next);
    window.localStorage.setItem("kids_selected", next);
    haptic();
  }

  async function onCreate(kind: AddKind, payload: Record<string, string>) {
    const childId = kid;
    if (kind === "lesson") {
      await insertKidLesson({
        childId,
        weekday: Number(payload.weekday),
        start: payload.start,
        end: payload.end,
        subject: payload.subject,
        room: payload.room,
      });
    }
    if (kind === "activity") {
      await insertKidActivity({
        childId,
        weekday: payload.recurring === "1" ? Number(payload.weekday) : undefined,
        date: payload.recurring === "0" ? payload.date : undefined,
        start: payload.start,
        end: payload.end,
        title: payload.title,
        place: payload.place,
      });
    }
    if (kind === "homework") {
      await insertKidHomework({
        childId,
        subject: payload.subject,
        title: payload.title,
        dueDate: payload.date,
      });
    }
    if (kind === "grade") {
      await insertKidGrade({
        childId,
        subject: payload.subject,
        value: payload.value,
        date: payload.date,
        comment: payload.comment,
      });
    }
    await reload();
  }

  const dayItems = useMemo(
    () => collectDay(state, kid, today.weekday, today.iso),
    [state, kid, today],
  );
  const weekDays = useMemo(() => {
    const start = weekStartMonday(today.iso);
    return WEEKDAYS.map((day, index) => {
      const iso = addDaysIso(start, index);
      return { ...day, iso, items: collectDay(state, kid, day.id, iso) };
    });
  }, [state, kid, today.iso]);

  const homework = state.homework.filter((row) => row.child_id === kid);
  const grades = state.grades.filter((row) => row.child_id === kid).slice(0, 12);
  const messages = state.messages.filter((row) => row.child_id === kid);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-[#f3efe6] text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-[#f3efe6]/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          Расписание
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(Object.keys(KIDS) as KidId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => selectKid(id)}
              className={`rounded-2xl px-3 py-2.5 text-sm font-semibold ${
                kid === id
                  ? id === "boy"
                    ? "bg-sky-700 text-white"
                    : "bg-rose-700 text-white"
                  : "bg-white text-stone-700 shadow-sm"
              }`}
            >
              {KIDS[id].label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        {loading ? <p className="text-sm text-stone-500">Загружаю…</p> : null}
        {error ? (
          <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">
            {error.includes("Could not find") || error.includes("relation")
              ? "Таблицы ещё не созданы. Примените миграцию 017_kids_schedule.sql в Supabase."
              : error}
          </div>
        ) : null}

        {tab === "today" && !loading ? (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold capitalize">{formatLongDate(today.iso)}</h1>
            {dayItems.length === 0 ? (
              <Empty text="На сегодня ничего нет — добавьте урок или кружок." />
            ) : (
              <ul className="space-y-2">
                {dayItems.map((item) => (
                  <li key={item.key} className="rounded-2xl bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-stone-500">
                          {item.start}–{item.end} · {item.kindLabel}
                        </p>
                        <p className="text-base font-semibold">{item.title}</p>
                        {item.meta ? <p className="text-sm text-stone-500">{item.meta}</p> : null}
                      </div>
                      <button
                        type="button"
                        className="text-xs text-stone-400"
                        onClick={() => void deleteKidItem(item.type, item.id).then(reload)}
                      >
                        удалить
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <h2 className="mb-2 text-sm font-semibold text-stone-600">Домашнее задание</h2>
              {homework.length === 0 ? (
                <Empty text="ДЗ пока нет." />
              ) : (
                <ul className="space-y-2">
                  {homework.map((row) => (
                    <li key={row.id} className="flex items-start gap-3 rounded-2xl bg-white p-3 shadow-sm">
                      <input
                        type="checkbox"
                        checked={row.done}
                        onChange={() => void setKidHomeworkDone(row.id, !row.done).then(reload)}
                        className="mt-1 size-4"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium ${row.done ? "text-stone-400 line-through" : ""}`}>
                          {row.subject}
                        </p>
                        <p className="text-sm text-stone-600">{row.title}</p>
                        <p className="text-xs text-stone-400">к {row.due_date}</p>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-stone-400"
                        onClick={() => void deleteKidItem("homework", row.id).then(reload)}
                      >
                        удалить
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-stone-600">Оценки</h2>
              {grades.length === 0 ? (
                <Empty text="Оценок ещё нет." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {grades.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => void deleteKidItem("grade", row.id).then(reload)}
                      className="rounded-2xl bg-white px-3 py-2 text-left shadow-sm"
                    >
                      <span className="text-lg font-bold">{row.value}</span>
                      <span className="ml-2 text-sm text-stone-600">{row.subject}</span>
                      <p className="text-[11px] text-stone-400">{row.graded_on}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "week" && !loading ? (
          <section className="space-y-3">
            {weekDays.map((day) => (
              <div key={day.id} className="rounded-2xl bg-white p-3 shadow-sm">
                <p className="text-sm font-semibold">
                  {day.full}
                  <span className="ml-2 text-xs font-normal text-stone-400">{day.iso.slice(8)}</span>
                </p>
                {day.items.length === 0 ? (
                  <p className="mt-1 text-sm text-stone-400">пусто</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {day.items.map((item) => (
                      <li key={item.key} className="flex justify-between gap-2 text-sm">
                        <span>
                          <span className="text-stone-500">
                            {item.start} {item.kindLabel} ·{" "}
                          </span>
                          {item.title}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-stone-400"
                          onClick={() => void deleteKidItem(item.type, item.id).then(reload)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        ) : null}

        {tab === "chats" && !loading ? (
          <section className="space-y-3">
            <h1 className="text-xl font-semibold">{KIDS[kid].chatLabel}</h1>
            {messages.length === 0 ? (
              <Empty text="Пока пусто. Сюда лягут сообщения из Max, когда подключим зеркало двух чатов." />
            ) : (
              <ul className="space-y-2">
                {messages.map((row) => (
                  <li key={row.id} className="rounded-2xl bg-white p-3 shadow-sm">
                    <p className="text-xs font-medium text-stone-500">
                      {row.from_name || "без имени"} · {row.sent_at.slice(0, 16).replace("T", " ")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{row.body || " "}</p>
                    {row.attachments.length > 0 ? (
                      <p className="mt-1 text-xs text-stone-500">
                        {row.attachments.map((file) => file.name).join(", ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-stone-200 bg-[#f3efe6]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="grid grid-cols-4 gap-1">
          <TabButton active={tab === "today"} onClick={() => setTab("today")} icon={<Sun className="size-5" />} label="Сегодня" />
          <TabButton active={tab === "week"} onClick={() => setTab("week")} icon={<CalendarDays className="size-5" />} label="Неделя" />
          <TabButton active={tab === "chats"} onClick={() => setTab("chats")} icon={<MessageCircle className="size-5" />} label="Чаты" />
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex flex-col items-center gap-0.5 rounded-2xl bg-stone-900 py-2 text-[11px] font-medium text-white"
          >
            <Plus className="size-5" />
            Добавить
          </button>
        </div>
      </nav>

      {adding ? (
        <KidsAddSheet childId={kid} onClose={() => setAdding(false)} onCreate={onCreate} />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-medium ${
        active ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl bg-white/70 px-3 py-4 text-sm text-stone-500">{text}</p>;
}

type DayItem = {
  key: string;
  id: string;
  type: "lesson" | "activity";
  kindLabel: string;
  start: string;
  end: string;
  title: string;
  meta?: string;
};

function collectDay(state: KidsState, kid: KidId, weekday: number, iso: string): DayItem[] {
  const lessons = state.lessons
    .filter((row) => row.child_id === kid && row.weekday === weekday)
    .map((row) => ({
      key: `l-${row.id}`,
      id: row.id,
      type: "lesson" as const,
      kindLabel: "урок",
      start: hhmm(row.start_time),
      end: hhmm(row.end_time),
      title: row.subject,
      meta: row.room ? `каб. ${row.room}` : undefined,
    }));
  const activities = state.activities
    .filter(
      (row) =>
        row.child_id === kid &&
        (row.on_date === iso || (row.weekday === weekday && !row.on_date)),
    )
    .map((row) => ({
      key: `a-${row.id}`,
      id: row.id,
      type: "activity" as const,
      kindLabel: "кружок",
      start: hhmm(row.start_time),
      end: hhmm(row.end_time),
      title: row.title,
      meta: row.place || undefined,
    }));
  return [...lessons, ...activities].sort((a, b) => a.start.localeCompare(b.start));
}

function haptic() {
  const tg = (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { selectionChanged?: () => void } } } })
    .Telegram?.WebApp;
  tg?.HapticFeedback?.selectionChanged?.();
}
