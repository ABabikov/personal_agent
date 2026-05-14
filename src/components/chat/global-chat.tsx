"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, Send, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import { usePageChatContext } from "@/contexts/page-chat-context";
import {
  ChatBubbleView,
  type AssistantStep,
  type ChatBubble,
} from "@/components/chat/chat-message-view";
import { cn } from "@/lib/utils";
import { buildPageContextPayload, CHAT_ROUTE_LABELS } from "@/lib/chat/pageContext";
import { fetchChatHistoryFromApi } from "@/lib/chat/storedToBubbles";
import { applyMealPlanFromChatSteps } from "@/lib/chat/mealPlanChatApply";
import { readMealPlanSnapshotForAgent } from "@/lib/features/meal-plan/storage";
import { ChatConversationPicker } from "@/components/chat/chat-conversation-picker";

const CONV_KEY = "personal_agent_chat_conversation_id";

const SUGGESTIONS = [
  "Что здесь важно на этом экране?",
  "Как улучшить план на этой странице?",
  "Сравни с моими прошлыми результатами",
];

function genUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function GlobalChat() {
  const { pathname, pageTitle, pageSummary } = usePageChatContext();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userIdError, setUserIdError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const historyFetchGen = useRef(0);

  const pageContextPayload = useMemo(
    () => buildPageContextPayload(pathname, pageTitle, pageSummary),
    [pathname, pageTitle, pageSummary]
  );

  useEffect(() => {
    (async () => {
      const r = await getWorkoutUserId();
      if ("error" in r) setUserIdError(r.error);
      else setUserId(r.userId);
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const ls = window.localStorage.getItem(CONV_KEY)?.trim() || "";
    const preferred = conversationId.trim() || ls || null;
    const myGen = ++historyFetchGen.current;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const { conversationId: resolved, bubbles: loaded } = await fetchChatHistoryFromApi(
          userId,
          preferred
        );
        if (cancelled || myGen !== historyFetchGen.current) return;
        if (resolved) {
          window.localStorage.setItem(CONV_KEY, resolved);
          setConversationId(resolved);
          setBubbles(loaded);
        } else {
          window.localStorage.removeItem(CONV_KEY);
          setConversationId("");
          setBubbles([]);
        }
      } catch (e) {
        if (cancelled || myGen !== historyFetchGen.current) return;
        setHistoryError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && myGen === historyFetchGen.current) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, conversationId]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [bubbles, open]);

  const canSend = useMemo(
    () =>
      !pending &&
      !historyLoading &&
      userId &&
      conversationId &&
      input.trim().length > 0,
    [pending, historyLoading, userId, conversationId, input]
  );

  function newChat() {
    const id = genUuid();
    window.localStorage.setItem(CONV_KEY, id);
    setConversationId(id);
    setBubbles([]);
  }

  function pickConversation(id: string) {
    if (!id || id === conversationId) return;
    window.localStorage.setItem(CONV_KEY, id);
    setConversationId(id);
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
        body: (() => {
          const snap = readMealPlanSnapshotForAgent();
          return JSON.stringify({
            userId,
            conversationId,
            message: text,
            pageContext: pageContextPayload,
            ...(snap ? { mealPlan: snap } : {}),
          });
        })(),
      });
      const data = await res.json();
      if (!res.ok) {
        setBubbles((b) => [
          ...b,
          { role: "error", text: data?.error ?? `HTTP ${res.status}` },
        ]);
      } else {
        const steps: AssistantStep[] = (data.steps ?? []).map(
          (s: {
            iteration: number;
            modelUsed: string;
            toolCalls: {
              name: string;
              args: string;
              result: { ok: boolean; payload: unknown };
            }[];
          }) => ({
            iteration: s.iteration,
            modelUsed: s.modelUsed,
            toolCalls: (s.toolCalls ?? []).map((tc) => ({
              name: tc.name,
              args: tc.args,
              ok: tc.result?.ok ?? false,
              payload: tc.result?.payload,
            })),
          })
        );
        applyMealPlanFromChatSteps(steps);
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

  const showFab = pathname !== "/chat";

  return (
    <>
      {showFab && (
        <button
          type="button"
          aria-label="Открыть чат Jarvis"
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-24 right-4 z-[60] flex size-14 items-center justify-center rounded-full",
            "bg-primary text-primary-foreground shadow-lg ring-2 ring-background",
            "transition hover:scale-[1.03] active:scale-95"
          )}
        >
          <MessageSquare className="size-6" />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/40 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="global-chat-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Закрыть"
            onClick={() => setOpen(false)}
          />
          <div className="relative mt-auto flex max-h-[min(92dvh,calc(100vh-2rem))] flex-col rounded-t-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id="global-chat-title" className="text-base font-semibold">
                  Jarvis
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  Контекст: {pageTitle || (CHAT_ROUTE_LABELS[pathname] ?? pathname)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <ChatConversationPicker
                  userId={userId}
                  activeConversationId={conversationId}
                  onSelectConversation={pickConversation}
                  disabled={pending}
                  compact
                />
                <Button variant="outline" size="sm" onClick={newChat} disabled={pending}>
                  <Plus className="size-4" /> Новый
                </Button>
                <Link
                  href="/chat"
                  prefetch={false}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setOpen(false)}
                >
                  Полный экран
                </Link>
                <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
                  <X className="size-5" />
                </Button>
              </div>
            </div>

            {userIdError && (
              <p className="px-4 py-2 text-sm text-destructive">{userIdError}</p>
            )}
            {historyError && (
              <p className="px-4 py-2 text-sm text-destructive">{historyError}</p>
            )}

            <div
              ref={scrollerRef}
              className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3"
            >
              {historyLoading && (
                <div className="text-center text-xs text-muted-foreground">Загрузка истории…</div>
              )}
              {!historyLoading && bubbles.length === 0 && !conversationId && (
                <div className="space-y-2 py-4 text-center text-sm text-muted-foreground">
                  <p>Нет сохранённого диалога.</p>
                  <p>Нажми «Новый», чтобы начать переписку.</p>
                </div>
              )}
              {!historyLoading && bubbles.length === 0 && conversationId && (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Спроси про то, что сейчас на экране — я вижу маршрут и описание страницы.
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

            <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Вопрос про эту страницу или тренировки…"
                  disabled={pending || !userId || historyLoading || !conversationId}
                />
                <Button onClick={send} disabled={!canSend}>
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
