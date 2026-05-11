"use client";

import { cn } from "@/lib/utils";
import type { PeriodScope } from "@/lib/db/calendarData";

const SCOPES: { id: PeriodScope; label: string }[] = [
  { id: "month", label: "Месяц" },
  { id: "year", label: "Год" },
  { id: "all", label: "Всё" },
];

interface PeriodSwitcherProps {
  scope: PeriodScope;
  onChange: (s: PeriodScope) => void;
}

export function PeriodSwitcher({ scope, onChange }: PeriodSwitcherProps) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
      {SCOPES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            scope === s.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
