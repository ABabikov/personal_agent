"use client";

import { useMemo, useState } from "react";
import { Plus, Dumbbell, ChevronDown, Sparkles, RotateCcw } from "lucide-react";
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
import { useWorkoutSeed } from "@/hooks/use-workout-seed";
import type { GymDayKey } from "@/lib/features/workouts/workoutSeedTypes";
import type { GymSet } from "@/types/database";
import { saveGymWorkoutToSupabase } from "@/lib/db/saveWorkout";

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

function defaultGymDay(): GymDayKey {
  const dow = new Date().getDay();
  if (dow === 1) return "pn";
  if (dow === 3) return "sr";
  if (dow === 5) return "pt";
  return "pn";
}

const DAY_LABELS: Record<GymDayKey, string> = {
  pn: "Понедельник — Верх / Тяги",
  sr: "Среда — Ноги / Жимы",
  pt: "Пятница — Грудь / Руки",
};

const DAY_SHORT: Record<GymDayKey, string> = {
  pn: "Пн",
  sr: "Ср",
  pt: "Пт",
};

function GymWorkoutEditor({
  lastWorkout,
}: {
  lastWorkout: ParsedGymWorkout | null;
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
  }

  return (
    <div className="space-y-4">
      {/* Prefill actions */}
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

      {/* Date and body weight */}
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

      {/* Exercises */}
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

      {/* Add exercise */}
      <Button
        variant="outline"
        onClick={addExercise}
        className="w-full border-dashed"
      >
        <Plus className="size-4" />
        <span>Добавить упражнение</span>
      </Button>

      {/* Total tonnage */}
      <TotalCard
        icon={Dumbbell}
        label="Общий тоннаж"
        value={total}
        unit="кг"
        variant="gym"
      />

      {/* Notes */}
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

      {/* Error */}
      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      {/* Save button */}
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
  const { seed, error: seedError, loading: seedLoading } = useWorkoutSeed();
  const [gymDay, setGymDay] = useState<GymDayKey>(defaultGymDay);
  const [showDayPicker, setShowDayPicker] = useState(false);

  const lastWorkout = useMemo(() => {
    if (!seed) return null;
    const dayList = seed.gym[gymDay] ?? [];
    return dayList.length ? dayList[dayList.length - 1]! : null;
  }, [seed, gymDay]);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gym/15">
            <Dumbbell className="size-5 text-gym" />
          </div>
          <h1 className="text-lg font-semibold">Силовая</h1>
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
            <p className="text-sm font-medium">{DAY_LABELS[gymDay]}</p>
            {lastWorkout && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Последняя:{" "}
                {new Date(lastWorkout.date + "T12:00:00").toLocaleDateString(
                  "ru",
                  { day: "numeric", month: "short" }
                )}
                {lastWorkout.totalTonnage != null && (
                  <> — {Math.round(lastWorkout.totalTonnage).toLocaleString("ru")} кг</>
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
            {(Object.keys(DAY_LABELS) as GymDayKey[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setGymDay(k);
                  setShowDayPicker(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent ${
                  gymDay === k ? "bg-accent" : ""
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gym/15 text-sm font-medium text-gym">
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
        <GymWorkoutEditor
          key={`${gymDay}-${seed.generatedAt}`}
          lastWorkout={lastWorkout}
        />
      )}
    </div>
  );
}
