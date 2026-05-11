"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exerciseTonnage, totalTonnage } from "@/lib/features/workouts/tonnage";
import {
  gymWorkoutToExerciseInputs,
  type ExerciseInput,
  type SetInput,
} from "@/lib/features/workouts/gymFormFromSeed";
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
  pn: "Пн (верх / тяги)",
  sr: "Ср (ноги / жимы)",
  pt: "Пт (грудь / руки)",
};

function GymWorkoutEditor({ lastWorkout }: { lastWorkout: ParsedGymWorkout | null }) {
  const [date, setDate] = useState(todayString);
  const [bodyWeight, setBodyWeight] = useState(
    () =>
      lastWorkout?.bodyWeight != null ? String(lastWorkout.bodyWeight) : ""
  );
  const [exercises, setExercises] = useState<ExerciseInput[]>(() =>
    lastWorkout
      ? gymWorkoutToExerciseInputs(lastWorkout, true)
      : [newExercise()]
  );
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
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
    <>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!lastWorkout}
              onClick={() => applyFromLast(true)}
            >
              Обновить по прогрессии
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!lastWorkout}
              onClick={() => applyFromLast(false)}
            >
              Как в последней (без +1)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <Label htmlFor="date">Дата</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="w-36">
              <Label htmlFor="bw">Вес тела (кг)</Label>
              <Input
                id="bw"
                type="number"
                step="0.1"
                min="30"
                max="200"
                placeholder="80.0"
                value={bodyWeight}
                onChange={(e) => setBodyWeight(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {exercises.map((ex, exIdx) => {
          const summary = summaries.find((s) => s.id === ex.id)!;
          return (
            <Card key={ex.id}>
              <CardHeader className="pb-2 border-b">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm shrink-0 w-5">
                    {exIdx + 1}.
                  </span>
                  <Input
                    placeholder="Название упражнения"
                    value={ex.name}
                    onChange={(e) => updateName(ex.id, e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    onClick={() => removeExercise(ex.id)}
                    disabled={exercises.length === 1}
                    className="shrink-0 text-muted-foreground"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-sm border-separate border-spacing-x-1">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="text-left font-normal w-12" />
                        {ex.sets.map((_, i) => (
                          <th key={i} className="font-normal text-center min-w-[60px]">
                            <div className="flex items-center justify-center gap-0.5">
                              <span>{i + 1}</span>
                              {ex.sets.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeSet(ex.id, i)}
                                  className="text-muted-foreground/40 hover:text-destructive leading-none ml-0.5"
                                  title="Удалить подход"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </th>
                        ))}
                        {ex.sets.length < 6 && (
                          <th className="font-normal">
                            <button
                              type="button"
                              onClick={() => addSet(ex.id)}
                              className="text-muted-foreground/40 hover:text-primary text-base leading-none"
                              title="Добавить подход"
                            >
                              +
                            </button>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="text-muted-foreground text-xs py-1">кг</td>
                        {ex.sets.map((s, i) => (
                          <td key={i} className="py-1">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              placeholder="—"
                              value={s.weight}
                              onChange={(e) =>
                                updateSet(ex.id, i, "weight", e.target.value)
                              }
                              className="text-center px-1 h-8"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="text-muted-foreground text-xs py-1">повт</td>
                        {ex.sets.map((s, i) => (
                          <td key={i} className="py-1">
                            <Input
                              type="number"
                              min="0"
                              placeholder="—"
                              value={s.reps}
                              onChange={(e) =>
                                updateSet(ex.id, i, "reps", e.target.value)
                              }
                              className="text-center px-1 h-8"
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {summary.tonnage > 0 && (
                  <p className="mt-2 text-right text-sm text-muted-foreground">
                    Тоннаж:{" "}
                    <span className="font-medium text-foreground">
                      {summary.tonnage.toLocaleString("ru")} кг
                    </span>
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button variant="outline" onClick={addExercise} className="w-full" type="button">
        <Plus />
        Добавить упражнение
      </Button>

      {total > 0 && (
        <Card className="bg-primary text-primary-foreground ring-0">
          <CardContent className="pt-4">
            <div className="flex justify-between items-center">
              <span className="opacity-80">Общий тоннаж</span>
              <span className="text-2xl font-bold">
                {total.toLocaleString("ru")} кг
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <Label htmlFor="notes">Заметки (необязательно)</Label>
        <textarea
          id="notes"
          placeholder="Самочувствие, особенности тренировки..."
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

export default function GymPage() {
  const { seed, error: seedError, loading: seedLoading } = useWorkoutSeed();
  const [gymDay, setGymDay] = useState<GymDayKey>(defaultGymDay);

  const lastWorkout = useMemo(() => {
    if (!seed) return null;
    const dayList = seed.gym[gymDay] ?? [];
    return dayList.length ? dayList[dayList.length - 1]! : null;
  }, [seed, gymDay]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Dumbbell className="size-5" />
        <h2 className="text-xl font-semibold">Силовая тренировка</h2>
      </div>

      {seedLoading && (
        <p className="text-sm text-muted-foreground">Загрузка данных из таблицы…</p>
      )}
      {seedError && (
        <p className="text-sm text-destructive">
          Нет файла импорта: {seedError}. Выполни в корне проекта{" "}
          <code className="rounded bg-muted px-1">npm run build:seed</code> — появится{" "}
          <code className="rounded bg-muted px-1">public/data/workout-seed.json</code>.
        </p>
      )}

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div>
            <Label htmlFor="gym-day">День программы (лист из таблицы)</Label>
            <select
              id="gym-day"
              value={gymDay}
              onChange={(e) => setGymDay(e.target.value as GymDayKey)}
              className="mt-1 flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {(Object.keys(DAY_LABELS) as GymDayKey[]).map((k) => (
                <option key={k} value={k}>
                  {DAY_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {lastWorkout && (
            <p className="text-xs text-muted-foreground">
              Последняя в импорте:{" "}
              <span className="font-medium text-foreground">
                {new Date(lastWorkout.date + "T12:00:00").toLocaleDateString("ru")}
              </span>
              {lastWorkout.totalTonnage != null && (
                <>
                  {" "}
                  · тоннаж{" "}
                  {Math.round(lastWorkout.totalTonnage).toLocaleString("ru")} кг
                </>
              )}
              . В форме —{" "}
              <strong>прогрессия</strong> (+1 повтор; от 18+ — вес ↑, 12 повт).
            </p>
          )}
        </CardContent>
      </Card>

      {seed && (
        <GymWorkoutEditor
          key={`${gymDay}-${seed.generatedAt}`}
          lastWorkout={lastWorkout}
        />
      )}
    </div>
  );
}
