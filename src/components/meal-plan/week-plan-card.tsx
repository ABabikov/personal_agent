"use client";

import { ChevronLeft, ChevronRight, Lock, Plus, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { recipeById } from "@/lib/features/meal-plan/recipes";
import type { MealSlot } from "@/lib/features/meal-plan/types";
import {
  clearWeekEntry,
  datesForWeek,
  getWeekEntry,
  setWeekEntry,
  weekdayLabelRu,
  type WeekPlan,
} from "@/lib/features/meal-plan/weekPlan";

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.001) return String(Math.round(r));
  return r.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

type WeekPlanCardProps = {
  weekPlan: WeekPlan;
  mealSlots: MealSlot[];
  pickSlot: { date: string; slotId: string } | null;
  onPickSlot: (slot: { date: string; slotId: string } | null) => void;
  onChange: (next: WeekPlan) => void;
  onLock: () => void;
  onUnlock: () => void;
  onShiftWeek: (delta: number) => void;
};

export function WeekPlanCard({
  weekPlan,
  mealSlots,
  pickSlot,
  onPickSlot,
  onChange,
  onLock,
  onUnlock,
  onShiftWeek,
}: WeekPlanCardProps) {
  const weekDates = datesForWeek(weekPlan.weekStart);

  return (
    <Card size="sm" id="week-plan">
      <CardHeader className="border-b border-border/50 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {weekPlan.locked ? (
            <Lock className="size-4 text-amber-400" />
          ) : (
            <Unlock className="size-4 text-muted-foreground" />
          )}
          План на неделю
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal leading-snug">
          Раскладывайте блюда по дням и слотам из поиска или каталога. Когда готово — «Зафиксировать неделю»:
          слоты заблокируются, список покупок считается по этой неделе.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => onShiftWeek(-1)}
            aria-label="Предыдущая неделя"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums min-w-[10rem] text-center">
            {weekdayLabelRu(weekDates[0]!)} — {weekdayLabelRu(weekDates[6]!)}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => onShiftWeek(1)}
            aria-label="Следующая неделя"
          >
            <ChevronRight className="size-4" />
          </Button>
          {weekPlan.locked ? (
            <Button type="button" size="sm" variant="secondary" onClick={onUnlock}>
              <Unlock className="size-3.5" />
              Разблокировать
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onLock}>
              <Lock className="size-3.5" />
              Зафиксировать неделю
            </Button>
          )}
        </div>
        {pickSlot && !weekPlan.locked ? (
          <p className="text-[11px] text-primary border border-glow-primary/30 rounded-md px-2 py-1.5">
            Выберите рецепт в каталоге ниже для{" "}
            <span className="font-medium">{weekdayLabelRu(pickSlot.date)}</span>, слот «
            {mealSlots.find((s) => s.id === pickSlot.slotId)?.label ?? "приём"}».
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 ml-1 text-[11px]"
              onClick={() => onPickSlot(null)}
            >
              Отмена
            </Button>
          </p>
        ) : null}
        <ul className="space-y-3">
          {weekDates.map((date) => (
            <li key={date} className="rounded-lg border border-border/50 bg-card/15 p-2">
              <p className="text-xs font-medium text-foreground mb-2">{weekdayLabelRu(date)}</p>
              <ul className="space-y-1.5">
                {mealSlots.map((slot) => {
                  const entry = getWeekEntry(weekPlan, date, slot.id);
                  const r = entry ? recipeById(entry.recipeId) : undefined;
                  return (
                    <li
                      key={`${date}-${slot.id}`}
                      className="flex items-center gap-2 rounded-md border border-border/40 bg-card/10 px-2 py-1.5 text-xs"
                    >
                      <span className="w-[7.5rem] shrink-0 text-muted-foreground truncate">{slot.label}</span>
                      {r && entry ? (
                        <>
                          <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {fmtAmount(entry.portions)} порц.
                          </span>
                          {!weekPlan.locked ? (
                            <>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="size-7"
                                onClick={() =>
                                  onChange(
                                    setWeekEntry(weekPlan, date, slot.id, entry.recipeId, entry.portions + 0.5)
                                  )
                                }
                              >
                                <Plus className="size-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="size-7 text-destructive"
                                onClick={() => onChange(clearWeekEntry(weekPlan, date, slot.id))}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] ml-auto"
                          disabled={weekPlan.locked}
                          onClick={() => onPickSlot({ date, slotId: slot.id })}
                        >
                          <Plus className="size-3" />
                          Выбрать блюдо
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
