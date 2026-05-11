"use client";

import { useMemo, useState } from "react";
import { Plus, Waves, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SwimSeriesCard,
  type SwimSeriesInput,
} from "@/components/workout/swim-series-card";
import { TotalCard } from "@/components/workout/total-card";
import { totalDistance } from "@/lib/features/swimming/distance";
import { swimWorkoutToSeriesInputs } from "@/lib/features/workouts/swimFormFromSeed";
import type { ParsedSwimWorkout } from "@/lib/features/workouts/csvImport";
import { useWorkoutSeed } from "@/hooks/use-workout-seed";
import type { SwimDayKey } from "@/lib/features/workouts/workoutSeedTypes";
import { saveSwimWorkoutToSupabase } from "@/lib/db/saveWorkout";

function newId() {
  return Math.random().toString(36).slice(2);
}

function newSeries(): SwimSeriesInput {
  return { id: newId(), distance: "", description: "" };
}

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function defaultSwimDay(): SwimDayKey {
  const dow = new Date().getDay();
  if (dow === 2) return "vt";
  if (dow === 4) return "cht";
  if (dow === 6) return "sb";
  return "vt";
}

const DAY_LABELS: Record<SwimDayKey, string> = {
  vt: "Вторник — Смешанные стили",
  cht: "Четверг — Брасс",
  sb: "Суббота — Кроль",
};

const DAY_SHORT: Record<SwimDayKey, string> = {
  vt: "Вт",
  cht: "Чт",
  sb: "Сб",
};

function SwimWorkoutEditor({
  lastWorkout,
}: {
  lastWorkout: ParsedSwimWorkout | null;
}) {
  const [date, setDate] = useState(todayString);
  const [series, setSeries] = useState<SwimSeriesInput[]>(() =>
    lastWorkout ? swimWorkoutToSeriesInputs(lastWorkout) : [newSeries()]
  );
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  function applyLast() {
    if (!lastWorkout) return;
    setSeries(swimWorkoutToSeriesInputs(lastWorkout));
  }

  function addSeries() {
    setSeries((prev) => [...prev, newSeries()]);
  }

  function removeSeries(id: string) {
    setSeries((prev) => prev.filter((s) => s.id !== id));
  }

  function updateDistance(id: string, distance: string) {
    setSeries((prev) =>
      prev.map((s) => (s.id === id ? { ...s, distance } : s))
    );
  }

  function updateDescription(id: string, description: string) {
    setSeries((prev) =>
      prev.map((s) => (s.id === id ? { ...s, description } : s))
    );
  }

  const parsedSeries = series.map((s) => ({
    distance: parseInt(s.distance) || 0,
  }));
  const total = totalDistance(parsedSeries);

  async function handleSave() {
    setSaveError(null);
    setSaveState("saving");
    const seriesPayload = series.map((s) => ({
      distance: parseInt(s.distance, 10) || 0,
      description: s.description,
    }));

    const result = await saveSwimWorkoutToSupabase({
      date,
      series: seriesPayload,
      notes,
    });

    if ("error" in result) {
      setSaveError(result.error);
      setSaveState("idle");
      return;
    }

    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Prefill action */}
      {lastWorkout && (
        <Button variant="outline" size="sm" onClick={applyLast}>
          <RotateCcw className="size-3.5" />
          <span>Подставить последнюю</span>
        </Button>
      )}

      {/* Date */}
      <Card>
        <CardContent className="pt-4">
          <div className="w-40">
            <Label htmlFor="date">Дата</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1.5"
            />
          </div>
        </CardContent>
      </Card>

      {/* Series */}
      <div className="space-y-3">
        {series.map((s, idx) => (
          <SwimSeriesCard
            key={s.id}
            series={s}
            index={idx}
            canDelete={series.length > 1}
            onDistanceChange={(distance) => updateDistance(s.id, distance)}
            onDescriptionChange={(description) =>
              updateDescription(s.id, description)
            }
            onDelete={() => removeSeries(s.id)}
          />
        ))}
      </div>

      {/* Add series */}
      <Button
        variant="outline"
        onClick={addSeries}
        className="w-full border-dashed"
      >
        <Plus className="size-4" />
        <span>Добавить серию</span>
      </Button>

      {/* Total distance */}
      <TotalCard
        icon={Waves}
        label="Общий метраж"
        value={total}
        unit="м"
        variant="swim"
      />

      {/* Notes */}
      <div>
        <Label htmlFor="notes">Заметки</Label>
        <textarea
          id="notes"
          placeholder="Самочувствие, темп, особенности..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px] resize-none"
        />
      </div>

      {/* Error */}
      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      {/* Save button */}
      <Button
        onClick={handleSave}
        className="w-full bg-swim hover:bg-swim/90 text-swim-foreground"
        size="lg"
        disabled={saveState === "saving"}
      >
        {saveState === "saving"
          ? "Сохранение..."
          : saveState === "saved"
            ? "Сохранено"
            : "Сохранить тренировку"}
      </Button>
    </div>
  );
}

export default function SwimPage() {
  const { seed, error: seedError, loading: seedLoading } = useWorkoutSeed();
  const [swimDay, setSwimDay] = useState<SwimDayKey>(defaultSwimDay);
  const [showDayPicker, setShowDayPicker] = useState(false);

  const lastWorkout = useMemo(() => {
    if (!seed) return null;
    const dayList = seed.swim[swimDay] ?? [];
    return dayList.length ? dayList[dayList.length - 1]! : null;
  }, [seed, swimDay]);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-swim/15">
            <Waves className="size-5 text-swim" />
          </div>
          <h1 className="text-lg font-semibold">Плавание</h1>
        </div>
      </div>

      {/* Loading/Error states */}
      {seedLoading && (
        <p className="text-sm text-muted-foreground">Загрузка данных...</p>
      )}
      {seedError && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              Нет импортированных данных. Выполните{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                npm run build:seed
              </code>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Day picker */}
      <div className="relative">
        <button
          onClick={() => setShowDayPicker(!showDayPicker)}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <div>
            <p className="text-sm font-medium">{DAY_LABELS[swimDay]}</p>
            {lastWorkout && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Последняя:{" "}
                {new Date(lastWorkout.date + "T12:00:00").toLocaleDateString(
                  "ru",
                  { day: "numeric", month: "short" }
                )}
                {lastWorkout.totalDistance != null && (
                  <> — {lastWorkout.totalDistance.toLocaleString("ru")} м</>
                )}
              </p>
            )}
          </div>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${
              showDayPicker ? "rotate-180" : ""
            }`}
          />
        </button>

        {showDayPicker && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {(Object.keys(DAY_LABELS) as SwimDayKey[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setSwimDay(k);
                  setShowDayPicker(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent ${
                  swimDay === k ? "bg-accent" : ""
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-swim/15 text-sm font-medium text-swim">
                  {DAY_SHORT[k]}
                </span>
                <span className="text-sm">{DAY_LABELS[k]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Workout editor */}
      {seed && (
        <SwimWorkoutEditor
          key={`${swimDay}-${seed.generatedAt}`}
          lastWorkout={lastWorkout}
        />
      )}
    </div>
  );
}
