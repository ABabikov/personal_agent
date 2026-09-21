"use client";

import { useState } from "react";
import type { MaxChatOption, MaxSessionStatus } from "@/lib/integrations/max/types";

type Props = {
  status: MaxSessionStatus;
  onReady: () => Promise<void>;
};

export function KidsMaxConnect({ status, onReady }: Props) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [chats, setChats] = useState<MaxChatOption[]>([]);
  const [boyChatId, setBoyChatId] = useState(status.boyChatId);
  const [girlChatId, setGirlChatId] = useState(status.girlChatId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status.connected || chats.length > 0;

  async function postLogin(body: Record<string, string>) {
    const res = await fetch("/api/kids/max-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; chats?: MaxChatOption[] };
    if (!res.ok || json.ok === false) throw new Error(json.error ?? "Max не ответил");
    if (json.chats) setChats(json.chats);
    return json;
  }

  async function sendSms() {
    setBusy("sms");
    setError(null);
    try {
      await postLogin({ action: "phone", phone });
      setSmsSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SMS не отправилась");
    } finally {
      setBusy(null);
    }
  }

  async function verifySms() {
    setBusy("verify");
    setError(null);
    try {
      await postLogin({ action: "verify", code, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Код не подошёл");
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
        Введите номер, на который зарегистрирован Max. Код придёт в SMS — после входа выберите два классных чата.
      </p>

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">Телефон</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7…"
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
        />
      </label>
      {smsSent ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-stone-500">Код из SMS</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-stone-500">Облачный пароль, если Max его спросит</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
            />
          </label>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => void (smsSent ? verifySms() : sendSms())}
        disabled={busy !== null || (!smsSent && phone.trim().length < 10) || (smsSent && code.trim().length < 4)}
        className="w-full rounded-2xl bg-stone-900 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy === "sms" || busy === "verify" ? "Жду Max…" : smsSent ? "Войти" : "Выслать SMS"}
      </button>

      {smsSent ? (
        <button
          type="button"
          onClick={() => void sendSms()}
          disabled={busy !== null}
          className="w-full text-sm text-stone-500 underline disabled:opacity-60"
        >
          Отправить код ещё раз
        </button>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
