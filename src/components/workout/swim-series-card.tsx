"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SwimSeriesInput {
  id: string;
  distance: string;
  description: string;
  /** Разбивка для авто-пересчёта метража: повторов × метров на отрезок */
  reps?: string;
  perRepM?: string;
}

interface SwimSeriesCardProps {
  series: SwimSeriesInput;
  index: number;
  canDelete: boolean;
  onDistanceChange: (distance: string) => void;
  onBreakdownChange: (reps: string, perRepM: string) => void;
  onDescriptionChange: (description: string) => void;
  onDelete: () => void;
}

export function SwimSeriesCard({
  series,
  index,
  canDelete,
  onDistanceChange,
  onBreakdownChange,
  onDescriptionChange,
  onDelete,
}: SwimSeriesCardProps) {
  const reps = series.reps ?? "";
  const perRepM = series.perRepM ?? "";
  const r = parseInt(reps.trim(), 10);
  const m = parseInt(perRepM.trim(), 10);
  const productOk =
    Number.isFinite(r) &&
    Number.isFinite(m) &&
    r > 0 &&
    m > 0 &&
    r * m > 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header: итоговый метраж серии (то, что уходит в БД) */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-swim/15 text-xs font-medium text-swim">
          {index + 1}
        </span>
        <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] text-muted-foreground shrink-0">
            Итого
          </span>
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

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground shrink-0">
          Разбивка
        </span>
        <Input
          type="number"
          min="1"
          step="1"
          placeholder="×"
          title="Число повторов"
          value={reps}
          onChange={(e) =>
            onBreakdownChange(e.target.value, perRepM)
          }
          className="h-7 w-14 px-1.5 text-center text-xs tabular-nums"
        />
        <span className="text-muted-foreground">×</span>
        <Input
          type="number"
          min="25"
          step="25"
          placeholder="м"
          title="Метров на один повтор"
          value={perRepM}
          onChange={(e) => onBreakdownChange(reps, e.target.value)}
          className="h-7 w-16 px-1.5 text-center text-xs tabular-nums"
        />
        <span className="text-[11px] text-muted-foreground">м</span>
        {productOk && (
          <span className="text-[11px] tabular-nums text-swim">
            = {r * m} м → в «Итого»
          </span>
        )}
        <span className="text-[10px] leading-tight text-muted-foreground sm:max-w-[14rem]">
          Меняете 4×200 на 5×200 здесь — метраж обновится. Правка только текста
          описания метраж не трогает.
        </span>
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
      </div>
    </div>
  );
}
