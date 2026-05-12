"use client";

import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/agent/memory/store";
import { fetchConversationsListFromApi } from "@/lib/chat/storedToBubbles";

type Props = {
  userId: string | null;
  activeConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  disabled?: boolean;
  /** compact — для панели Jarvis; иначе чуть шире кнопка */
  compact?: boolean;
};

function formatWhen(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ChatConversationPicker({
  userId,
  activeConversationId,
  onSelectConversation,
  disabled,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchConversationsListFromApi(userId);
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  return (
    <div className={cn("relative", compact && "shrink-0")} ref={wrapRef}>
      <Button
        type="button"
        variant="outline"
        size={compact ? "sm" : "sm"}
        className={cn(compact && "gap-1 px-2")}
        title={compact ? "Другие диалоги" : undefined}
        disabled={disabled || !userId}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <History className="size-4 shrink-0" />
        {!compact && <span>Диалоги</span>}
      </Button>
      {open && (
        <div
          className={cn(
            "absolute z-[80] mt-1 max-h-[min(18rem,50dvh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
            compact ? "right-0" : "right-0"
          )}
          role="listbox"
          aria-label="Список диалогов"
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Загрузка…</div>
          )}
          {error && (
            <div className="px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Пока нет сохранённых диалогов.</div>
          )}
          {!loading &&
            !error &&
            items.map((c) => {
              const active = c.conversation_id === activeConversationId;
              return (
                <button
                  key={c.conversation_id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
                    active ? "bg-muted" : "hover:bg-muted/70"
                  )}
                  onClick={() => {
                    onSelectConversation(c.conversation_id);
                    setOpen(false);
                  }}
                >
                  <span className="text-[11px] text-muted-foreground">
                    {formatWhen(c.last_message_at)}
                  </span>
                  <span className="line-clamp-2 text-xs leading-snug">{c.preview}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
