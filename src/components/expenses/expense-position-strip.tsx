"use client";

import type {
  PositionLine,
  PositionSnapshot,
} from "@/lib/features/expenses/positionSnapshot";
import { formatRub } from "@/lib/db/expensesData";

type Props = {
  snapshot: PositionSnapshot;
};

function SideColumn({
  title,
  total,
  lines,
  tone,
}: {
  title: string;
  total: number;
  lines: PositionLine[];
  tone: "asset" | "liability";
}) {
  const max = Math.max(...lines.map((l) => l.amountRub), 1);
  const bar =
    tone === "asset"
      ? "bg-emerald-500/80 dark:bg-emerald-400/70"
      : "bg-red-500/80 dark:bg-red-400/70";
  const titleCls =
    tone === "asset"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className={`text-[11px] font-semibold uppercase tracking-wide ${titleCls}`}>
          {title}
        </h4>
        <span className="text-sm font-semibold tabular-nums">{formatRub(total)}</span>
      </div>
      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line.id} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">
                {line.label}
                {line.detail ? (
                  <span className="text-muted-foreground/80"> · {line.detail}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatRub(line.amountRub)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${bar}`}
                style={{ width: `${Math.max(4, (line.amountRub / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
        {lines.length === 0 && (
          <li className="text-xs text-muted-foreground">пусто</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Упрощённый бухучёт: активы / пассивы / чистыми.
 * Снимок «сейчас» из env-ориентиров — отдельно от кривой cashflow.
 */
export function ExpensePositionStrip({ snapshot }: Props) {
  const netPositive = snapshot.netRub >= 0;

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          Позиция сейчас · упрощённый учёт
        </p>
        <p className="text-[10px] text-muted-foreground">
          резерв USD — актив, не в кривой «на жизнь»
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-6">
        <SideColumn
          title="Активы"
          total={snapshot.assetsTotalRub}
          lines={snapshot.assets}
          tone="asset"
        />
        <div className="hidden w-px bg-border sm:block" aria-hidden />
        <SideColumn
          title="Пассивы"
          total={snapshot.liabilitiesTotalRub}
          lines={snapshot.liabilities}
          tone="liability"
        />
        <div className="flex min-w-[132px] flex-col justify-end border-t border-border/60 pt-2 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Чистыми
          </p>
          <p
            className={
              netPositive
                ? "text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                : "text-xl font-semibold tabular-nums text-red-500"
            }
          >
            {formatRub(snapshot.netRub)}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            кэш + USD − долг карты
          </p>
        </div>
      </div>
    </div>
  );
}
