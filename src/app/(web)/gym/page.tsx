"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Dumbbell, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExerciseCard,
  type ExerciseInput,
  type SetInput,
} from "@/components/workout/exercise-card";
import { TotalCard } from "@/components/workout/total-card";
import { exerciseTonnage, totalTonnage } from "@/lib/features/workouts/tonnage";
import { gymWorkoutToExerciseInputs } from "@/lib/features/workouts/gymFormFromSeed";
import type { ParsedGymWorkout } from "@/lib/features/workouts/csvImport";
import type { GymSet } from "@/types/database";
import { saveGymWorkoutToSupabase } from "@/lib/db/saveWorkout";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import {
  fetchLastGymWorkoutFromDb,
  type LastGymFromDb,
} from "@/lib/db/fetchLastWorkoutTemplates";

function newId() {
  return Math.random().toString(36).slice(2);
}

function defaultSets(): SetInput[] {
  return Array(4)
    .fill(null)
    .map(() => ({ weight: "", reps: "" }));
}

function newExercise(): ExerciseInput {
  return { id: newId(), name: "", sets: defaultSets() };
}

function parseSets(sets: SetInput[]): GymSet[] {
  return sets
    .filter((s) => s.weight !== "" && s.reps !== "")
    .map((s) => ({
      weight: parseFloat(s.weight) || 0,
      reps: parseInt(s.reps) || 0,
    }));
}

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function GymWorkoutEditor({
  lastWorkout,
  onSaveSuccess,
}: {
  lastWorkout: ParsedGymWorkout | null;
  onSaveSuccess?: () => void;
}) {
  const [date, setDate] = useState(todayString);
  const [bodyWeight, setBodyWeight] = useState(() =>
    lastWorkout?.bodyWeight != null ? String(lastWorkout.bodyWeight) : ""
  );
  const [exercises, setExercises] = useState<ExerciseInput[]>(() =>
    lastWorkout ? gymWorkoutToExerciseInputs(lastWorkout, true) : [newExercise()]
  );
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  function applyFromLast(withProgression: boolean) {
    if (!lastWorkout) return;
    setExercises(gymWorkoutToExerciseInputs(lastWorkout, withProgression));
    if (lastWorkout.bodyWeight != null) {
      setBodyWeight(String(lastWorkout.bodyWeight));
    }
  }

  function addExercise() {
    setExercises((prev) => [...prev, newExercise()]);
  }

  function removeExercise(id: string) {
    setExercises((prev) => prev.filter((e) => e.id !== id));
  }

  function updateName(id: string, name: string) {
    setExercises((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name } : e))
    );
  }

  function updateSet(
    exId: string,
    setIdx: number,
    field: "weight" | "reps",
    value: string
  ) {
    setExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exId) return e;
        const sets = e.sets.map((s, i) =>
          i === setIdx ? { ...s, [field]: value } : s
        );
        return { ...e, sets };
      })
    );
  }

  function addSet(exId: string) {
    setExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exId || e.sets.length >= 6) return e;
        return { ...e, sets: [...e.sets, { weight: "", reps: "" }] };
      })
    );
  }

  function removeSet(exId: string, setIdx: number) {
    setExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exId || e.sets.length <= 1) return e;
        return { ...e, sets: e.sets.filter((_, i) => i !== setIdx) };
      })
    );
  }

  const summaries = exercises.map((e) => {
    const parsed = parseSets(e.sets);
    return { id: e.id, sets: parsed, tonnage: exerciseTonnage(parsed) };
  });
  const total = totalTonnage(summaries);

  async function handleSave() {
    setSaveError(null);
    setSaveState("saving");
    const exercisesPayload = exercises
      .map((ex) => {
        const summary = summaries.find((s) => s.id === ex.id);
        if (!summary) return null;
        return { name: ex.name, sets: summary.sets };
      })
      .filter((row): row is { name: string; sets: GymSet[] } => {
        if (!row) return false;
        return row.name.trim().length > 0 && row.sets.length > 0;
      });

    const result = await saveGymWorkoutToSupabase({
      date,
      bodyWeightStr: bodyWeight,
      exercises: exercisesPayload,
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => applyFromLast(true)}
            className="flex-1"
          >
            <Sparkles className="size-3.5" />
            <span>С прогрессией (+1 повт)</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyFromLast(false)}
          >
            <RotateCcw className="size-3.5" />
            <span>Как было</span>
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="date">Дата</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="bw">Вес тела</Label>
              <div className="relative mt-1.5">
                <Input
                  id="bw"
                  type="number"
                  step="0.1"
                  min="30"
                  max="200"
                  placeholder="80.0"
                  value={bodyWeight}
                  onChange={(e) => setBodyWeight(e.target.value)}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  кг
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {exercises.map((ex, idx) => {
          const summary = summaries.find((s) => s.id === ex.id)!;
          return (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              index={idx}
              tonnage={summary.tonnage}
              canDelete={exercises.length > 1}
              onNameChange={(name) => updateName(ex.id, name)}
              onSetChange={(setIdx, field, value) =>
                updateSet(ex.id, setIdx, field, value)
              }
              onAddSet={() => addSet(ex.id)}
              onRemoveSet={(setIdx) => removeSet(ex.id, setIdx)}
              onDelete={() => removeExercise(ex.id)}
            />
          );
        })}
      </div>

      <Button
        variant="outline"
        onClick={addExercise}
        className="w-full border-dashed"
      >
        <Plus className="size-4" />
        <span>Добавить упражнение</span>
      </Button>

      <TotalCard
        icon={Dumbbell}
        label="Общий тоннаж"
        value={total}
        unit="кг"
        variant="gym"
      />

      <div>
        <Label htmlFor="notes">Заметки</Label>
        <textarea
          id="notes"
          placeholder="Самочувствие, особенности тренировки..."
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
        className="w-full bg-gym hover:bg-gym/90 text-gym-foreground"
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

export default function GymPage() {
  const [hydrated, setHydrated] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [lastTemplate, setLastTemplate] = useState<LastGymFromDb | null>(null);

  const refreshLast = useCallback(async () => {
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setUserError(user.error);
      setLastFetchError(null);
      setLastTemplate(null);
      return;
    }
    setUserError(null);
    const res = await fetchLastGymWorkoutFromDb(user.userId);
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
          <div className="flex size-9 items-center justify-center rounded-lg bg-gym/15">
            <Dumbbell className="size-5 text-gym" />
          </div>
          <h1 className="text-lg font-semibold">Силовая</h1>
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
              {lastParsed.totalTonnage != null && (
                <>
                  {" "}
                  · тоннаж{" "}
                  {Math.round(lastParsed.totalTonnage).toLocaleString("ru")} кг
                </>
              )}
              . Кнопки в форме —{" "}
              <strong>прогрессия</strong> (+1 повтор; от 18+ — вес ↑, 12 повт).
            </p>
          </CardContent>
        </Card>
      )}

      {hydrated && !userError && (
        <GymWorkoutEditor
          lastWorkout={lastParsed}
          onSaveSuccess={() => void refreshLast()}
        />
      )}
    </div>
  );
}
