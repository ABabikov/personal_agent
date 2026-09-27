"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DishBuilder } from "@/components/nutrition/dish-builder";
import {
  listDishes,
  listFoodProducts,
  listRecentFoodLog,
  loadNutritionDay,
  logProductPortion,
  logQuickMeal,
  saveFoodProduct,
  saveNutritionSettings,
  saveWeight,
  softDeleteFoodLog,
  type DishView,
  type FoodLogEntry,
  type FoodProduct,
  type NutritionDay,
} from "@/lib/db/nutrition";
import { getWorkoutUserId } from "@/lib/db/workoutUserId";
import type { MagnitHit } from "@/lib/features/nutrition/magnitCatalog";
import type { ReferenceFood } from "@/lib/features/nutrition/referenceCatalog";
import { MEAL_SLOTS, slotFromHour, slotLabel, type MealSlotId } from "@/lib/features/nutrition/slots";
import { suggestRemainingMeals, type MealSuggestion } from "@/lib/features/nutrition/suggest";
import type { NutritionSettings } from "@/lib/features/nutrition/targets";
import { isoLocalDate } from "@/lib/features/workouts/analytics";

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoLocalDate(d);
}

type MagnitSearchHit = MagnitHit;

export function NutritionPage() {
  useRegisterPageChatContext(
    "Дневник питания",
    "Норма КБЖУ, остаток на день, поиск продуктов Магнита, свои блюда, утренний вес. Запись из чата — через log_food после подтверждения."
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [date, setDate] = useState(() => isoLocalDate(new Date()));
  const [day, setDay] = useState<NutritionDay | null>(null);
  const [products, setProducts] = useState<FoodProduct[]>([]);
  const [dishes, setDishes] = useState<DishView[]>([]);
  const [recent, setRecent] = useState<FoodLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [slot, setSlot] = useState<MealSlotId>(() => slotFromHour(new Date().getHours()));
  const [grams, setGrams] = useState("100");
  const [query, setQuery] = useState("");
  const [localHits, setLocalHits] = useState<FoodProduct[]>([]);
  const [referenceHits, setReferenceHits] = useState<ReferenceFood[]>([]);
  const [magnitHits, setMagnitHits] = useState<MagnitSearchHit[]>([]);
  const [magnitNote, setMagnitNote] = useState<string | null>(null);
  const [yarcheNote, setYarcheNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<
    | { kind: "product"; product: FoodProduct }
    | { kind: "reference"; item: ReferenceFood }
    | { kind: "magnit"; hit: MagnitSearchHit }
    | null
  >(null);

  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [manualP, setManualP] = useState("");
  const [manualF, setManualF] = useState("");
  const [manualC, setManualC] = useState("");

  const [quickLabel, setQuickLabel] = useState("");
  const [quickKcal, setQuickKcal] = useState("");

  const [weightInput, setWeightInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [proteinPerKg, setProteinPerKg] = useState("2.2");
  const [carbsPerKg, setCarbsPerKg] = useState("3.5");
  const [deficitMin, setDeficitMin] = useState("200");
  const [deficitMax, setDeficitMax] = useState("400");

  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);

  const reload = useCallback(async (uid: string, dayIso: string) => {
    setLoading(true);
    setError(null);
    const [dayR, prodR, dishR, recentR] = await Promise.all([
      loadNutritionDay(uid, dayIso),
      listFoodProducts(uid),
      listDishes(uid),
      listRecentFoodLog(uid, 30),
    ]);
    if ("error" in dayR) setError(dayR.error);
    else {
      setDay(dayR.day);
      setWeightInput(dayR.day.weightKg != null ? String(dayR.day.weightKg) : "");
      setProteinPerKg(String(dayR.day.settings.proteinGPerKg));
      setCarbsPerKg(String(dayR.day.settings.carbsGPerKg));
      setDeficitMin(String(dayR.day.settings.deficitKcalMin));
      setDeficitMax(String(dayR.day.settings.deficitKcalMax));
    }
    if ("products" in prodR) setProducts(prodR.products);
    if ("dishes" in dishR) setDishes(dishR.dishes);
    if ("entries" in recentR) setRecent(recentR.entries);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await getWorkoutUserId();
      if (cancelled) return;
      if ("error" in id) {
        setError(id.error);
        setLoading(false);
        return;
      }
      setUserId(id.userId);
      await reload(id.userId, date);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, reload]);

  const recentProducts = useMemo(() => {
    const seen = new Set<string>();
    const out: { product: FoodProduct; grams: number }[] = [];
    for (const entry of recent) {
      if (!entry.productId || seen.has(entry.productId)) continue;
      const product = products.find((p) => p.id === entry.productId);
      if (!product) continue;
      seen.add(entry.productId);
      out.push({ product, grams: entry.grams ?? 100 });
      if (out.length >= 8) break;
    }
    return out;
  }, [recent, products]);

  async function run(fn: () => Promise<{ error?: string } | object | void>) {
    if (!userId) return;
    setBusy(true);
    const res = await fn();
    const err =
      res && typeof res === "object" && "error" in res && typeof res.error === "string" ? res.error : null;
    await reload(userId, date);
    if (err) setError(err);
    setBusy(false);
  }

  async function onSearch() {
    if (!userId || query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const res = await fetch("/api/nutrition/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, query }),
      });
      const json = (await res.json()) as {
        local?: FoodProduct[];
        reference?: ReferenceFood[];
        magnit?: MagnitSearchHit[];
        magnitNote?: string | null;
        yarcheNote?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Поиск не удался.");
      } else {
        setLocalHits(json.local ?? []);
        setReferenceHits(json.reference ?? []);
        setMagnitHits(json.magnit ?? []);
        setMagnitNote(json.magnitNote ?? null);
        setYarcheNote(json.yarcheNote ?? null);
      }
    } catch {
      setError("Поиск не удался.");
    }
    setBusy(false);
  }

  async function logPicked() {
    if (!userId || !picked) return;
    const g = Number(grams.replace(",", "."));
    await run(async () => {
      if (picked.kind === "product") {
        return logProductPortion(userId, { eatenOn: date, slot, productId: picked.product.id, grams: g });
      }
      if (picked.kind === "reference") {
        const item = picked.item;
        const saved = await saveFoodProduct(userId, {
          name: item.name,
          source: "manual",
          externalId: `ref:${item.id}`,
          kcalPer100: item.kcalPer100,
          proteinPer100: item.proteinPer100,
          fatPer100: item.fatPer100,
          carbsPer100: item.carbsPer100,
        });
        if ("error" in saved) return saved;
        return logProductPortion(userId, { eatenOn: date, slot, productId: saved.product.id, grams: g });
      }
      const hit = picked.hit;
      if (hit.kcalPer100 == null || hit.proteinPer100 == null || hit.fatPer100 == null || hit.carbsPer100 == null) {
        return { error: "У карточки Магнита нет КБЖУ. Внеси цифры с упаковки." };
      }
      const saved = await saveFoodProduct(userId, {
        name: hit.name,
        source: "magnit",
        externalId: hit.externalId,
        kcalPer100: hit.kcalPer100,
        proteinPer100: hit.proteinPer100,
        fatPer100: hit.fatPer100,
        carbsPer100: hit.carbsPer100,
        packageGrams: hit.packageGrams,
        url: hit.url,
      });
      if ("error" in saved) return saved;
      return logProductPortion(userId, { eatenOn: date, slot, productId: saved.product.id, grams: g });
    });
  }

  async function logManual() {
    if (!userId) return;
    const g = Number(grams.replace(",", "."));
    await run(async () => {
      const saved = await saveFoodProduct(userId, {
        name: manualName,
        source: "manual",
        kcalPer100: Number(manualKcal.replace(",", ".")),
        proteinPer100: Number(manualP.replace(",", ".")),
        fatPer100: Number(manualF.replace(",", ".")),
        carbsPer100: Number(manualC.replace(",", ".")),
      });
      if ("error" in saved) return saved;
      return logProductPortion(userId, { eatenOn: date, slot, productId: saved.product.id, grams: g });
    });
  }

  function buildSuggestions() {
    if (!day?.remaining) return;
    const lastGrams = new Map<string, number>();
    for (const entry of recent) {
      if (entry.grams == null) continue;
      const key = entry.dishId ? `dish:${entry.dishId}` : entry.productId ? `product:${entry.productId}` : "";
      if (key && !lastGrams.has(key)) lastGrams.set(key, entry.grams);
    }
    const candidates: MealSuggestion[] = [];
    for (const dish of dishes) {
      const g = lastGrams.get(`dish:${dish.id}`) ?? 200;
      const k = g / 100;
      candidates.push({
        kind: "dish",
        id: dish.id,
        name: dish.name,
        grams: g,
        kcal: Math.round(dish.per100.kcal * k * 10) / 10,
        proteinG: Math.round(dish.per100.proteinG * k * 10) / 10,
        fatG: Math.round(dish.per100.fatG * k * 10) / 10,
        carbsG: Math.round(dish.per100.carbsG * k * 10) / 10,
      });
    }
    for (const product of products) {
      const g = lastGrams.get(`product:${product.id}`) ?? 100;
      const k = g / 100;
      candidates.push({
        kind: "product",
        id: product.id,
        name: product.name,
        grams: g,
        kcal: Math.round(product.kcalPer100 * k * 10) / 10,
        proteinG: Math.round(product.proteinPer100 * k * 10) / 10,
        fatG: Math.round(product.fatPer100 * k * 10) / 10,
        carbsG: Math.round(product.carbsPer100 * k * 10) / 10,
      });
    }
    setSuggestions(suggestRemainingMeals(day.remaining, candidates));
  }

  const slotsWithFood = new Set(day?.entries.map((e) => e.slot) ?? []);

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-glow-primary/40">
          <Flame className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Дневник</h1>
          <p className="text-xs text-muted-foreground leading-snug">
            Что съедено, остаток КБЖУ, свои блюда. План меню — в разделе «Еда».
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDate((d) => shiftIso(d, -1))}>
          Назад
        </Button>
        <div className="text-sm font-medium tabular-nums">{date}</div>
        <Button type="button" variant="outline" size="sm" onClick={() => setDate((d) => shiftIso(d, 1))}>
          Вперёд
        </Button>
      </div>

      {error ? (
        <p className="text-xs rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
          {error}
        </p>
      ) : null}

      {loading && !day ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}

      {day ? (
        <Card size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Осталось</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {day.targetError ? (
              <p className="text-xs text-muted-foreground">{day.targetError}</p>
            ) : day.remaining && day.target ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                <MacroCell label="ккал" left={day.remaining.kcal} eaten={day.eaten.kcal} target={day.target.kcal} />
                <MacroCell label="белок" left={day.remaining.proteinG} eaten={day.eaten.proteinG} target={day.target.proteinG} />
                <MacroCell label="жир" left={day.remaining.fatG} eaten={day.eaten.fatG} target={day.target.fatG} />
                <MacroCell label="углеводы" left={day.remaining.carbsG} eaten={day.eaten.carbsG} target={day.target.carbsG} />
              </div>
            ) : null}
            {day.target?.carbsTrimmed ? (
              <p className="text-[11px] text-muted-foreground">Углеводы ужаты, чтобы жир не упал ниже пола.</p>
            ) : null}
            {slotsWithFood.size > 0 && slotsWithFood.size < 2 ? (
              <p className="text-[11px] text-muted-foreground">День пока неполный: меньше двух приёмов.</p>
            ) : null}
            <Button type="button" variant="secondary" size="sm" disabled={busy || !day.remaining} onClick={buildSuggestions}>
              Что добрать
            </Button>
            {suggestions.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {suggestions.map((s) => (
                  <li key={`${s.kind}:${s.id}`}>
                    {s.name}, {fmt(s.grams)} г — {fmt(s.kcal)} ккал, Б {fmt(s.proteinG)}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Вес утром</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            inputMode="decimal"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder="кг"
          />
          <Button
            type="button"
            disabled={busy || !userId}
            onClick={() =>
              userId &&
              void run(() => saveWeight(userId, date, Number(weightInput.replace(",", "."))))
            }
          >
            Сохранить
          </Button>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Записать</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {MEAL_SLOTS.map((s) => (
              <Button
                key={s.id}
                type="button"
                size="sm"
                variant={slot === s.id ? "default" : "outline"}
                onClick={() => setSlot(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <div>
            <Label className="text-xs">Граммы</Label>
            <Input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" />
          </div>
          {recentProducts.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {recentProducts.map(({ product, grams: g }) => (
                <Button
                  key={product.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPicked({ kind: "product", product });
                    setGrams(String(g));
                  }}
                >
                  {product.name}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="творог Ирмень"
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSearch();
              }}
            />
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void onSearch()}>
              Найти
            </Button>
          </div>
          {localHits.length > 0 ? (
            <HitList
              title="Свои"
              items={localHits.map((p) => ({
                key: p.id,
                label: `${p.name} · ${fmt(p.kcalPer100)} ккал/100`,
                onPick: () => setPicked({ kind: "product", product: p }),
              }))}
            />
          ) : null}
          {referenceHits.length > 0 ? (
            <HitList
              title="Справочник"
              items={referenceHits.map((item) => ({
                key: item.id,
                label: `${item.name}${item.note ? ` · ${item.note}` : ""} · ${fmt(item.kcalPer100)} ккал/100`,
                onPick: () => setPicked({ kind: "reference", item }),
              }))}
            />
          ) : null}
          {magnitHits.length > 0 ? (
            <HitList
              title="Магнит"
              items={magnitHits.map((h) => ({
                key: h.externalId,
                label:
                  h.kcalPer100 != null
                    ? `${h.name} · ${fmt(h.kcalPer100)} ккал/100`
                    : `${h.name} · нет КБЖУ`,
                onPick: () => setPicked({ kind: "magnit", hit: h }),
              }))}
            />
          ) : null}
          {magnitNote ? <p className="text-[11px] text-muted-foreground">{magnitNote}</p> : null}
          {yarcheNote ? <p className="text-[11px] text-muted-foreground">{yarcheNote}</p> : null}
          {picked ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-2 py-2">
              <span className="text-xs">
                {picked.kind === "product"
                  ? picked.product.name
                  : picked.kind === "reference"
                    ? picked.item.name
                    : picked.hit.name}
              </span>
              <Button type="button" size="sm" disabled={busy} onClick={() => void logPicked()}>
                В приём
              </Button>
            </div>
          ) : null}

          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="text-xs font-medium">С упаковки, на 100 г</div>
            <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Название" />
            <div className="grid grid-cols-4 gap-1">
              <Input value={manualKcal} onChange={(e) => setManualKcal(e.target.value)} placeholder="ккал" />
              <Input value={manualP} onChange={(e) => setManualP(e.target.value)} placeholder="Б" />
              <Input value={manualF} onChange={(e) => setManualF(e.target.value)} placeholder="Ж" />
              <Input value={manualC} onChange={(e) => setManualC(e.target.value)} placeholder="У" />
            </div>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void logManual()}>
              Сохранить и записать
            </Button>
          </div>

          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="text-xs font-medium">Только калории</div>
            <Input value={quickLabel} onChange={(e) => setQuickLabel(e.target.value)} placeholder="Обед в столовой" />
            <Input value={quickKcal} onChange={(e) => setQuickKcal(e.target.value)} placeholder="ккал" inputMode="decimal" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || !userId}
              onClick={() =>
                userId &&
                void run(() =>
                  logQuickMeal(userId, {
                    eatenOn: date,
                    slot,
                    label: quickLabel,
                    kcal: Number(quickKcal.replace(",", ".")),
                  })
                )
              }
            >
              Записать
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Сегодня</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {day && day.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Пока пусто.</p>
          ) : null}
          {MEAL_SLOTS.map((s) => {
            const rows = day?.entries.filter((e) => e.slot === s.id) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={s.id}>
                <div className="text-[11px] text-muted-foreground">{slotLabel(s.id)}</div>
                <ul className="space-y-1">
                  {rows.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
                      <span>
                        {entry.label}
                        {entry.grams != null ? ` · ${fmt(entry.grams)} г` : ""} · {fmt(entry.kcal)} ккал
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy || !userId}
                        aria-label="Удалить"
                        onClick={() => userId && void run(() => softDeleteFoodLog(userId, entry.id))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <DishBuilder
        userId={userId}
        products={products}
        dishes={dishes}
        slot={slot}
        onSlot={setSlot}
        busy={busy}
        date={date}
        run={run}
      />

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Норма</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSettingsOpen((v) => !v)}>
            {settingsOpen ? "Скрыть" : "Белок и углеводы, г/кг"}
          </Button>
          {settingsOpen && day ? (
            <SettingsForm
              proteinPerKg={proteinPerKg}
              carbsPerKg={carbsPerKg}
              deficitMin={deficitMin}
              deficitMax={deficitMax}
              setProteinPerKg={setProteinPerKg}
              setCarbsPerKg={setCarbsPerKg}
              setDeficitMin={setDeficitMin}
              setDeficitMax={setDeficitMax}
              disabled={busy || !userId}
              onSave={() => {
                if (!userId || !day) return;
                let lo = Number(deficitMin);
                let hi = Number(deficitMax);
                if (lo > hi) {
                  const swap = lo;
                  lo = hi;
                  hi = swap;
                }
                const next: NutritionSettings = {
                  ...day.settings,
                  proteinGPerKg: Number(proteinPerKg.replace(",", ".")),
                  carbsGPerKg: Number(carbsPerKg.replace(",", ".")),
                  deficitKcalMin: lo,
                  deficitKcalMax: hi,
                };
                void run(() => saveNutritionSettings(userId, next));
              }}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MacroCell({
  label,
  left,
  eaten,
  target,
}: {
  label: string;
  left: number;
  eaten: number;
  target: number;
}) {
  return (
    <div>
      <div className={`text-sm font-semibold tabular-nums ${left < 0 ? "text-destructive" : ""}`}>{fmt(left)}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {fmt(eaten)}/{fmt(target)}
      </div>
    </div>
  );
}

function HitList({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; onPick: () => void }[];
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">{title}</div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" className="text-left text-xs underline-offset-2 hover:underline" onClick={item.onPick}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsForm(props: {
  proteinPerKg: string;
  carbsPerKg: string;
  deficitMin: string;
  deficitMax: string;
  setProteinPerKg: (v: string) => void;
  setCarbsPerKg: (v: string) => void;
  setDeficitMin: (v: string) => void;
  setDeficitMax: (v: string) => void;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Белок, г/кг</Label>
          <Input value={props.proteinPerKg} onChange={(e) => props.setProteinPerKg(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Углеводы, г/кг</Label>
          <Input value={props.carbsPerKg} onChange={(e) => props.setCarbsPerKg(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Дефицит от</Label>
          <Input value={props.deficitMin} onChange={(e) => props.setDeficitMin(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Дефицит до</Label>
          <Input value={props.deficitMax} onChange={(e) => props.setDeficitMax(e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Жир — остаток калорий, не ниже 0,5 г/кг. Ккал = TDEE минус середина дефицита.
      </p>
      <Button type="button" size="sm" disabled={props.disabled} onClick={props.onSave}>
        Сохранить норму
      </Button>
    </div>
  );
}
