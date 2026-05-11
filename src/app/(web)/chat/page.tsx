"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, Plus, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import { usePageChatContext, useRegisterPageChatContext } from "@/contexts/page-chat-context";
import { buildPageContextPayload } from "@/lib/chat/pageContext";
import {
  ChatBubbleView,
  type AssistantStep,
  type ChatBubble,
} from "@/components/chat/chat-message-view";

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
  const { pathname, pageTitle, pageSummary } = usePageChatContext();

  useRegisterPageChatContext(
    "Чат с Jarvis",
    "Полноэкранный режим переписки. Тот же conversation id в localStorage, что у плавающей кнопки чата."
  );

  const pageContextPayload = useMemo(
    () => buildPageContextPayload(pathname, pageTitle, pageSummary),
    [pathname, pageTitle, pageSummary]
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [userIdError, setUserIdError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
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
        body: JSON.stringify({
          userId,
          conversationId,
          message: text,
          pageContext: pageContextPayload,
        }),
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
          <ChatBubbleView key={i} bubble={b} />
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
