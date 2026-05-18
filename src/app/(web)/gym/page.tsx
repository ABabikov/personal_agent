"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Dumbbell, Sparkles, RotateCcw, Flame, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  estimateGymCalories,
  GYM_INTENSITY_LABEL_RU,
} from "@/lib/features/workouts/calories";
import { gymWorkoutToExerciseInputs } from "@/lib/features/workouts/gymFormFromSeed";
import type { ParsedGymWorkout } from "@/lib/features/workouts/csvImport";
import type { GymSet } from "@/types/database";
import {
  completeWorkout,
  fetchActiveGymWorkout,
  fetchGymWorkoutById,
  softDeleteWorkout,
  updateGymWorkoutToSupabase,
  upsertActiveGymWorkout,
  type LoadedGymWorkout,
} from "@/lib/db/workoutMutations";
import {
  confirmEditCompletedWorkout,
  WORKOUT_STATUS_LABEL_RU,
} from "@/lib/features/workouts/workoutStatus";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import {
  fetchGymAutofillTemplateFromDb,
  fetchLastGymWorkoutForWeekdayFromDb,
  fetchLastGymWorkoutFromDb,
  type LastGymFromDb,
} from "@/lib/db/fetchLastWorkoutTemplates";
import {
  WEEKDAY_RU_LONG,
  weekdayIdx,
  type WeekdayIdx,
} from "@/lib/features/workouts/analytics";
import { loadUserProfile } from "@/lib/db/profile";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";

/** Пресеты 1–3 = последняя силовая в этот день недели (локальный календарь). */
const SPLIT_PRESET_WEEKDAY: Record<"1" | "2" | "3", WeekdayIdx> = {
  "1": 1,
  "2": 3,
  "3": 5,
};

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

type GymSessionStatus = "new" | "active" | "completed";

function GymWorkoutEditor({
  sessionStatus,
  workoutId,
  date,
  onDateChange,
  templateWorkout,
  initialParsed,
  initialNotes = "",
  profileWeightKg,
  onSaveSuccess,
  onWorkoutId,
  onCompleted,
  onDeleted,
}: {
  sessionStatus: GymSessionStatus;
  workoutId?: string;
  date: string;
  onDateChange: (iso: string) => void;
  templateWorkout: ParsedGymWorkout | null;
  initialParsed?: ParsedGymWorkout | null;
  initialNotes?: string;
  profileWeightKg: number | null;
  onSaveSuccess?: () => void;
  onWorkoutId?: (id: string) => void;
  onCompleted?: () => void;
  onDeleted?: () => void;
}) {
  const isActive = sessionStatus === "active";
  const isCompleted = sessionStatus === "completed";
  const isNew = sessionStatus === "new";
  const [bodyWeight, setBodyWeight] = useState(() => {
    if (initialParsed?.bodyWeight != null) return String(initialParsed.bodyWeight);
    if (isNew && templateWorkout?.bodyWeight != null) {
      return String(templateWorkout.bodyWeight);
    }
    return "";
  });
  const [exercises, setExercises] = useState<ExerciseInput[]>(() => {
    if (initialParsed) {
      return gymWorkoutToExerciseInputs(initialParsed, false);
    }
    if (isNew && templateWorkout) {
      return gymWorkoutToExerciseInputs(templateWorkout, true);
    }
    return [newExercise()];
  });
  const [notes, setNotes] = useState(initialNotes);
  const [durationStr, setDurationStr] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [completeState, setCompleteState] = useState<"idle" | "completing">(
    "idle"
  );
  const [deleteState, setDeleteState] = useState<"idle" | "deleting">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  function applyFromLast(withProgression: boolean) {
    if (!templateWorkout) return;
    setExercises(gymWorkoutToExerciseInputs(templateWorkout, withProgression));
    if (templateWorkout.bodyWeight != null) {
      setBodyWeight(String(templateWorkout.bodyWeight));
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

  const parsedDuration = useMemo(() => {
    const t = durationStr.trim();
    if (!t) return null;
    const n = parseFloat(t.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [durationStr]);

  const effectiveWeight = useMemo(() => {
    const fromForm = parseFloat(bodyWeight);
    if (Number.isFinite(fromForm) && fromForm > 0) return fromForm;
    return profileWeightKg && profileWeightKg > 0 ? profileWeightKg : null;
  }, [bodyWeight, profileWeightKg]);

  const calorieEstimate = useMemo(() => {
    if (!effectiveWeight) return null;
    return estimateGymCalories({
      bodyWeightKg: effectiveWeight,
      exercises: summaries.map((s) => ({ sets: s.sets })),
      durationMinOverride: parsedDuration,
    });
  }, [effectiveWeight, summaries, parsedDuration]);

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

    const payload = {
      date,
      bodyWeightStr: bodyWeight,
      exercises: exercisesPayload,
      notes,
      profileWeightKg,
      durationMinOverride: parsedDuration,
    };

    let result:
      | { ok: true; workoutId?: string }
      | { error: string };

    if (isCompleted && workoutId) {
      result = await updateGymWorkoutToSupabase({
        workoutId,
        ...payload,
      });
    } else {
      result = await upsertActiveGymWorkout({
        workoutId,
        ...payload,
      });
      if ("ok" in result && result.workoutId && !workoutId) {
        onWorkoutId?.(result.workoutId);
      }
    }

    if ("error" in result) {
      setSaveError(result.error);
      setSaveState("idle");
      return;
    }

    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
    onSaveSuccess?.();
  }

  async function handleComplete() {
    if (!isActive && !isNew) return;
    setSaveError(null);
    setCompleteState("completing");

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

    const saved = await upsertActiveGymWorkout({
      workoutId,
      date,
      bodyWeightStr: bodyWeight,
      exercises: exercisesPayload,
      notes,
      profileWeightKg,
      durationMinOverride: parsedDuration,
    });

    if ("error" in saved) {
      setSaveError(saved.error);
      setCompleteState("idle");
      return;
    }

    const id = saved.workoutId;
    if (!workoutId) onWorkoutId?.(id);

    const done = await completeWorkout(id);
    setCompleteState("idle");
    if ("error" in done) {
      setSaveError(done.error);
      return;
    }
    onCompleted?.();
  }

  async function handleDelete() {
    if (!workoutId) return;
    const msg = isActive
      ? "Отменить активную тренировку? Черновик будет удалён."
      : "Удалить эту тренировку? Она исчезнет из календаря и сводок. В базе останется скрытой записью.";
    if (!confirm(msg)) return;
    if (isCompleted && !confirmEditCompletedWorkout()) return;

    setSaveError(null);
    setDeleteState("deleting");
    const result = await softDeleteWorkout(workoutId);
    setDeleteState("idle");
    if ("error" in result) {
      setSaveError(result.error);
      return;
    }
    onDeleted?.();
  }

  const busy =
    saveState === "saving" ||
    deleteState === "deleting" ||
    completeState === "completing";

  return (
    <div className="space-y-4">
      {isActive && (
        <Card className="border-gym/30 bg-gym/5">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {WORKOUT_STATUS_LABEL_RU.active}
              </span>
              {" — "}
              сохраняйте черновик по ходу. После тренировки нажмите «Завершить» —
              тогда запись попадёт в календарь и сводки.
            </p>
          </CardContent>
        </Card>
      )}

      {isNew && templateWorkout && (
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
                onChange={(e) => onDateChange(e.target.value)}
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

      {calorieEstimate && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15">
                <Flame className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Калории (оценка)</p>
                <p className="text-xs text-muted-foreground">
                  {GYM_INTENSITY_LABEL_RU[calorieEstimate.intensity]} · {calorieEstimate.met} MET
                  · ~{calorieEstimate.durationMin} мин
                  {calorieEstimate.durationFromOverride ? " (вручную)" : " (авто)"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums">
                ~{calorieEstimate.calories}
              </p>
              <p className="text-xs text-muted-foreground">ккал · EPOC +7%</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            По тоннажу для сверки: ~{calorieEstimate.tonnageBasedCalories} ккал
            (плотность {calorieEstimate.density} кг·мин⁻¹).
          </p>
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-3">
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
        <div className="w-28">
          <Label htmlFor="duration">Длительность</Label>
          <div className="relative mt-1.5">
            <Input
              id="duration"
              type="number"
              min="10"
              max="240"
              step="5"
              placeholder={
                calorieEstimate
                  ? `~${calorieEstimate.durationMin}`
                  : "авто"
              }
              value={durationStr}
              onChange={(e) => setDurationStr(e.target.value)}
              className="pr-8"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              мин
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
            Авто — 4.5 мин/подход
          </p>
        </div>
      </div>

      {!effectiveWeight && (
        <p className="text-[11px] text-muted-foreground">
          Калории не считаются: заполните вес тела или укажите его в профиле.
        </p>
      )}

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <Button
        onClick={handleSave}
        className="w-full bg-gym hover:bg-gym/90 text-gym-foreground"
        size="lg"
        disabled={busy}
      >
        {saveState === "saving"
          ? "Сохранение..."
          : saveState === "saved"
            ? "Черновик сохранён"
            : isCompleted
              ? "Сохранить изменения"
              : "Сохранить черновик"}
      </Button>

      {(isActive || isNew) && (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => void handleComplete()}
        >
          {completeState === "completing"
            ? "Завершение…"
            : "Завершить тренировку"}
        </Button>
      )}

      {workoutId && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={busy}
          onClick={() => void handleDelete()}
        >
          <Trash2 className="size-4" />
          {deleteState === "deleting"
            ? "Удаление…"
            : isActive
              ? "Отменить черновик"
              : "Удалить тренировку"}
        </Button>
      )}
    </div>
  );
}

type FillSource = "history" | "1" | "2" | "3";

function GymPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit")?.trim() || null;

  useRegisterPageChatContext(
    editId ? "Редактирование силовой" : "Зал",
    editId
      ? "Редактирование сохранённой силовой тренировки."
      : "Силовая: шаблон из истории по дате или последние записи пн / ср / пт; прогрессия и калории."
  );

  const [editData, setEditData] = useState<LoadedGymWorkout | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(Boolean(editId));
  const [editDate, setEditDate] = useState(todayString);
  const [editConfirmed, setEditConfirmed] = useState(false);
  const [activeWorkout, setActiveWorkout] = useState<LoadedGymWorkout | null>(
    null
  );

  const [hydrated, setHydrated] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [lastTemplate, setLastTemplate] = useState<LastGymFromDb | null>(null);
  const [globalLastTemplate, setGlobalLastTemplate] =
    useState<LastGymFromDb | null>(null);
  const [profileWeightKg, setProfileWeightKg] = useState<number | null>(null);
  const [gymDate, setGymDate] = useState(todayString);
  const [fillSource, setFillSource] = useState<FillSource>("history");
  /** Последняя силовая в пн / ср / пт — для «пресетов» 1–3 */
  const [splitDayTemplates, setSplitDayTemplates] = useState<{
    mon: LastGymFromDb | null;
    wed: LastGymFromDb | null;
    fri: LastGymFromDb | null;
  }>({ mon: null, wed: null, fri: null });

  const refreshLast = useCallback(async () => {
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setUserError(user.error);
      setLastFetchError(null);
      setLastTemplate(null);
      setGlobalLastTemplate(null);
      setSplitDayTemplates({ mon: null, wed: null, fri: null });
      return;
    }
    setUserError(null);
    const [
      autofillRes,
      globalRes,
      profileRes,
      monRes,
      wedRes,
      friRes,
    ] = await Promise.all([
      fetchGymAutofillTemplateFromDb(user.userId, gymDate),
      fetchLastGymWorkoutFromDb(user.userId),
      loadUserProfile(user.userId),
      fetchLastGymWorkoutForWeekdayFromDb(user.userId, SPLIT_PRESET_WEEKDAY["1"]),
      fetchLastGymWorkoutForWeekdayFromDb(user.userId, SPLIT_PRESET_WEEKDAY["2"]),
      fetchLastGymWorkoutForWeekdayFromDb(user.userId, SPLIT_PRESET_WEEKDAY["3"]),
    ]);
    if ("error" in autofillRes) {
      setLastFetchError(autofillRes.error);
      setLastTemplate(null);
    } else {
      setLastFetchError(null);
      setLastTemplate(autofillRes.data);
    }
    if ("error" in globalRes) {
      setGlobalLastTemplate(null);
    } else {
      setGlobalLastTemplate(globalRes.data);
    }
    if ("data" in profileRes && profileRes.data?.weight) {
      setProfileWeightKg(profileRes.data.weight);
    }
    setSplitDayTemplates({
      mon: "error" in monRes ? null : monRes.data,
      wed: "error" in wedRes ? null : wedRes.data,
      fri: "error" in friRes ? null : friRes.data,
    });
    const activeRes = await fetchActiveGymWorkout(user.userId);
    if ("error" in activeRes) {
      setActiveWorkout(null);
    } else {
      setActiveWorkout(activeRes.data);
      if (activeRes.data) {
        setGymDate(activeRes.data.parsed.date);
      }
    }
  }, [gymDate]);

  const reloadActiveWorkout = useCallback(async (workoutId: string) => {
    const user = await getWorkoutUserId();
    if ("error" in user) return;
    const res = await fetchGymWorkoutById(user.userId, workoutId);
    if ("data" in res) setActiveWorkout(res.data);
  }, []);

  useEffect(() => {
    if (editId) return;
    let cancelled = false;
    (async () => {
      await refreshLast();
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLast, editId]);

  useEffect(() => {
    if (!editId) {
      setEditData(null);
      setEditLoadError(null);
      setEditLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setEditLoading(true);
      setEditLoadError(null);
      const user = await getWorkoutUserId();
      if ("error" in user) {
        if (!cancelled) {
          setEditLoadError(user.error);
          setEditLoading(false);
        }
        return;
      }
      const [workoutRes, profileRes] = await Promise.all([
        fetchGymWorkoutById(user.userId, editId),
        loadUserProfile(user.userId),
      ]);
      if (cancelled) return;
      if ("error" in workoutRes) {
        setEditLoadError(workoutRes.error);
        setEditData(null);
      } else {
        setEditData(workoutRes.data);
        setEditDate(workoutRes.data.parsed.date);
      }
      if ("data" in profileRes && profileRes.data?.weight) {
        setProfileWeightKg(profileRes.data.weight);
      }
      setEditLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  useEffect(() => {
    if (editData?.status === "active") {
      router.replace("/gym");
    }
  }, [editData, router]);

  const lastParsed = lastTemplate?.parsed ?? null;
  const globalParsed = globalLastTemplate?.parsed ?? null;
  const autofillMatchesWeekday =
    lastParsed != null && weekdayIdx(lastParsed.date) === weekdayIdx(gymDate);

  const templateWorkout = useMemo((): ParsedGymWorkout | null => {
    if (fillSource === "history") return lastParsed;
    const bundle =
      fillSource === "1"
        ? splitDayTemplates.mon
        : fillSource === "2"
          ? splitDayTemplates.wed
          : splitDayTemplates.fri;
    return bundle?.parsed ?? null;
  }, [fillSource, lastParsed, splitDayTemplates]);

  const gymEditorMountKey = useMemo(() => {
    if (fillSource === "history") return "history";
    const bundle =
      fillSource === "1"
        ? splitDayTemplates.mon
        : fillSource === "2"
          ? splitDayTemplates.wed
          : splitDayTemplates.fri;
    return `split-${fillSource}-${bundle?.sourceWorkoutId ?? "none"}-${bundle?.parsed.date ?? ""}`;
  }, [fillSource, splitDayTemplates]);

  const splitPresetWeekdayIdx: WeekdayIdx | null =
    fillSource === "history"
      ? null
      : SPLIT_PRESET_WEEKDAY[fillSource as "1" | "2" | "3"];

  if (editId) {
    const editDateLabel = editData
      ? new Date(editData.parsed.date + "T12:00:00").toLocaleDateString("ru", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gym/15">
              <Dumbbell className="size-5 text-gym" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">
                Редактирование силовой
              </h1>
              {editDateLabel && (
                <p className="text-xs text-muted-foreground">{editDateLabel}</p>
              )}
            </div>
          </div>
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            На главную
          </Link>
        </div>

        {editLoading && (
          <p className="text-sm text-muted-foreground">Загрузка тренировки…</p>
        )}
        {editLoadError && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <p className="text-sm text-destructive" role="alert">
                {editLoadError}
              </p>
              <Link
                href="/"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Вернуться в календарь
              </Link>
            </CardContent>
          </Card>
        )}
        {editData &&
          editData.status === "completed" &&
          !editConfirmed &&
          !editLoading &&
          !editLoadError && (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <p className="text-sm text-muted-foreground">
                  Эта тренировка уже{" "}
                  <span className="font-medium text-foreground">завершена</span>{" "}
                  и учтена в календаре. Редактирование изменит сводки и графики.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    if (confirmEditCompletedWorkout()) setEditConfirmed(true);
                  }}
                >
                  Редактировать завершённую
                </Button>
                <Link
                  href="/"
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "w-full",
                  })}
                >
                  Вернуться в календарь
                </Link>
              </CardContent>
            </Card>
          )}
        {editData &&
          editData.status === "completed" &&
          editConfirmed &&
          !editLoading &&
          !editLoadError && (
            <GymWorkoutEditor
              key={editData.workoutId}
              sessionStatus={
                editData.status === "completed" ? "completed" : "active"
              }
              workoutId={editData.workoutId}
              date={editDate}
              onDateChange={setEditDate}
              templateWorkout={null}
              initialParsed={editData.parsed}
              initialNotes={editData.notes}
              profileWeightKg={profileWeightKg}
              onSaveSuccess={() => router.push("/")}
              onDeleted={() => router.push("/")}
            />
          )}
      </div>
    );
  }

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

      {hydrated && !userError && fillSource === "history" && lastParsed && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">
              {autofillMatchesWeekday ? (
                <>
                  Автозаполнение от последней{" "}
                  <span className="font-medium text-foreground">
                    {WEEKDAY_RU_LONG[weekdayIdx(gymDate)]}
                  </span>
                  :{" "}
                  <span className="font-medium text-foreground">
                    {new Date(lastParsed.date + "T12:00:00").toLocaleDateString(
                      "ru"
                    )}
                  </span>
                </>
              ) : (
                <>
                  В{" "}
                  <span className="font-medium text-foreground">
                    {WEEKDAY_RU_LONG[weekdayIdx(gymDate)]}
                  </span>{" "}
                  ещё не было записей — для кнопок взята последняя силовая (
                  <span className="font-medium text-foreground">
                    {new Date(lastParsed.date + "T12:00:00").toLocaleDateString(
                      "ru"
                    )}
                  </span>
                  ).
                </>
              )}
              {lastParsed.totalTonnage != null && (
                <>
                  {" "}
                  · тоннаж шаблона{" "}
                  {Math.round(lastParsed.totalTonnage).toLocaleString("ru")} кг
                </>
              )}
              {globalParsed &&
                globalParsed.date !== lastParsed.date &&
                globalParsed.totalTonnage != null && (
                  <>
                    {" "}
                    Всего последняя запись:{" "}
                    {new Date(
                      globalParsed.date + "T12:00:00"
                    ).toLocaleDateString("ru")}
                    , тоннаж{" "}
                    {Math.round(globalParsed.totalTonnage).toLocaleString("ru")}{" "}
                    кг.
                  </>
                )}
              {" "}
              Кнопки в форме — <strong>прогрессия</strong> (+1 повтор; от 18+ —
              вес ↑, 12 повт).
            </p>
          </CardContent>
        </Card>
      )}

      {hydrated && !userError && fillSource === "history" && !lastParsed && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">
              Пока нет ни одной сохранённой силовой — заполните форму вручную или
              выберите понедельник / среду / пятницу ниже. После первой записи
              появится автозаполнение по дню недели для выбранной даты.
            </p>
          </CardContent>
        </Card>
      )}

      {hydrated &&
        !userError &&
        fillSource !== "history" &&
        splitPresetWeekdayIdx !== null &&
        templateWorkout && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">
                Шаблон — последняя силовая в{" "}
                <span className="font-medium text-foreground">
                  {WEEKDAY_RU_LONG[splitPresetWeekdayIdx]}
                </span>
                :{" "}
                <span className="font-medium text-foreground">
                  {new Date(
                    templateWorkout.date + "T12:00:00"
                  ).toLocaleDateString("ru")}
                </span>
                {" — "}
                {templateWorkout.exercises.length} упражнений
                {templateWorkout.totalTonnage != null && (
                  <>
                    , тоннаж шаблона{" "}
                    {Math.round(templateWorkout.totalTonnage).toLocaleString(
                      "ru"
                    )}{" "}
                    кг
                  </>
                )}
                . Кнопки — <strong>прогрессия</strong> (+1 повтор; от 18+ — вес ↑,
                12 повт).
              </p>
            </CardContent>
          </Card>
        )}

      {hydrated &&
        !userError &&
        fillSource !== "history" &&
        splitPresetWeekdayIdx !== null &&
        !templateWorkout && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">
                В{" "}
                <span className="font-medium text-foreground">
                  {WEEKDAY_RU_LONG[splitPresetWeekdayIdx]}
                </span>{" "}
                пока нет ни одной сохранённой силовой — начните с пустой формы или
                выберите другой источник шаблона.
              </p>
            </CardContent>
          </Card>
        )}

      {hydrated && !userError && (
        <>
          <Card>
            <CardContent className="space-y-3 pt-4">
              <div>
                <Label htmlFor="fill-source">
                  Шаблон для «прогрессия» / «как было»
                </Label>
                <select
                  id="fill-source"
                  className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={fillSource}
                  onChange={(e) =>
                    setFillSource(e.target.value as FillSource)
                  }
                >
                  <option value="history">
                    По дате в форме (день недели + запасной вариант)
                  </option>
                  <option value="1">Понедельник — последняя запись</option>
                  <option value="2">Среда — последняя запись</option>
                  <option value="3">Пятница — последняя запись</option>
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Пресеты 1–3 всегда берут последнюю силовую в свой день недели,
                  независимо от выбранной даты тренировки.
                </p>
              </div>
            </CardContent>
          </Card>

          <GymWorkoutEditor
            key={activeWorkout?.workoutId ?? gymEditorMountKey}
            sessionStatus={activeWorkout ? "active" : "new"}
            workoutId={activeWorkout?.workoutId}
            date={gymDate}
            onDateChange={setGymDate}
            templateWorkout={activeWorkout ? null : templateWorkout}
            initialParsed={activeWorkout?.parsed}
            initialNotes={activeWorkout?.notes ?? ""}
            profileWeightKg={profileWeightKg}
            onWorkoutId={(id) => void reloadActiveWorkout(id)}
            onSaveSuccess={() => {
              if (activeWorkout?.workoutId) {
                void reloadActiveWorkout(activeWorkout.workoutId);
              } else {
                void refreshLast();
              }
            }}
            onCompleted={() => {
              setActiveWorkout(null);
              router.push("/");
            }}
            onDeleted={() => {
              setActiveWorkout(null);
              void refreshLast();
            }}
          />
        </>
      )}
    </div>
  );
}

export default function GymPage() {
  return (
    <Suspense
      fallback={
        <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>
      }
    >
      <GymPageContent />
    </Suspense>
  );
}
