"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { totalDistance } from "@/lib/features/swimming/distance";
import {
  swimWorkoutToSeriesInputs,
  type SwimSeriesInput,
} from "@/lib/features/workouts/swimFormFromSeed";
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

const DESCRIPTION_HINTS = [
  "кроль",
  "брасс",
  "спина",
  "баттерфляй",
  "ласты",
  "лопатки",
  "трубка",
  "колобашка",
  "80%",
  "отдых 30\"",
];

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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
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

  function updateField(
    id: string,
    field: "distance" | "description",
    value: string
  ) {
    setSeries((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
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
    <>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!lastWorkout}
            onClick={applyLast}
          >
            Подставить последнюю из базы
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="w-48">
            <Label htmlFor="date">Дата</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {series.map((s, idx) => (
          <Card key={s.id}>
            <CardHeader className="pb-2 border-b">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm shrink-0 w-5">
                  {idx + 1}.
                </span>
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-28 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      step="25"
                      placeholder="Метры"
                      value={s.distance}
                      onChange={(e) =>
                        updateField(s.id, "distance", e.target.value)
                      }
                    />
                  </div>
                  <span className="text-muted-foreground text-sm shrink-0">м</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => removeSeries(s.id)}
                  disabled={series.length === 1}
                  className="shrink-0 text-muted-foreground"
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <Input
                placeholder="Описание: стиль, интервалы, оборудование..."
                value={s.description}
                onChange={(e) =>
                  updateField(s.id, "description", e.target.value)
                }
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {DESCRIPTION_HINTS.map((hint) => (
                  <button
                    type="button"
                    key={hint}
                    onClick={() =>
                      updateField(
                        s.id,
                        "description",
                        s.description
                          ? `${s.description} ${hint}`
                          : hint
                      )
                    }
                    className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addSeries} className="w-full" type="button">
        <Plus />
        Добавить серию
      </Button>

      {total > 0 && (
        <Card className="bg-primary text-primary-foreground ring-0">
          <CardContent className="pt-4">
            <div className="flex justify-between items-center">
              <span className="opacity-80">Общий метраж</span>
              <span className="text-2xl font-bold">
                {total.toLocaleString("ru")} м
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <Label htmlFor="notes">Заметки (необязательно)</Label>
        <textarea
          id="notes"
          placeholder="Самочувствие, темп, особенности тренировки..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 min-h-[72px] resize-none"
        />
      </div>

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <Button
        onClick={handleSave}
        className="w-full"
        size="lg"
        type="button"
        disabled={saveState === "saving"}
      >
        {saveState === "saving"
          ? "Сохранение…"
          : saveState === "saved"
            ? "Сохранено ✓"
            : "Сохранить тренировку"}
      </Button>
    </>
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
      <div className="flex items-center gap-2">
        <Waves className="size-5" />
        <h2 className="text-xl font-semibold">Плавательная тренировка</h2>
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
