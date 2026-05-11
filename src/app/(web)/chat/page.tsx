"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, Plus, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";

type Bubble =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; steps?: AssistantStep[] }
  | { role: "error"; text: string };

type AssistantStep = {
  iteration: number;
  modelUsed: string;
  toolCalls: { name: string; args: string; ok: boolean; payload: unknown }[];
};

const CONV_KEY = "personal_agent_chat_conversation_id";

function genUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const SUGGESTIONS = [
  "Что было на последней силовой?",
  "Динамика жима лёжа за всё время",
  "Сколько тренировок я сделал в этом месяце?",
  "Какие у меня BMR/TDEE сейчас?",
];

export default function ChatPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userIdError, setUserIdError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stored = window.localStorage.getItem(CONV_KEY);
    if (!stored) {
      stored = genUuid();
      window.localStorage.setItem(CONV_KEY, stored);
    }
    setConversationId(stored);

    (async () => {
      const r = await getWorkoutUserId();
      if ("error" in r) setUserIdError(r.error);
      else setUserId(r.userId);
    })();
  }, []);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [bubbles]);

  const canSend = useMemo(
    () => !pending && userId && conversationId && input.trim().length > 0,
    [pending, userId, conversationId, input]
  );

  function newChat() {
    const id = genUuid();
    window.localStorage.setItem(CONV_KEY, id);
    setConversationId(id);
    setBubbles([]);
  }

  async function send() {
    const text = input.trim();
    if (!text || !userId) return;
    setInput("");
    setBubbles((b) => [...b, { role: "user", text }]);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, conversationId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBubbles((b) => [
          ...b,
          { role: "error", text: data?.error ?? `HTTP ${res.status}` },
        ]);
      } else {
        const steps: AssistantStep[] = (data.steps ?? []).map((s: {
          iteration: number;
          modelUsed: string;
          toolCalls: { name: string; args: string; result: { ok: boolean; payload: unknown } }[];
        }) => ({
          iteration: s.iteration,
          modelUsed: s.modelUsed,
          toolCalls: (s.toolCalls ?? []).map((tc) => ({
            name: tc.name,
            args: tc.args,
            ok: tc.result?.ok ?? false,
            payload: tc.result?.payload,
          })),
        }));
        setBubbles((b) => [
          ...b,
          { role: "assistant", text: data.finalAnswer ?? "", steps },
        ]);
      }
    } catch (e) {
      setBubbles((b) => [
        ...b,
        { role: "error", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setPending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) void send();
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15">
            <MessageSquare className="size-5 text-primary" />
          </div>
          <h1 className="text-lg font-semibold">Чат с Jarvis</h1>
        </div>
        <Button variant="outline" size="sm" onClick={newChat} disabled={pending}>
          <Plus className="size-4" /> Новый чат
        </Button>
      </div>

      {userIdError && (
        <Card>
          <CardContent className="py-3 text-sm text-destructive">
            {userIdError}
          </CardContent>
        </Card>
      )}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto rounded-lg border bg-card p-3 space-y-3"
      >
        {bubbles.length === 0 && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Готов помочь с тренировками, прогрессом и питанием. Все данные приложения у меня под рукой.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {bubbles.map((b, i) => (
          <ChatBubble key={i} bubble={b} />
        ))}

        {pending && (
          <div className="text-xs text-muted-foreground italic">Думаю…</div>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Спроси про тренировки, прогресс, питание…"
          disabled={pending || !userId}
        />
        <Button onClick={send} disabled={!canSend}>
          <Send className="size-4" /> Отправить
        </Button>
      </div>
    </div>
  );
}

function ChatBubble({ bubble }: { bubble: Bubble }) {
  if (bubble.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">
          {bubble.text}
        </div>
      </div>
    );
  }
  if (bubble.role === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
          Ошибка: {bubble.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">
        {bubble.steps && bubble.steps.some((s) => s.toolCalls.length > 0) && (
          <ToolTrace steps={bubble.steps} />
        )}
        <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {bubble.text}
        </div>
      </div>
    </div>
  );
}

function ToolTrace({ steps }: { steps: AssistantStep[] }) {
  const [open, setOpen] = useState(false);
  const totalCalls = steps.reduce((a, s) => a + s.toolCalls.length, 0);
  return (
    <div className="rounded-xl border bg-card text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Wrench className="size-3" />
        Tool calls: {totalCalls}
        <span className="ml-auto">{steps[steps.length - 1]?.modelUsed}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {steps.map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Шаг {s.iteration} · {s.modelUsed}
              </div>
              {s.toolCalls.map((tc, j) => (
                <details key={j} className="rounded-md bg-muted/50 px-2 py-1">
                  <summary
                    className={`cursor-pointer font-mono ${
                      tc.ok ? "text-foreground" : "text-destructive"
                    }`}
                  >
                    {tc.name}
                    {!tc.ok && " (error)"}
                  </summary>
                  <div className="mt-1 space-y-1">
                    <div>
                      <div className="text-muted-foreground">args:</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                        {tc.args}
                      </pre>
                    </div>
                    <div>
                      <div className="text-muted-foreground">result:</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(tc.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
