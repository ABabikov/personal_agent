"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SWIM_MEDIUM_GOALS,
  loadSwimMediumGoals,
  persistSwimMediumGoals,
  type SwimMediumGoals,
} from "@/lib/features/swimming/swimMediumGoalsStorage";
import { swimMetersRolling28Days } from "@/lib/features/swimming/swimRollingStats";

export type { SwimMediumGoals };

export function SwimMediumPlanCard({
  userId,
  refreshKey,
}: {
  userId: string | null;
  /** Инкремент после сохранения тренировки на странице плавания. */
  refreshKey: number;
}) {
  const [goals, setGoals] = useState<SwimMediumGoals>(DEFAULT_SWIM_MEDIUM_GOALS);
  const [hydrated, setHydrated] = useState(false);
  const [avgWeeklyM, setAvgWeeklyM] = useState<number | null>(null);
  const [periodTotalM, setPeriodTotalM] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    setGoals(loadSwimMediumGoals());
    setHydrated(true);
  }, []);

  const persist = useCallback((g: SwimMediumGoals) => {
    setGoals(g);
    persistSwimMediumGoals(g);
  }, []);

  const loadStats = useCallback(async () => {
    if (!userId) return;
    setLoadErr(null);
    const res = await swimMetersRolling28Days(userId);
    if ("error" in res) {
      setLoadErr(res.error);
      setAvgWeeklyM(null);
      setPeriodTotalM(null);
      return;
    }
    setPeriodTotalM(res.data.totalM);
    setAvgWeeklyM(res.data.avgWeeklyM);
  }, [userId]);

  useEffect(() => {
    if (userId) void loadStats();
  }, [userId, refreshKey, loadStats]);

  if (!hydrated) return null;

  const targetMultiline = goals.weeklyTargetM * goals.horizonWeeks;
  const pctOfTarget =
    goals.weeklyTargetM > 0 && avgWeeklyM != null
      ? Math.min(150, Math.round((avgWeeklyM / goals.weeklyTargetM) * 100))
      : null;

  return (
    <Card className="border-swim/25 bg-swim/[0.06]">
      <CardContent className="space-y-3 pt-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Среднесрочный план</h2>
          <p className="text-xs text-muted-foreground">
            Цели хранятся на устройстве. Сравнение — факт за последние 4 недели (скользящее окно).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="weekly-target">Цель, м/нед</Label>
            <Input
              id="weekly-target"
              type="number"
              min={500}
              step={100}
              className="mt-1"
              value={goals.weeklyTargetM}
              onChange={(e) =>
                persist({
                  ...goals,
                  weeklyTargetM: Math.max(100, parseInt(e.target.value, 10) || 0),
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="horizon">Горизонт, нед</Label>
            <Input
              id="horizon"
              type="number"
              min={1}
              max={52}
              className="mt-1"
              value={goals.horizonWeeks}
              onChange={(e) =>
                persist({
                  ...goals,
                  horizonWeeks: Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 1)),
                })
              }
            />
          </div>
        </div>

        <div>
          <Label htmlFor="goal-note">Формулировка цели (по желанию)</Label>
          <Input
            id="goal-note"
            placeholder="Например: устойчивая база кроля к осени"
            className="mt-1"
            value={goals.goalNote}
            onChange={(e) => persist({ ...goals, goalNote: e.target.value })}
          />
        </div>

        {userId && (
          <div className="rounded-lg border border-border bg-card/80 px-3 py-2 text-sm">
            {loadErr && <p className="text-destructive text-xs">{loadErr}</p>}
            {!loadErr && avgWeeklyM != null && periodTotalM != null && (
              <>
                <p>
                  За последние 4 недели в среднем{" "}
                  <span className="font-semibold tabular-nums">{avgWeeklyM.toLocaleString("ru")} м/нед</span>
                  {" "}(всего {periodTotalM.toLocaleString("ru")} м в окне).
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Ориентир на горизонте {goals.horizonWeeks} нед: до{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {targetMultiline.toLocaleString("ru")} м
                  </span>{" "}
                  суммарно при {goals.weeklyTargetM.toLocaleString("ru")} м/нед.
                </p>
                {pctOfTarget != null && (
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>Текущий темп к недельной цели</span>
                      <span className="tabular-nums">{pctOfTarget}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-swim transition-all"
                        style={{ width: `${Math.min(100, pctOfTarget)}%` }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            {!loadErr && avgWeeklyM == null && (
              <p className="text-xs text-muted-foreground">Загрузка статистики…</p>
            )}
          </div>
        )}

        <Button type="button" variant="outline" size="sm" onClick={() => void loadStats()} disabled={!userId}>
          Обновить цифры
        </Button>
      </CardContent>
    </Card>
  );
}
