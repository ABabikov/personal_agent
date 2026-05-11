"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Waves, RotateCcw } from "lucide-react";
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
import { saveSwimWorkoutToSupabase } from "@/lib/db/saveWorkout";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import {
  fetchLastSwimWorkoutFromDb,
  type LastSwimFromDb,
} from "@/lib/db/fetchLastWorkoutTemplates";

function newId() {
  return Math.random().toString(36).slice(2);
}

function newSeries(): SwimSeriesInput {
  return { id: newId(), distance: "", description: "" };
}

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function SwimWorkoutEditor({
  lastWorkout,
  onSaveSuccess,
}: {
  lastWorkout: ParsedSwimWorkout | null;
  onSaveSuccess?: () => void;
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
    onSaveSuccess?.();
  }

  return (
    <div className="space-y-4">
      {lastWorkout && (
        <Button variant="outline" size="sm" onClick={applyLast}>
          <RotateCcw className="size-3.5" />
          <span>Подставить последнюю из базы</span>
        </Button>
      )}

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

      <Button
        variant="outline"
        onClick={addSeries}
        className="w-full border-dashed"
      >
        <Plus className="size-4" />
        <span>Добавить серию</span>
      </Button>

      <TotalCard
        icon={Waves}
        label="Общий метраж"
        value={total}
        unit="м"
        variant="swim"
      />

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

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

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
  const [hydrated, setHydrated] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [lastTemplate, setLastTemplate] = useState<LastSwimFromDb | null>(null);

  const refreshLast = useCallback(async () => {
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setUserError(user.error);
      setLastFetchError(null);
      setLastTemplate(null);
      return;
    }
    setUserError(null);
    const res = await fetchLastSwimWorkoutFromDb(user.userId);
    if ("error" in res) {
      setLastFetchError(res.error);
      setLastTemplate(null);
    } else {
      setLastFetchError(null);
      setLastTemplate(res.data);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshLast();
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLast]);

  const lastParsed = lastTemplate?.parsed ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-swim/15">
            <Waves className="size-5 text-swim" />
          </div>
          <h1 className="text-lg font-semibold">Плавание</h1>
        </div>
      </div>

      {!hydrated && (
        <p className="text-sm text-muted-foreground">Загрузка из Supabase…</p>
      )}
      {userError && (
        <p className="text-sm text-destructive" role="alert">
          {userError}
        </p>
      )}
      {lastFetchError && !userError && (
        <p className="text-sm text-destructive" role="alert">
          Не удалось загрузить последнюю тренировку: {lastFetchError}
        </p>
      )}

      {hydrated && !userError && lastParsed && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">
              Последняя в базе:{" "}
              <span className="font-medium text-foreground">
                {new Date(lastParsed.date + "T12:00:00").toLocaleDateString("ru")}
              </span>
              {lastParsed.totalDistance != null && (
                <>
                  {" "}
                  · {lastParsed.totalDistance.toLocaleString("ru")} м
                </>
              )}
              {lastParsed.durationMinutes != null && (
                <> · ~{lastParsed.durationMinutes} мин</>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {hydrated && !userError && (
        <SwimWorkoutEditor
          lastWorkout={lastParsed}
          onSaveSuccess={() => void refreshLast()}
        />
      )}
    </div>
  );
}
