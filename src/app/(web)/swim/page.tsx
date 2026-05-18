"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Waves,
  RotateCcw,
  Sparkles,
  History,
  CalendarClock,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SwimSeriesCard,
  type SwimSeriesInput,
} from "@/components/workout/swim-series-card";
import { TotalCard } from "@/components/workout/total-card";
import { totalDistance } from "@/lib/features/swimming/distance";
import { inferBreakdownForSeries } from "@/lib/features/swimming/inferBreakdown";
import { generateSwimWorkoutPlan } from "@/lib/features/swimming/generatePlan";
import { buildWorkoutFromCatalog } from "@/lib/features/swimming/buildWorkoutFromCatalog";
import {
  SWIM_GENERATION_COACH_PROMPT_BLOCK,
  adjustTargetVolumeForBias,
  formatMediumPlanForCoachNote,
  suggestVolumeBias,
} from "@/lib/features/swimming/swimGenerationMethodology";
import { loadSwimMediumGoals } from "@/lib/features/swimming/swimMediumGoalsStorage";
import { swimMetersRolling28Days } from "@/lib/features/swimming/swimRollingStats";
import { defaultShuffleSeed } from "@/lib/features/swimming/swimPlanRng";
import {
  SWIM_GOALS,
  formatGoalsLabel,
  type SwimGoalCode,
} from "@/lib/features/swimming/swimGoals";
import { fetchSwimBlockTemplates } from "@/lib/db/fetchSwimBlockTemplates";
import {
  fetchSwimEquipment,
  saveSwimEquipment,
} from "@/lib/db/swimEquipmentProfile";
import {
  ALL_SWIM_EQUIPMENT_IDS,
  SWIM_EQUIPMENT_ITEMS,
  type SwimEquipmentId,
} from "@/lib/features/swimming/swimEquipment";
import { cn } from "@/lib/utils";
import { swimWorkoutToSeriesInputs } from "@/lib/features/workouts/swimFormFromSeed";
import type { ParsedSwimWorkout } from "@/lib/features/workouts/csvImport";
import {
  completeWorkout,
  fetchActiveSwimWorkout,
  fetchSwimWorkoutById,
  softDeleteWorkout,
  updateSwimWorkoutToSupabase,
  upsertActiveSwimWorkout,
  type LoadedSwimWorkout,
} from "@/lib/db/workoutMutations";
import {
  confirmEditCompletedWorkout,
  WORKOUT_STATUS_LABEL_RU,
} from "@/lib/features/workouts/workoutStatus";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import {
  fetchLastSwimWorkoutFromDb,
  fetchSwimWorkoutsHistoryFromDb,
  type LastSwimFromDb,
  type SwimHistoryListItem,
} from "@/lib/db/fetchLastWorkoutTemplates";
import { SwimMediumPlanCard } from "@/components/swim/swim-medium-plan-card";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";

function newId() {
  return Math.random().toString(36).slice(2);
}

function newSeries(): SwimSeriesInput {
  return {
    id: newId(),
    distance: "",
    description: "",
    reps: "",
    perRepM: "",
  };
}

function todayString() {
  return new Date().toISOString().split("T")[0];
}

type SwimSessionStatus = "new" | "active" | "completed";

function SwimWorkoutEditor({
  sessionStatus,
  workoutId,
  lastWorkout,
  initialParsed,
  initialNotes = "",
  onSaveSuccess,
  onWorkoutId,
  onCompleted,
  planDraft,
  historyApply,
  onDeleted,
}: {
  sessionStatus: SwimSessionStatus;
  workoutId?: string;
  lastWorkout: ParsedSwimWorkout | null;
  initialParsed?: ParsedSwimWorkout | null;
  initialNotes?: string;
  onSaveSuccess?: () => void;
  onWorkoutId?: (id: string) => void;
  onCompleted?: () => void;
  /** Атомарно подставляет серии из планировщика (revision меняется каждый раз при генерации). */
  planDraft?: { revision: number; rows: SwimSeriesInput[] } | null;
  /** Подстановка серий из истории; dateMode «today» — дата формы = сегодня. */
  historyApply?: {
    revision: number;
    workout: ParsedSwimWorkout;
    dateMode: "today" | "preserve";
  } | null;
  onDeleted?: () => void;
}) {
  const isActive = sessionStatus === "active";
  const isCompleted = sessionStatus === "completed";
  const isNew = sessionStatus === "new";
  const [date, setDate] = useState(() =>
    initialParsed ? initialParsed.date : todayString()
  );
  const [series, setSeries] = useState<SwimSeriesInput[]>(() => {
    if (initialParsed) return swimWorkoutToSeriesInputs(initialParsed);
    if (isNew && lastWorkout) return swimWorkoutToSeriesInputs(lastWorkout);
    return [newSeries()];
  });
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [completeState, setCompleteState] = useState<"idle" | "completing">(
    "idle"
  );
  const [deleteState, setDeleteState] = useState<"idle" | "deleting">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!planDraft?.rows?.length) return;
    setSeries(planDraft.rows.map((s) => ({ ...s })));
  }, [planDraft?.revision]);

  useEffect(() => {
    if (!historyApply) return;
    setSeries(swimWorkoutToSeriesInputs(historyApply.workout));
    setDate(
      historyApply.dateMode === "today"
        ? todayString()
        : historyApply.workout.date
    );
    setSaveError(null);
  }, [historyApply?.revision]);

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
      prev.map((s) =>
        s.id === id
          ? { ...s, distance, reps: "", perRepM: "" }
          : s
      )
    );
  }

  function updateBreakdown(id: string, reps: string, perRepM: string) {
    const r = parseInt(reps.trim(), 10);
    const m = parseInt(perRepM.trim(), 10);
    const ok =
      Number.isFinite(r) &&
      Number.isFinite(m) &&
      r > 0 &&
      m > 0;
    setSeries((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return {
          ...s,
          reps,
          perRepM,
          ...(ok ? { distance: String(r * m) } : {}),
        };
      })
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

    const payload = { date, series: seriesPayload, notes };

    let result:
      | { ok: true; workoutId?: string }
      | { error: string };

    if (isCompleted && workoutId) {
      result = await updateSwimWorkoutToSupabase({ workoutId, ...payload });
    } else {
      result = await upsertActiveSwimWorkout({ workoutId, ...payload });
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
    const seriesPayload = series.map((s) => ({
      distance: parseInt(s.distance, 10) || 0,
      description: s.description,
    }));
    const saved = await upsertActiveSwimWorkout({
      workoutId,
      date,
      series: seriesPayload,
      notes,
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
        <Card className="border-swim/30 bg-swim/5">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {WORKOUT_STATUS_LABEL_RU.active}
              </span>
              {" — "}
              сохраняйте черновик по ходу. «Завершить» — запись попадёт в календарь.
            </p>
          </CardContent>
        </Card>
      )}

      {isNew && lastWorkout && (
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
            onBreakdownChange={(reps, perRepM) =>
              updateBreakdown(s.id, reps, perRepM)
            }
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

function SwimPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit")?.trim() || null;
  const [hydrated, setHydrated] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [lastTemplate, setLastTemplate] = useState<LastSwimFromDb | null>(null);
  const [workoutUserId, setWorkoutUserId] = useState<string | null>(null);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);

  const [targetVolume, setTargetVolume] = useState("2500");
  /** 1–2 фокуса: в каталоге подходят блоки, у которых в goal_tags есть хотя бы один из них */
  const [selectedGoals, setSelectedGoals] = useState<SwimGoalCode[]>([
    "mixed",
  ]);
  const [focusText, setFocusText] = useState("");
  const [planGenerating, setPlanGenerating] = useState(false);
  const [planDraft, setPlanDraft] = useState<{
    revision: number;
    rows: SwimSeriesInput[];
  } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);

  const [filterGear, setFilterGear] = useState(false);
  const [inventory, setInventory] = useState<string[]>(() => [
    ...ALL_SWIM_EQUIPMENT_IDS,
  ]);
  const [gearSaveState, setGearSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<SwimHistoryListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyApply, setHistoryApply] = useState<{
    revision: number;
    workout: ParsedSwimWorkout;
    dateMode: "today" | "preserve";
  } | null>(null);
  const [generationMeta, setGenerationMeta] = useState<string | null>(null);
  const [editData, setEditData] = useState<LoadedSwimWorkout | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(Boolean(editId));
  const [editConfirmed, setEditConfirmed] = useState(false);
  const [activeWorkout, setActiveWorkout] = useState<LoadedSwimWorkout | null>(
    null
  );

  const refreshLast = useCallback(async () => {
    const user = await getWorkoutUserId();
    if ("error" in user) {
      setUserError(user.error);
      setWorkoutUserId(null);
      setLastFetchError(null);
      setLastTemplate(null);
      return;
    }
    setWorkoutUserId(user.userId);
    setUserError(null);
    const res = await fetchLastSwimWorkoutFromDb(user.userId);
    if ("error" in res) {
      setLastFetchError(res.error);
      setLastTemplate(null);
    } else {
      setLastFetchError(null);
      setLastTemplate(res.data);
    }
    const activeRes = await fetchActiveSwimWorkout(user.userId);
    if ("error" in activeRes) {
      setActiveWorkout(null);
    } else {
      setActiveWorkout(activeRes.data);
    }
  }, []);

  const reloadActiveWorkout = useCallback(async (workoutId: string) => {
    const user = await getWorkoutUserId();
    if ("error" in user) return;
    const res = await fetchSwimWorkoutById(user.userId, workoutId);
    if ("data" in res) setActiveWorkout(res.data);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!workoutUserId) return;
    setHistoryLoading(true);
    setHistoryErr(null);
    const res = await fetchSwimWorkoutsHistoryFromDb(workoutUserId, 40);
    setHistoryLoading(false);
    if ("error" in res) {
      setHistoryErr(res.error);
      setHistoryItems([]);
      return;
    }
    setHistoryItems(res.data);
  }, [workoutUserId]);

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
      setWorkoutUserId(user.userId);
      const res = await fetchSwimWorkoutById(user.userId, editId);
      if (cancelled) return;
      if ("error" in res) {
        setEditLoadError(res.error);
        setEditData(null);
      } else {
        setEditData(res.data);
      }
      setEditLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  useEffect(() => {
    if (editData?.status === "active") {
      router.replace("/swim");
    }
  }, [editData, router]);

  useEffect(() => {
    if (!workoutUserId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetchSwimEquipment(workoutUserId);
      if (cancelled) return;
      if ("error" in res) return;
      if (res.data === null) {
        setFilterGear(false);
        setInventory([...ALL_SWIM_EQUIPMENT_IDS]);
      } else {
        setFilterGear(true);
        setInventory(
          res.data.length > 0 ? [...res.data] : [...ALL_SWIM_EQUIPMENT_IDS]
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workoutUserId]);

  const lastParsed = lastTemplate?.parsed ?? null;

  const pageSummary = useMemo(() => {
    const lines: string[] = [
      "Раздел «Плавание»: запись тренировки по сериям, общий метраж, заметки.",
      `Планировщик черновика: фокус «${formatGoalsLabel(selectedGoals)}», объём ${targetVolume.trim() || "—"} м${focusText.trim() ? `, уточнение «${focusText.trim()}»` : ""}. Снаряжение: ${filterGear ? `фильтр включён (${inventory.length} поз.)` : "фильтр выключен — все блоки каталога"}. Генерация кнопкой — не LLM: каталог + локальный код; новый случайный набор на каждое нажатие; поиск в интернете только через чат (web_search).`,
    ];
    if (lastParsed) {
      lines.push(
        `Последняя сохранённая тренировка: дата ${lastParsed.date}, метраж ${lastParsed.totalDistance != null ? `${lastParsed.totalDistance} м` : "не указан"}.`
      );
    } else {
      lines.push("В базе ещё нет сохранённых тренировок по плаванию или не удалось загрузить.");
    }
    lines.push(
      "Блок «Среднесрочный план»: локальные цели (м/нед и горизонт) и сравнение со средним за 4 недели; при генерации черновика эти цели подмешиваются в разминку и слегка сдвигают целевой метраж."
    );
    lines.push(
      "Можно открыть «Историю плавания» и подставить серии любой прошлой тренировки на сегодня или с исходной датой."
    );
    return lines.join("\n");
  }, [targetVolume, focusText, selectedGoals, filterGear, inventory.length, lastParsed]);

  function toggleEquip(id: SwimEquipmentId) {
    setInventory((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setGearSaveState("idle");
  }

  async function handleSaveGear() {
    if (!workoutUserId) return;
    setGearSaveState("saving");
    const res = await saveSwimEquipment(
      workoutUserId,
      filterGear ? inventory : null
    );
    if ("error" in res) {
      setGearSaveState("error");
      return;
    }
    setGearSaveState("saved");
    setTimeout(() => setGearSaveState("idle"), 2000);
  }

  function toggleGoal(code: SwimGoalCode) {
    setSelectedGoals((prev) => {
      if (prev.includes(code)) {
        const next = prev.filter((c) => c !== code);
        return next.length >= 1 ? next : prev;
      }
      if (prev.length < 2) return [...prev, code];
      return [prev[0]!, code];
    });
  }

  useRegisterPageChatContext("Плавание", pageSummary);

  async function handleGeneratePlan() {
    const parsed = parseInt(targetVolume, 10);
    let vol = Number.isFinite(parsed) && parsed >= 200 ? parsed : 2000;
    const requestedVol = vol;
    const focus = focusText.trim()
      ? `${formatGoalsLabel(selectedGoals)}: ${focusText.trim()}`
      : `${formatGoalsLabel(selectedGoals)} — черновик из каталога`;

    const medium = loadSwimMediumGoals();
    let avgWeeklyM: number | null = null;
    if (workoutUserId) {
      const st = await swimMetersRolling28Days(workoutUserId);
      if ("data" in st) avgWeeklyM = st.data.avgWeeklyM;
    }
    const bias = suggestVolumeBias(medium.weeklyTargetM, avgWeeklyM);
    vol = adjustTargetVolumeForBias(vol, bias);
    const coachNote = formatMediumPlanForCoachNote(medium, avgWeeklyM);
    const inventoryIds =
      filterGear && inventory.length > 0 ? inventory : undefined;

    const biasLabel =
      bias === "neutral"
        ? "объём без коррекции"
        : bias === "add_base"
          ? "+6% метража: текущий недельный темп ниже вашей цели"
          : "−6% метража: текущий темп выше цели, бережём восстановление";

    setPlanGenerating(true);
    setGenerationMeta(null);
    const shuffleSeed = defaultShuffleSeed();
    try {
      const tpl = await fetchSwimBlockTemplates();
      let plan =
        "error" in tpl
          ? null
          : buildWorkoutFromCatalog(selectedGoals, vol, tpl.data, {
              inventory: filterGear ? inventory : null,
              prependWarmupNote: coachNote,
            });
      let source: "catalog" | "heuristic" = "catalog";
      if (!plan || plan.length < 2) {
        plan = generateSwimWorkoutPlan(vol, focus, {
          mediumPlanCoachNote: coachNote,
          inventoryIds,
          shuffleSeed,
        });
        source = "heuristic";
      }
      const inputs: SwimSeriesInput[] = plan.map((s) => {
        const inferred = inferBreakdownForSeries(s.distance, s.description);
        return {
          id: newId(),
          distance: String(s.distance),
          description: s.description,
          reps: inferred?.reps ?? "",
          perRepM: inferred?.perRepM ?? "",
        };
      });
      const rev = Date.now();
      setPlanDraft({ revision: rev, rows: inputs });
      setGeneratedAt(rev);
      setGenerationMeta(
        [
          `Источник: ${source === "catalog" ? "каталог блоков Supabase" : "встроенный генератор (каталог не собрал объём)"}.`,
          `Поле «Целевой объём»: ${requestedVol} м → с учётом среднесрочного плана: ${vol} м (${biasLabel}).`,
          source === "catalog"
            ? "Каталог: ротация шаблонов детерминирована календарным днём (повторные прогоны в тот же день — тот же набор)."
            : "Состав серий из встроенного генератора (каталог не собрал объём или блоков < 2).",
          coachNote,
        ].join("\n\n")
      );
    } finally {
      setPlanGenerating(false);
    }
  }

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
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-swim/15">
              <Waves className="size-5 text-swim" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">
                Редактирование плавания
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
                  Тренировка уже завершена и в календаре. Правки изменят сводки.
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
              </CardContent>
            </Card>
          )}
        {editData &&
          editData.status === "completed" &&
          editConfirmed &&
          !editLoading &&
          !editLoadError && (
            <SwimWorkoutEditor
              key={editData.workoutId}
              sessionStatus="completed"
              workoutId={editData.workoutId}
              lastWorkout={null}
              initialParsed={editData.parsed}
              initialNotes={editData.notes}
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

      {hydrated && !userError && (
        <SwimMediumPlanCard userId={workoutUserId} refreshKey={statsRefreshKey} />
      )}

      {hydrated && !userError && (
        <Card className="border-border/80">
          <CardContent className="space-y-2 pt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => {
                setHistoryOpen((prev) => {
                  const next = !prev;
                  if (
                    next &&
                    workoutUserId &&
                    historyItems.length === 0 &&
                    !historyLoading
                  ) {
                    void loadHistory();
                  }
                  return next;
                });
              }}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <History className="size-4 text-swim" />
                История плавания
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {historyOpen ? "скрыть" : "показать"}
              </span>
            </button>
            {historyOpen && (
              <div className="space-y-2">
                {historyErr && (
                  <p className="text-xs text-destructive" role="alert">
                    {historyErr}
                  </p>
                )}
                {historyLoading && (
                  <p className="text-xs text-muted-foreground">Загрузка…</p>
                )}
                {!historyLoading &&
                  !historyErr &&
                  historyItems.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Пока нет записей в журнале.
                    </p>
                  )}
                {!historyLoading && historyItems.length > 0 && (
                  <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {historyItems.map((item) => (
                      <li
                        key={item.workoutId}
                        className="rounded-lg border border-border/60 bg-muted/20 px-2 py-2 text-xs"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <span className="font-medium text-foreground">
                              {new Date(
                                item.parsed.date + "T12:00:00"
                              ).toLocaleDateString("ru")}
                            </span>
                            {item.parsed.totalDistance != null && (
                              <span className="text-muted-foreground">
                                {" "}
                                ·{" "}
                                {item.parsed.totalDistance.toLocaleString("ru")}{" "}
                                м
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className="h-7 gap-1 text-[11px] px-2 bg-swim hover:bg-swim/90 text-swim-foreground"
                              onClick={() =>
                                router.push(`/swim?edit=${item.workoutId}`)
                              }
                            >
                              <Pencil className="size-3 shrink-0" />
                              Редактировать
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-7 gap-1 text-[11px] px-2"
                              onClick={() =>
                                setHistoryApply({
                                  revision: Date.now(),
                                  workout: item.parsed,
                                  dateMode: "today",
                                })
                              }
                            >
                              <CalendarClock className="size-3 shrink-0" />
                              На сегодня
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px] px-2"
                              onClick={() =>
                                setHistoryApply({
                                  revision: Date.now(),
                                  workout: item.parsed,
                                  dateMode: "preserve",
                                })
                              }
                            >
                              Как в журнале
                            </Button>
                          </div>
                        </div>
                        {item.parsed.series[0]?.description && (
                          <p className="mt-1 line-clamp-2 text-muted-foreground">
                            {item.parsed.series[0].description}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={historyLoading || !workoutUserId}
                  onClick={() => void loadHistory()}
                >
                  Обновить список
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div>
              <h2 className="text-sm font-semibold">Планировщик черновика</h2>
              <p className="text-xs text-muted-foreground">
                Задайте целевой метраж и фокус — серии заполнятся в форме ниже (правки вручную всегда можно).
                Каталог из Supabase имеет приоритет; иначе включается генератор с расширенными примерами и учётом
                среднесрочного плана и инвентаря. Это не вызов LLM: каждое нажатие подмешивает случайный выбор
                из подходящих блоков. Свежие идеи из сети — только через чат агента (инструмент web_search, если включён Tavily).
              </p>
              <details className="mt-2 rounded-lg border border-border/50 bg-muted/15 text-xs">
                <summary className="cursor-pointer px-3 py-2 font-medium text-foreground">
                  Методика для ИИ и ручной правки
                </summary>
                <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap border-t border-border/40 px-3 py-2 font-sans text-muted-foreground leading-relaxed">
                  {SWIM_GENERATION_COACH_PROMPT_BLOCK}
                </pre>
              </details>
            </div>
            <div>
              <Label htmlFor="plan-volume">Целевой объём, м</Label>
              <Input
                id="plan-volume"
                type="number"
                min={200}
                step={50}
                className="mt-1 max-w-xs"
                value={targetVolume}
                onChange={(e) => setTargetVolume(e.target.value)}
              />
            </div>
            <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Снаряжение</p>
                {workoutUserId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={gearSaveState === "saving"}
                    onClick={() => void handleSaveGear()}
                  >
                    {gearSaveState === "saving"
                      ? "Сохранение…"
                      : gearSaveState === "saved"
                        ? "Сохранено"
                        : "Запомнить в профиле"}
                  </Button>
                )}
              </div>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="filter-gear"
                  checked={filterGear}
                  onChange={(e) => {
                    setFilterGear(e.target.checked);
                    setGearSaveState("idle");
                  }}
                  className="mt-1 size-4 shrink-0 rounded border-input"
                />
                <Label
                  htmlFor="filter-gear"
                  className="text-xs font-normal leading-snug cursor-pointer text-muted-foreground"
                >
                  Учитывать инвентарь при сборке: в план попадают только блоки,
                  для которых у вас отмечены все нужные предметы (в каталоге —
                  поле <code className="text-foreground">equipment_tags</code>
                  ). Выключено — доступны все блоки, как раньше.
                </Label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setInventory([...ALL_SWIM_EQUIPMENT_IDS]);
                    setGearSaveState("idle");
                  }}
                >
                  Отметить всё
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setInventory([]);
                    setGearSaveState("idle");
                  }}
                >
                  Снять всё
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SWIM_EQUIPMENT_ITEMS.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={inventory.includes(item.id)}
                      onChange={() => toggleEquip(item.id)}
                      className="size-3.5 rounded border-input"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
              {gearSaveState === "error" && (
                <p className="text-xs text-destructive" role="alert">
                  Не удалось сохранить — проверьте миграцию и RLS для{" "}
                  <code className="font-mono">users.swim_equipment</code>.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium">Фокус (1–2)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Можно сочетать, например техника + скорость. Блоки из базы
                берутся, если их теги содержат{" "}
                <span className="font-medium text-foreground">любой</span> из
                выбранных фокусов. Доли разминки/заминки — среднее между
                профилями фокусов.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SWIM_GOALS.map((g) => (
                  <button
                    key={g.code}
                    type="button"
                    onClick={() => toggleGoal(g.code)}
                    title={g.description}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      selectedGoals.includes(g.code)
                        ? "border-swim bg-swim/15 text-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Сейчас:{" "}
                <span className="font-medium text-foreground">
                  {formatGoalsLabel(selectedGoals)}
                </span>
              </p>
            </div>
            <div>
              <Label htmlFor="plan-focus">
                Уточнение фокуса{" "}
                <span className="font-normal text-muted-foreground">
                  (необязательно)
                </span>
              </Label>
              <Input
                id="plan-focus"
                className="mt-1"
                placeholder="Например: работа ног, старт с бортика"
                value={focusText}
                onChange={(e) => setFocusText(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-swim/40"
              onClick={() => void handleGeneratePlan()}
              disabled={planGenerating}
            >
              <Sparkles className="size-4 text-swim" />
              <span>
                {planGenerating
                  ? "Сборка плана…"
                  : "Сгенерировать серии"}
              </span>
            </Button>
            {generatedAt != null && (
              <p className="text-xs text-swim" role="status">
                Черновик подставлен в форму ниже ({planDraft?.rows.length ?? 0}{" "}
                блоков). Можно править текст и метраж по сериям.
              </p>
            )}
            {generationMeta != null && (
              <div
                className="rounded-lg border border-swim/25 bg-swim/[0.06] px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed"
                role="note"
              >
                {generationMeta}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hydrated && !userError && (
        <SwimWorkoutEditor
          key={activeWorkout?.workoutId ?? "new-swim"}
          sessionStatus={activeWorkout ? "active" : "new"}
          workoutId={activeWorkout?.workoutId}
          lastWorkout={activeWorkout ? null : lastParsed}
          initialParsed={activeWorkout?.parsed}
          initialNotes={activeWorkout?.notes ?? ""}
          planDraft={planDraft}
          historyApply={historyApply}
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
            setStatsRefreshKey((k) => k + 1);
            router.push("/");
          }}
          onDeleted={() => {
            setActiveWorkout(null);
            void refreshLast();
          }}
        />
      )}
    </div>
  );
}

export default function SwimPage() {
  return (
    <Suspense
      fallback={
        <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>
      }
    >
      <SwimPageContent />
    </Suspense>
  );
}
