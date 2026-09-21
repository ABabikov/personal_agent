"use client";

import { useState } from "react";
import type { MaxChatOption, MaxSessionStatus } from "@/lib/integrations/max/types";

type Props = {
  status: MaxSessionStatus;
  onReady: () => Promise<void>;
};

export function KidsMaxConnect({ status, onReady }: Props) {
  const [password, setPassword] = useState("");
  const [maxLink, setMaxLink] = useState<string | null>(null);
  const [chats, setChats] = useState<MaxChatOption[]>([]);
  const [boyChatId, setBoyChatId] = useState(status.boyChatId);
  const [girlChatId, setGirlChatId] = useState(status.girlChatId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status.connected || chats.length > 0;

  function openMax(link: string) {
    const tg = (
      window as unknown as {
        Telegram?: { WebApp?: { openLink?: (url: string) => void } };
      }
    ).Telegram?.WebApp;
    if (tg?.openLink) tg.openLink(link);
    else window.open(link, "_blank");
  }

  async function bindViaPhoneSession() {
    setBusy("link");
    setError(null);
    setMaxLink(null);
    try {
      const res = await fetch("/api/kids/max-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", password }),
      });
      if (!res.body) throw new Error("Нет ответа от сервера");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((row) => row.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type?: string;
            link?: string;
            error?: string;
            chats?: MaxChatOption[];
          };
          if (event.type === "link" && event.link) {
            setMaxLink(event.link);
            openMax(event.link);
          }
          if (event.type === "ok") setChats(event.chats ?? []);
          if (event.type === "error") throw new Error(event.error ?? "Не удалось привязать Max");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось привязать Max");
    } finally {
      setBusy(null);
    }
  }

  async function loadChats() {
    setBusy("chats");
    setError(null);
    try {
      const res = await fetch("/api/kids/max-chats", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; error?: string; chats?: MaxChatOption[] };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Не удалось получить чаты");
      setChats(json.chats ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить чаты");
    } finally {
      setBusy(null);
    }
  }

  async function saveChats() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch("/api/kids/max-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boyChatId, girlChatId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Не сохранилось");
      await onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не сохранилось");
    } finally {
      setBusy(null);
    }
  }

  if (status.needMigration) {
    return (
      <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
        Примените миграцию <code>018_kid_max_session.sql</code> в Supabase, затем откройте вкладку ещё раз.
      </div>
    );
  }

  if (connected && (chats.length > 0 || !status.boyChatId || !status.girlChatId)) {
    return (
      <section className="space-y-3 rounded-2xl bg-white p-3 shadow-sm">
        <h2 className="text-base font-semibold">Какой чат чей</h2>
        <p className="text-sm text-stone-500">
          {status.ownerName ? `Вошли как ${status.ownerName}. ` : null}
          Выберите два классных чата.
        </p>
        {chats.length === 0 ? (
          <button
            type="button"
            onClick={() => void loadChats()}
            disabled={busy !== null}
            className="rounded-2xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy === "chats" ? "Загружаю чаты…" : "Показать чаты Max"}
          </button>
        ) : (
          <>
            <label className="block text-sm">
              <span className="mb-1 block text-stone-500">Мальчик</span>
              <select
                value={boyChatId}
                onChange={(e) => setBoyChatId(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <option value="">не выбран</option>
                {chats.map((chat) => (
                  <option key={`b-${chat.id}`} value={chat.id}>
                    {chat.title}
                    {chat.participants != null ? ` · ${chat.participants}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-stone-500">Девочка</span>
              <select
                value={girlChatId}
                onChange={(e) => setGirlChatId(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <option value="">не выбран</option>
                {chats.map((chat) => (
                  <option key={`g-${chat.id}`} value={chat.id}>
                    {chat.title}
                    {chat.participants != null ? ` · ${chat.participants}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void saveChats()}
              disabled={busy !== null || !boyChatId || !girlChatId}
              className="w-full rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy === "save" ? "Сохраняю…" : "Подтянуть сообщения"}
            </button>
          </>
        )}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-3 shadow-sm">
      <h2 className="text-base font-semibold">Подключить Max</h2>
      <p className="text-sm text-stone-500">
        Привязка к уже открытому Max на этом телефоне. Нажмите кнопку, подтвердите вход в Max и вернитесь сюда. На это есть около минуты.
      </p>

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">Облачный пароль, если Max его спросит</span>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
        />
      </label>

      <button
        type="button"
        onClick={() => void bindViaPhoneSession()}
        disabled={busy !== null}
        className="w-full rounded-2xl bg-stone-900 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy === "link" ? "Жду подтверждение в Max…" : "Подтвердить в открытом Max"}
      </button>

      {maxLink ? (
        <a
          href={maxLink}
          onClick={(event) => {
            event.preventDefault();
            openMax(maxLink);
          }}
          className="block text-center text-sm font-medium text-sky-800 underline"
        >
          Если Max не открылся — нажмите здесь
        </a>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
