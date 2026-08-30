"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Watch, Link2, RefreshCw, Unplug, GitMerge, Upload, Mountain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Status = {
  configured: boolean;
  connected: boolean;
  scope: string | null;
  expiresAt: string | null;
};

type UnlinkedItem = {
  session: {
    id: string;
    startedAt: string;
    activityTypeRaw: string | null;
    activityTypeMapped: string | null;
    activityLabel?: string | null;
    caloriesDevice: number | null;
    avgHeartRate: number | null;
    durationSeconds: number | null;
  };
  candidateWorkouts: Array<{
    id: string;
    date: string;
    type: string;
    caloriesEstimated: number | null;
  }>;
};

function formatSessionTime(iso: string) {
  return new Date(iso).toLocaleString("ru", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activityLabel(item: UnlinkedItem["session"]) {
  if (item.activityLabel) return item.activityLabel;
  if (item.activityTypeMapped === "gym") return "Силовая";
  if (item.activityTypeMapped === "swim") return "Плавание";
  if (item.activityTypeRaw) return `Huawei ${item.activityTypeRaw}`;
  return "Другое";
}

interface HuaweiHealthCardProps {
  userId: string | null;
}

export function HuaweiHealthCard({ userId }: HuaweiHealthCardProps) {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [needsJournal, setNeedsJournal] = useState<UnlinkedItem[]>([]);
  const [outdoor, setOutdoor] = useState<UnlinkedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setError(null);
    const qs = `userId=${encodeURIComponent(userId)}`;
    const [stRes, unRes] = await Promise.all([
      fetch(`/api/integrations/huawei/status?${qs}`, { cache: "no-store" }),
      fetch(`/api/integrations/huawei/unlinked?${qs}`, { cache: "no-store" }),
    ]);
    if (stRes.ok) setStatus((await stRes.json()) as Status);
    if (unRes.ok) {
      const j = (await unRes.json()) as {
        needsJournal?: UnlinkedItem[];
        outdoor?: UnlinkedItem[];
        items?: UnlinkedItem[];
      };
      if (j.needsJournal || j.outdoor) {
        setNeedsJournal(j.needsJournal ?? []);
        setOutdoor(j.outdoor ?? []);
      } else {
        const items = j.items ?? [];
        setNeedsJournal(
          items.filter(
            (i) =>
              i.session.activityTypeMapped === "gym" ||
              i.session.activityTypeMapped === "swim"
          )
        );
        setOutdoor(
          items.filter((i) => i.session.activityTypeMapped === "other")
        );
      }
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const huawei = searchParams.get("huawei");
    if (huawei === "connected") {
      setMessage("Huawei Health подключён. Можно синхронизировать данные.");
    } else if (huawei === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      setError(`Ошибка подключения Huawei: ${reason}`);
    }
  }, [searchParams]);

  async function handleConnect() {
    if (!userId) return;
    window.location.href = `/api/integrations/huawei/authorize?userId=${encodeURIComponent(userId)}`;
  }

  async function handleSync() {
    if (!userId) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/huawei/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, days: 30 }),
      });
      const j = (await res.json()) as {
        fetched?: number;
        upserted?: number;
        linked?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? "Синхронизация не удалась");
        return;
      }
      setMessage(
        `Импорт: ${j.fetched ?? 0} с Huawei, сохранено ${j.upserted ?? 0}, сопоставлено ${j.linked ?? 0}.`
      );
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportExport() {
    if (!userId) return;
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/huawei/import-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const j = (await res.json()) as {
        upserted?: number;
        linked?: number;
        sessionsFound?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? "Импорт выгрузки не удался");
        return;
      }
      setMessage(
        `Выгрузка: ${j.sessionsFound ?? 0} сессий, сохранено ${j.upserted ?? 0}, сопоставлено ${j.linked ?? 0}.`
      );
      await load();
    } finally {
      setImporting(false);
    }
  }

  async function handleAutolink(opts: {
    materialize?: boolean;
    materializeOutdoor?: boolean;
  }) {
    if (!userId) return;
    setLinking(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/huawei/autolink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...opts }),
      });
      const j = (await res.json()) as {
        linked?: number;
        materialized?: { created?: number; linked?: number };
        outdoor?: { created?: number; linked?: number };
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? "Сопоставление не удалось");
        return;
      }
      const parts = [`к журналу: ${j.linked ?? 0}`];
      if (j.materialized) {
        parts.push(`создано зал/плав: ${j.materialized.created ?? 0}`);
      }
      if (j.outdoor) {
        parts.push(`outdoor в календарь: ${j.outdoor.created ?? 0}`);
      }
      setMessage(`Сопоставление: ${parts.join("; ")}.`);
      await load();
    } finally {
      setLinking(false);
    }
  }

  async function handleDisconnect() {
    if (!userId) return;
    setError(null);
    const res = await fetch("/api/integrations/huawei/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setError(j.error ?? "Не удалось отключить");
      return;
    }
    setMessage("Huawei Health отключён.");
    await load();
  }

  async function handleManualLink(deviceSessionId: string, workoutId: string) {
    setError(null);
    const res = await fetch("/api/integrations/huawei/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId, workoutId }),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setError(j.error ?? "Не удалось сопоставить");
      return;
    }
    setMessage("Сессия сопоставлена с тренировкой.");
    await load();
  }

  if (!userId) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Watch className="size-4 text-primary" />
          Huawei Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <p className="text-sm text-muted-foreground">Проверка подключения…</p>
        )}

        {!loading && status && !status.configured && (
          <p className="text-xs text-muted-foreground">
            OAuth (кнопка «Подключить») не настроен — нужны CLIENT_ID / SECRET /
            REDIRECT_URI после одобрения Huawei. Импорт ZIP-выгрузки и сопоставление
            работают без этого.
          </p>
        )}

        {!loading && (
          <div className="flex flex-wrap gap-2">
            {status?.configured && !status.connected && (
              <Button type="button" size="sm" onClick={handleConnect}>
                <Link2 className="size-4" />
                Подключить
              </Button>
            )}
            {status?.configured && status.connected && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={syncing}
                  onClick={handleSync}
                >
                  <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                  {syncing ? "Синхронизация…" : "Синхронизировать (30 дн.)"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleDisconnect}
                >
                  <Unplug className="size-4" />
                  Отключить
                </Button>
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={importing}
              onClick={handleImportExport}
            >
              <Upload className={cn("size-4", importing && "animate-pulse")} />
              {importing ? "Импорт…" : "Импорт выгрузки"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={linking}
              onClick={() => handleAutolink({ materialize: true })}
            >
              <GitMerge className={cn("size-4", linking && "animate-pulse")} />
              {linking ? "…" : "Связать зал/плав"}
            </Button>
            {outdoor.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={linking}
                onClick={() => handleAutolink({ materializeOutdoor: true })}
              >
                <Mountain className="size-4" />
                Outdoor → календарь ({outdoor.length})
              </Button>
            )}
          </div>
        )}

        {message && (
          <p className="text-sm text-primary" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {needsJournal.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Зал / плавание без пары ({needsJournal.length})
            </p>
            {needsJournal.map((item) => (
              <SessionBlock
                key={item.session.id}
                item={item}
                onLink={handleManualLink}
              />
            ))}
          </div>
        )}

        {outdoor.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Outdoor / GPS с часов ({outdoor.length})
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Это не зал и не бассейн (тип Huawei 218). В журнал зала их не
              привязываем. Можно добавить в календарь отдельными записями с
              пульсом и ккал — кнопка «Outdoor → календарь».
            </p>
            {outdoor.slice(0, 8).map((item) => (
              <div
                key={item.session.id}
                className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1"
              >
                <div className="flex flex-wrap justify-between gap-1">
                  <span className="font-medium">{activityLabel(item.session)}</span>
                  <span className="text-muted-foreground">
                    {formatSessionTime(item.session.startedAt)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 text-muted-foreground tabular-nums">
                  {item.session.caloriesDevice != null && (
                    <span>
                      {Math.round(Number(item.session.caloriesDevice))} ккал
                    </span>
                  )}
                  {item.session.avgHeartRate != null && (
                    <span>♥ {Math.round(Number(item.session.avgHeartRate))}</span>
                  )}
                  {item.session.durationSeconds != null && (
                    <span>
                      {Math.round(item.session.durationSeconds / 60)} мин
                    </span>
                  )}
                </div>
              </div>
            ))}
            {outdoor.length > 8 && (
              <p className="text-[11px] text-muted-foreground">
                …и ещё {outdoor.length - 8}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionBlock({
  item,
  onLink,
}: {
  item: UnlinkedItem;
  onLink: (sessionId: string, workoutId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-2">
      <div className="flex flex-wrap justify-between gap-1">
        <span className="font-medium">{activityLabel(item.session)}</span>
        <span className="text-muted-foreground">
          {formatSessionTime(item.session.startedAt)}
        </span>
      </div>
      <div className="flex flex-wrap gap-3 text-muted-foreground tabular-nums">
        {item.session.caloriesDevice != null && (
          <span>
            {Math.round(Number(item.session.caloriesDevice))} ккал (часы)
          </span>
        )}
        {item.session.avgHeartRate != null && (
          <span>♥ {Math.round(Number(item.session.avgHeartRate))}</span>
        )}
        {item.session.durationSeconds != null && (
          <span>{Math.round(item.session.durationSeconds / 60)} мин</span>
        )}
      </div>
      {item.candidateWorkouts.length === 0 ? (
        <p className="text-muted-foreground">
          Нет записи в журнале за этот день — нажмите «Связать зал/плав».
        </p>
      ) : (
        <ul className="space-y-1">
          {item.candidateWorkouts.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2">
              <span>
                {w.type === "gym" ? "Зал" : "Бассейн"} ·{" "}
                {w.caloriesEstimated != null
                  ? `${Math.round(w.caloriesEstimated)} ккал (MET)`
                  : "без MET"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onLink(item.session.id, w.id)}
              >
                Связать
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
