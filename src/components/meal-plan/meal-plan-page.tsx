"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChefHat, ClipboardList, Copy, ArrowDown, ArrowUp, Flame, Globe, Minus, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { macroDistanceScore, sortRecipesByFit } from "@/lib/features/meal-plan/macrosFit";
import { SEED_RECIPES, recipeById } from "@/lib/features/meal-plan/seedRecipes";
import { buildShoppingList, planMacrosTotal } from "@/lib/features/meal-plan/shoppingList";
import {
  loadPlan,
  loadStaples,
  loadTargets,
  savePlan,
  saveStaples,
  saveTargets,
  createMealSlotId,
  MEAL_PLAN_UPDATED_EVENT,
} from "@/lib/features/meal-plan/storage";
import type { MealPlanTargets, PlanLine, MealSlot } from "@/lib/features/meal-plan/types";
import {
  appendRecipeHistoryEntries,
  createRecipeSourceId,
  exclusionUrlKeys,
  loadRecipeDiscoveryState,
  normalizeSourceHost,
  resetRecipeSourcesToDefault,
  saveRecipeHistory,
  saveRecipePreferences,
  saveRecipeSources,
} from "@/lib/features/meal-plan/recipeDiscoveryStorage";
import type { RecipeDiscoveryState, RecipeSource } from "@/lib/features/meal-plan/recipeDiscoveryTypes";
import { MAX_RECIPE_SOURCES } from "@/lib/features/meal-plan/recipeDiscoveryTypes";
import { useRegisterPageChatContext } from "@/contexts/page-chat-context";
import { cn } from "@/lib/utils";

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.001) return String(Math.round(r));
  return r.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function macroLine(m: { kcal: number; proteinG: number; fatG: number; carbsG: number }): string {
  return `${Math.round(m.kcal)} ккал · Б ${fmtAmount(m.proteinG)} · Ж ${fmtAmount(m.fatG)} · У ${fmtAmount(m.carbsG)}`;
}

function RecipeCover({
  src,
  alt,
  className,
}: {
  src: string | undefined;
  alt: string;
  className?: string;
}) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) {
    return (
      <div
        className={cn(
          "shrink-0 rounded-md bg-muted/80 ring-1 ring-border/50 flex items-center justify-center",
          className
        )}
        aria-hidden
      >
        <ChefHat className="size-[42%] max-w-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-cover shrink-0 rounded-md ring-1 ring-border/40", className)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setOk(false)}
    />
  );
}

/** Суточный дефицит ккал: коридор [min, max], 0…2000, min ≤ max. */
function normalizeDeficitRange(t: MealPlanTargets, minRaw: number, maxRaw: number): MealPlanTargets {
  let lo = Number.isFinite(minRaw) ? Math.round(minRaw) : t.deficitKcalMin;
  let hi = Number.isFinite(maxRaw) ? Math.round(maxRaw) : t.deficitKcalMax;
  lo = Math.min(2000, Math.max(0, lo));
  hi = Math.min(2000, Math.max(0, hi));
  if (lo > hi) {
    const x = lo;
    lo = hi;
    hi = x;
  }
  return { ...t, deficitKcalMin: lo, deficitKcalMax: hi };
}

export function MealPlanPage() {
  useRegisterPageChatContext(
    "Питание (прототип)",
    "КБЖУ, слоты приёмов, дефицит ккал, база продуктов, источники рецептов в сети с историей и предпочтениями, локальный каталог, список покупок."
  );

  const [ready, setReady] = useState(false);
  const [staples, setStaples] = useState("");
  const [targets, setTargets] = useState<MealPlanTargets>(loadTargets);
  const [plan, setPlan] = useState<PlanLine[]>([]);
  const [copyOk, setCopyOk] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recipeDisc, setRecipeDisc] = useState<RecipeDiscoveryState>(() => loadRecipeDiscoveryState());
  const [newSourceHost, setNewSourceHost] = useState("");
  const [newSourceLabel, setNewSourceLabel] = useState("");
  const [searchFocus, setSearchFocus] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchHits, setSearchHits] = useState<{ title: string; url: string; snippet: string }[]>([]);

  useEffect(() => {
    setStaples(loadStaples());
    setTargets(loadTargets());
    setPlan(loadPlan());
    setRecipeDisc(loadRecipeDiscoveryState());
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onRemote = () => {
      setStaples(loadStaples());
      setTargets(loadTargets());
      setPlan(loadPlan());
      setRecipeDisc(loadRecipeDiscoveryState());
    };
    window.addEventListener(MEAL_PLAN_UPDATED_EVENT, onRemote);
    return () => window.removeEventListener(MEAL_PLAN_UPDATED_EVENT, onRemote);
  }, []);

  const persistStaples = useCallback(() => {
    saveStaples(staples);
  }, [staples]);

  const persistTargets = useCallback((t: MealPlanTargets) => {
    setTargets(t);
    saveTargets(t);
  }, []);

  const setPlanAndSave = useCallback((next: PlanLine[]) => {
    setPlan(next);
    savePlan(next);
  }, []);

  const sortedRecipes = useMemo(() => sortRecipesByFit(SEED_RECIPES, targets), [targets]);

  const totals = useMemo(() => planMacrosTotal(plan), [plan]);
  const { buy, atHome } = useMemo(
    () => buildShoppingList(plan, staples),
    [plan, staples]
  );

  const perMeal = useMemo(() => {
    const n = Math.max(1, targets.mealSlots.length);
    return {
      kcal: targets.kcal / n,
      proteinG: targets.proteinG / n,
      fatG: targets.fatG / n,
      carbsG: targets.carbsG / n,
    };
  }, [targets]);

  function updateMealSlots(next: MealSlot[]) {
    const trimmed = next
      .map((s) => ({
        id: s.id?.trim() || createMealSlotId(),
        label: s.label.trim().slice(0, 80) || "Приём",
      }))
      .slice(0, 8);
    if (trimmed.length < 1) return;
    persistTargets({ ...targets, mealSlots: trimmed });
  }

  function moveMealSlot(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= targets.mealSlots.length) return;
    const slots = [...targets.mealSlots];
    const t = slots[index];
    slots[index] = slots[j]!;
    slots[j] = t!;
    updateMealSlots(slots);
  }

  function setSlotLabel(index: number, label: string) {
    const slots = targets.mealSlots.map((s, i) => (i === index ? { ...s, label } : s));
    persistTargets({ ...targets, mealSlots: slots });
  }

  function addMealSlot() {
    if (targets.mealSlots.length >= 8) return;
    updateMealSlots([...targets.mealSlots, { id: createMealSlotId(), label: "Перекус" }]);
  }

  function removeMealSlot(index: number) {
    if (targets.mealSlots.length <= 1) return;
    updateMealSlots(targets.mealSlots.filter((_, i) => i !== index));
  }

  function addRecipePortion(recipeId: string) {
    const next = [...plan];
    const i = next.findIndex((l) => l.recipeId === recipeId);
    if (i >= 0) next[i] = { ...next[i], portions: next[i].portions + 1 };
    else next.push({ recipeId, portions: 1 });
    setPlanAndSave(next);
  }

  function changePortions(recipeId: string, delta: number) {
    const next: PlanLine[] = [];
    for (const l of plan) {
      if (l.recipeId !== recipeId) {
        next.push(l);
        continue;
      }
      const p = l.portions + delta;
      if (p <= 0.001) continue;
      next.push({ ...l, portions: Math.max(0.25, p) });
    }
    setPlanAndSave(next);
  }

  function removeLine(recipeId: string) {
    setPlanAndSave(plan.filter((l) => l.recipeId !== recipeId));
  }

  function persistRecipeSources(next: RecipeSource[]) {
    const list = next.slice(0, MAX_RECIPE_SOURCES);
    saveRecipeSources(list);
    setRecipeDisc((d) => ({ ...d, sources: list }));
  }

  function persistPreferences(p: RecipeDiscoveryState["preferences"]) {
    saveRecipePreferences(p);
    setRecipeDisc((d) => ({ ...d, preferences: p }));
  }

  function toggleSourceHost(id: string) {
    persistRecipeSources(recipeDisc.sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }

  function removeSourceRow(id: string) {
    persistRecipeSources(recipeDisc.sources.filter((s) => s.id !== id));
  }

  function addCustomSource() {
    const host = normalizeSourceHost(newSourceHost);
    if (!host) {
      setSearchErr("Введите hostname, например eda.ru");
      return;
    }
    if (recipeDisc.sources.length >= MAX_RECIPE_SOURCES) return;
    if (recipeDisc.sources.some((s) => s.host === host)) {
      setSearchErr("Такой сайт уже в списке.");
      return;
    }
    const label = newSourceLabel.trim() || host;
    persistRecipeSources([
      ...recipeDisc.sources,
      { id: createRecipeSourceId(), label, host, enabled: true },
    ]);
    setNewSourceHost("");
    setNewSourceLabel("");
    setSearchErr(null);
  }

  function handleResetSources() {
    const s = resetRecipeSourcesToDefault();
    setRecipeDisc((d) => ({ ...d, sources: s }));
  }

  async function runRecipeSearch() {
    setSearchErr(null);
    const enabledHosts = recipeDisc.sources.filter((s) => s.enabled).map((s) => s.host);
    if (enabledHosts.length < 1) {
      setSearchErr("Включите хотя бы один источник.");
      return;
    }
    setSearchLoading(true);
    try {
      const excludeKeys = exclusionUrlKeys(recipeDisc.history, recipeDisc.preferences.excludeRecent);
      const res = await fetch("/api/meal-plan/recipe-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: enabledHosts,
          excludeUrlKeys: excludeKeys,
          focusQuery: searchFocus,
          preferencesNotes: recipeDisc.preferences.notes,
          novelty: recipeDisc.preferences.novelty,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: { results: { title: string; url: string; snippet: string }[] };
      };
      if (!json.ok) {
        setSearchErr(json.error ?? "Ошибка поиска");
        setSearchHits([]);
        return;
      }
      const results = json.data?.results ?? [];
      setSearchHits(results);
      if (results.length > 0) {
        setRecipeDisc((d) => {
          const nh = appendRecipeHistoryEntries(
            d.history,
            results.map((r) => ({ url: r.url, title: r.title, kind: "search_hit" as const }))
          );
          saveRecipeHistory(nh);
          return { ...d, history: nh };
        });
      }
    } catch {
      setSearchErr("Сеть или сервер недоступны");
      setSearchHits([]);
    } finally {
      setSearchLoading(false);
    }
  }

  function clearRecipeHistory() {
    saveRecipeHistory([]);
    setRecipeDisc((d) => ({ ...d, history: [] }));
  }

  function markUserOpened(title: string, url: string) {
    setRecipeDisc((d) => {
      const nh = appendRecipeHistoryEntries(d.history, [{ url, title, kind: "user_marked" }]);
      saveRecipeHistory(nh);
      return { ...d, history: nh };
    });
  }

  async function copyShoppingList() {
    const lines: string[] = ["Список покупок (прототип Jarvis)", ""];
    if (buy.length) {
      lines.push("Купить:");
      for (const r of buy) {
        lines.push(`- ${r.name} — ${fmtAmount(r.amount)} ${r.unit}`);
      }
    }
    if (atHome.length) {
      lines.push("", "Уже в базе (проверь остатки):");
      for (const r of atHome) {
        lines.push(`- ${r.name} — ${fmtAmount(r.amount)} ${r.unit}`);
      }
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      /* ignore */
    }
  }

  if (!ready) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">Загрузка…</div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-glow-primary/40">
          <ChefHat className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Питание</h1>
          <p className="text-xs text-muted-foreground leading-snug">
            Прототип: цели КБЖУ → подбор блюд → план порций → список покупок с учётом того, что обычно есть дома.
          </p>
        </div>
      </div>

      <Card size="sm">
        <CardHeader className="border-b border-border/50 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4 text-glow-secondary" />
            Цели на день
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">Ккал за день</Label>
              <Input
                type="number"
                min={800}
                max={6000}
                value={targets.kcal}
                onChange={(e) =>
                  persistTargets({ ...targets, kcal: Number(e.target.value) || targets.kcal })
                }
              />
            </div>
            <div>
              <Label className="text-xs">Белки, г</Label>
              <Input
                type="number"
                min={40}
                max={400}
                value={targets.proteinG}
                onChange={(e) =>
                  persistTargets({ ...targets, proteinG: Number(e.target.value) || targets.proteinG })
                }
              />
            </div>
            <div>
              <Label className="text-xs">Жиры, г</Label>
              <Input
                type="number"
                min={20}
                max={200}
                value={targets.fatG}
                onChange={(e) =>
                  persistTargets({ ...targets, fatG: Number(e.target.value) || targets.fatG })
                }
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Углеводы, г</Label>
              <Input
                type="number"
                min={50}
                max={800}
                value={targets.carbsG}
                onChange={(e) =>
                  persistTargets({ ...targets, carbsG: Number(e.target.value) || targets.carbsG })
                }
              />
            </div>
          </div>

          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="text-xs font-medium text-foreground">Приёмы в день (порядок важен)</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Например: обед → перекус после обеда → ужин → перекус после ужина. Суточные ккал и БЖУ делятся
              поровну между слотами для подбора рецептов (позже можно веса по слотам).
            </p>
            <ul className="space-y-1.5">
              {targets.mealSlots.map((slot, index) => (
                <li
                  key={slot.id}
                  className="flex items-center gap-1 rounded-lg border border-border/50 bg-card/15 px-1.5 py-1"
                >
                  <span className="w-5 shrink-0 text-center text-[10px] text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex shrink-0 flex-col gap-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-6"
                      disabled={index === 0}
                      aria-label="Выше"
                      onClick={() => moveMealSlot(index, -1)}
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-6"
                      disabled={index === targets.mealSlots.length - 1}
                      aria-label="Ниже"
                      onClick={() => moveMealSlot(index, 1)}
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                  </div>
                  <Input
                    className="h-7 min-w-0 flex-1 text-xs"
                    value={slot.label}
                    onChange={(e) => setSlotLabel(index, e.target.value)}
                    maxLength={80}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0 text-destructive disabled:opacity-30"
                    disabled={targets.mealSlots.length <= 1}
                    aria-label="Удалить слот"
                    onClick={() => removeMealSlot(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={targets.mealSlots.length >= 8}
              onClick={addMealSlot}
            >
              <Plus className="size-3.5" />
              Добавить слот
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Ориентир на один слот (среднее по дню, для подбора):{" "}
            <span className="text-foreground font-medium">{macroLine(perMeal)}</span>
            <span className="block mt-1 text-[10px] text-muted-foreground/90">
              Порядок: {targets.mealSlots.map((s) => s.label).join(" → ")}
            </span>
          </p>

          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Flame className="size-3.5 text-orange-400 shrink-0" />
              Желаемый дефицит к расходу
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Коридор суточного дефицита (ккал): расход минус приём. Запас к срывам и дожорам. В полном
              сценарии расход возьмём из TDEE, тренировок и часов — здесь только сохранение настроек.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Мин., ккал/день</Label>
                <Input
                  type="number"
                  min={0}
                  max={2000}
                  value={targets.deficitKcalMin}
                  onChange={(e) => {
                    const v = e.target.value === "" ? targets.deficitKcalMin : Number(e.target.value);
                    persistTargets(normalizeDeficitRange(targets, v, targets.deficitKcalMax));
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Макс., ккал/день</Label>
                <Input
                  type="number"
                  min={0}
                  max={2000}
                  value={targets.deficitKcalMax}
                  onChange={(e) => {
                    const v = e.target.value === "" ? targets.deficitKcalMax : Number(e.target.value);
                    persistTargets(normalizeDeficitRange(targets, targets.deficitKcalMin, v));
                  }}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Сейчас в настройках:{" "}
              <span className="text-foreground font-medium tabular-nums">
                {targets.deficitKcalMin}–{targets.deficitKcalMax} ккал/день
              </span>
              .
            </p>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/50 pb-3">
          <CardTitle className="text-base">Базовые продукты дома</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            По одному в строке. Совпадения с ингредиентами подсветим в списке покупок как «уже в базе».
          </p>
        </CardHeader>
        <CardContent className="space-y-2 pt-3">
          <textarea
            value={staples}
            onChange={(e) => setStaples(e.target.value)}
            rows={6}
            className={cn(
              "w-full resize-y rounded-lg border border-glow-primary/30 bg-card/30 px-2.5 py-2 text-sm",
              "placeholder:text-muted-foreground outline-none",
              "focus-visible:border-glow-primary/60 focus-visible:ring-3 focus-visible:ring-glow-primary/20"
            )}
            placeholder={"яйца\nмолоко\nлук\nоливковое масло"}
            spellCheck={false}
          />
          <Button type="button" size="sm" variant="secondary" onClick={persistStaples}>
            Сохранить базу
          </Button>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/50 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="size-4 text-sky-400" />
            Рецепты из сети: источники и поиск
          </CardTitle>
          <p className="text-xs text-muted-foreground font-normal leading-snug">
            Засеянный список сайтов (hostname) — можно добавлять свои. Поиск идёт через Tavily только по включённым
            доменам; недавние URL из истории отсекаются, чтобы реже повторяться. Предпочтения — текст + «новизна»
            запроса.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleResetSources}>
              Сбросить сайты к умолчанию
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={clearRecipeHistory}
            >
              Очистить историю URL
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Источники (включите чекбоксом)</Label>
            <ul className="space-y-1.5">
              {recipeDisc.sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-border/50 bg-card/20 px-2 py-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary shrink-0"
                    checked={s.enabled}
                    onChange={() => toggleSourceHost(s.id)}
                    aria-label={`Искать на ${s.host}`}
                  />
                  <span className="font-medium text-foreground truncate min-w-0">{s.label}</span>
                  <span className="text-muted-foreground truncate tabular-nums">{s.host}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 shrink-0 ml-auto text-destructive"
                    onClick={() => removeSourceRow(s.id)}
                    aria-label="Удалить источник"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <Label className="text-xs">Новый сайт (hostname)</Label>
              <Input
                value={newSourceHost}
                onChange={(e) => setNewSourceHost(e.target.value)}
                placeholder="example.com"
                spellCheck={false}
              />
            </div>
            <div>
              <Label className="text-xs">Подпись (необязательно)</Label>
              <Input
                value={newSourceLabel}
                onChange={(e) => setNewSourceLabel(e.target.value)}
                placeholder="Как показать в списке"
              />
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={addCustomSource} className="w-full sm:w-auto">
              <Plus className="size-4" />
              Добавить
            </Button>
          </div>

          <div className="space-y-2 border-t border-border/40 pt-3">
            <Label className="text-xs">Предпочтения поиска (учитываются в запросе)</Label>
            <textarea
              value={recipeDisc.preferences.notes}
              onChange={(e) =>
                persistPreferences({ ...recipeDisc.preferences, notes: e.target.value.slice(0, 4000) })
              }
              rows={3}
              className={cn(
                "w-full resize-y rounded-lg border border-glow-primary/30 bg-card/30 px-2.5 py-2 text-sm",
                "placeholder:text-muted-foreground outline-none",
                "focus-visible:border-glow-primary/60 focus-visible:ring-3 focus-visible:ring-glow-primary/20"
              )}
              placeholder="Например: без свинины, побольше рыбы, не острый, до 40 минут…"
              spellCheck
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Новизна запроса (0–1)</Label>
                <Input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={recipeDisc.preferences.novelty}
                  onChange={(e) =>
                    persistPreferences({
                      ...recipeDisc.preferences,
                      novelty: Number(e.target.value),
                    })
                  }
                  className="w-full accent-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                  {recipeDisc.preferences.novelty.toFixed(2)}
                </p>
              </div>
              <div>
                <Label className="text-xs">Исключать последних N из истории</Label>
                <Input
                  type="number"
                  min={0}
                  max={80}
                  value={recipeDisc.preferences.excludeRecent}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : Number(e.target.value);
                    persistPreferences({
                      ...recipeDisc.preferences,
                      excludeRecent: Number.isFinite(v) ? Math.min(80, Math.max(0, Math.round(v))) : 0,
                    });
                  }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-border/40 pt-3">
            <Label className="text-xs">Фокус запроса (необязательно)</Label>
            <Input
              value={searchFocus}
              onChange={(e) => setSearchFocus(e.target.value.slice(0, 200))}
              placeholder="Например: ужин с курицей, суп на неделю…"
            />
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={searchLoading}
              onClick={() => void runRecipeSearch()}
            >
              <Search className="size-3.5" />
              {searchLoading ? "Ищем…" : "Найти на выбранных сайтах"}
            </Button>
            {searchErr && <p className="text-xs text-destructive">{searchErr}</p>}
            {searchHits.length > 0 && (
              <ul className="space-y-2 pt-1">
                {searchHits.map((h, i) => (
                  <li key={`${h.url}-${i}`} className="rounded-md border border-border/40 bg-card/15 p-2 text-xs">
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline break-words"
                    >
                      {h.title || h.url}
                    </a>
                    {h.snippet ? (
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-4">{h.snippet}</p>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 text-[11px]"
                      onClick={() => markUserOpened(h.title || h.url, h.url)}
                    >
                      Запомнить открытие
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {recipeDisc.history.length > 0 && (
            <div className="space-y-1 border-t border-border/40 pt-3">
              <p className="text-xs font-medium text-foreground">Недавняя история (для анти-повторов)</p>
              <ul className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-muted-foreground">
                {[...recipeDisc.history]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 12)
                  .map((h) => (
                    <li key={h.id} className="flex gap-2 truncate">
                      <span className="shrink-0 tabular-nums opacity-70">{h.kind === "user_marked" ? "★" : "·"}</span>
                      <a href={h.url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                        {h.title}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/50 pb-3">
          <CardTitle className="text-base">Каталог рецептов</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Сортировка по близости КБЖУ к одному приёму; у блюд — иллюстративные фото (Wikimedia Commons). Нажмите
            карточку — ингредиенты; «+ порция» — в план.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 pt-3">
          {sortedRecipes.map((r) => {
            const score = macroDistanceScore(r, targets);
            const open = expanded === r.id;
            return (
              <div
                key={r.id}
                className={cn(
                  "rounded-lg border border-border/60 bg-card/20 px-3 py-2 transition-colors",
                  open && "border-glow-primary/40 bg-card/35"
                )}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpanded(open ? null : r.id)}
                >
                  <div className="flex gap-3">
                    <RecipeCover src={r.imageUrl} alt={r.name} className="size-20 sm:size-[5.25rem]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{r.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {r.minutes} мин
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{r.teaser}</p>
                      <p className="mt-1.5 text-[11px] text-foreground/90">{macroLine(r.macrosPerServing)}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                        отклонение от цели приёма: {score.toFixed(2)} (меньше — ближе)
                      </p>
                    </div>
                  </div>
                </button>
                {open && (
                  <div className="mt-2 border-t border-border/40 pt-2 space-y-2">
                    <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-3 list-disc">
                      {r.ingredients.map((ing, idx) => (
                        <li key={`${r.id}-${idx}`}>
                          {ing.name} — {fmtAmount(ing.amount)} {ing.unit}
                        </li>
                      ))}
                    </ul>
                    <Button type="button" size="sm" className="w-full" onClick={() => addRecipePortion(r.id)}>
                      <Plus className="size-4" />
                      Добавить 1 порцию в план
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/50 pb-3">
          <CardTitle className="text-base">План (порции)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-3">
          {plan.length === 0 ? (
            <p className="text-xs text-muted-foreground">Пока пусто — добавьте порции из каталога.</p>
          ) : (
            <>
              {plan
                .filter((line) => recipeById(line.recipeId))
                .map((line) => {
                  const r = recipeById(line.recipeId)!;
                  return (
                  <div
                    key={line.recipeId}
                    className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/15 px-2 py-1.5"
                  >
                    <RecipeCover src={r.imageUrl} alt={r.name} className="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium leading-snug truncate">{r.name}</p>
                      <p className="text-[10px] text-muted-foreground">{macroLine(r.macrosPerServing)} / порция</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="size-7"
                        onClick={() => changePortions(line.recipeId, -0.5)}
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="w-10 text-center text-xs tabular-nums">{fmtAmount(line.portions)}</span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="size-7"
                        onClick={() => changePortions(line.recipeId, 0.5)}
                      >
                        <Plus className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="size-7 text-destructive"
                        onClick={() => removeLine(line.recipeId)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  );
                })}
              <div className="rounded-lg bg-primary/10 px-2 py-2 text-xs border border-glow-primary/20">
                <span className="text-muted-foreground">Итого по плану: </span>
                <span className="font-medium">{macroLine(totals)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/50 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="size-4" />
            Список покупок
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          {plan.length === 0 ? (
            <p className="text-xs text-muted-foreground">Добавьте блюда в план — здесь появится агрегат по продуктам.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={copyShoppingList} className="gap-1.5">
                  <Copy className="size-3.5" />
                  {copyOk ? "Скопировано" : "Копировать текстом"}
                </Button>
              </div>
              {buy.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1.5">Купить</p>
                  <ul className="space-y-1 text-xs">
                    {buy.map((row, i) => (
                      <li key={`b-${i}`} className="flex justify-between gap-2 border-b border-border/30 pb-1">
                        <span>{row.name}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {fmtAmount(row.amount)} {row.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {atHome.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                    В базе дома (всё равно проверь остатки)
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {atHome.map((row, i) => (
                      <li key={`h-${i}`} className="flex justify-between gap-2 border-b border-border/20 pb-1">
                        <span>{row.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {fmtAmount(row.amount)} {row.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
