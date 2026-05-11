"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SwimSeriesInput {
  id: string;
  distance: string;
  description: string;
}

const QUICK_HINTS = [
  "кроль",
  "брасс",
  "спина",
  "ласты",
  "лопатки",
  "колобашка",
  "80%",
  "отдых 30\"",
];

interface SwimSeriesCardProps {
  series: SwimSeriesInput;
  index: number;
  canDelete: boolean;
  onDistanceChange: (distance: string) => void;
  onDescriptionChange: (description: string) => void;
  onDelete: () => void;
}

export function SwimSeriesCard({
  series,
  index,
  canDelete,
  onDistanceChange,
  onDescriptionChange,
  onDelete,
}: SwimSeriesCardProps) {
  function addHint(hint: string) {
    const newDesc = series.description
      ? `${series.description} ${hint}`
      : hint;
    onDescriptionChange(newDesc);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-swim/15 text-xs font-medium text-swim">
          {index + 1}
        </span>
        <div className="flex flex-1 items-center gap-2">
          <Input
            type="number"
            min="0"
            step="25"
            placeholder="0"
            value={series.distance}
            onChange={(e) => onDistanceChange(e.target.value)}
            className="h-8 w-20 border-0 bg-transparent px-2 text-center tabular-nums focus-visible:ring-0"
          />
          <span className="text-sm text-muted-foreground">м</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={!canDelete}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {/* Description: textarea — длинные тексты от генератора не помещаются в однострочный input */}
      <div className="p-3">
        <textarea
          placeholder="Стиль, интервалы, оборудование..."
          value={series.description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          className={cn(
            "min-h-[4.5rem] w-full resize-y rounded-lg border-0 bg-muted/30 px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        />
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Быстрые фразы ниже — это не «теги серии»: при нажатии текст добавляется в описание (можно править вручную).
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {QUICK_HINTS.map((hint) => (
            <button
              key={hint}
              type="button"
              onClick={() => addHint(hint)}
              className="rounded-md border border-swim/20 bg-swim/10 px-2 py-1 text-xs text-swim transition-colors hover:bg-swim/20"
            >
              + {hint}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
