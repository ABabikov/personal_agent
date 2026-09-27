"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  logDishPortion,
  saveDish,
  saveFoodProduct,
  type DishView,
  type FoodProduct,
} from "@/lib/db/nutrition";
import { dishPer100, macrosForGrams } from "@/lib/features/nutrition/dishMacros";
import { gramsFromAmount, type AmountUnit } from "@/lib/features/nutrition/portionUnits";
import {
  foodQueryMatches,
  searchReferenceFoods,
  type ReferenceFood,
} from "@/lib/features/nutrition/referenceCatalog";
import { MEAL_SLOTS, type MealSlotId } from "@/lib/features/nutrition/slots";

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type DraftLine = {
  key: string;
  name: string;
  productId: string | null;
  externalId: string | null;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  amount: string;
  unit: AmountUnit;
  pieceGrams: number | null;
  tbspGrams: number | null;
};

function lineFromReference(item: ReferenceFood): DraftLine {
  return {
    key: `${item.id}-${Date.now()}`,
    name: item.name,
    productId: null,
    externalId: `ref:${item.id}`,
    kcalPer100: item.kcalPer100,
    proteinPer100: item.proteinPer100,
    fatPer100: item.fatPer100,
    carbsPer100: item.carbsPer100,
    amount: "",
    unit: item.pieceGrams ? "piece" : item.tbspGrams ? "tbsp" : "g",
    pieceGrams: item.pieceGrams ?? null,
    tbspGrams: item.tbspGrams ?? null,
  };
}

function lineFromProduct(product: FoodProduct): DraftLine {
  return {
    key: `${product.id}-${Date.now()}`,
    name: product.name,
    productId: product.id,
    externalId: product.externalId,
    kcalPer100: product.kcalPer100,
    proteinPer100: product.proteinPer100,
    fatPer100: product.fatPer100,
    carbsPer100: product.carbsPer100,
    amount: "",
    unit: "g",
    pieceGrams: null,
    tbspGrams: null,
  };
}

function parseAmount(value: string): number {
  return Number(value.replace(",", "."));
}

export function DishBuilder({
  userId,
  products,
  dishes,
  slot,
  onSlot,
  busy,
  date,
  run,
}: {
  userId: string | null;
  products: FoodProduct[];
  dishes: DishView[];
  slot: MealSlotId;
  onSlot: (slot: MealSlotId) => void;
  busy: boolean;
  date: string;
  run: (fn: () => Promise<{ error?: string } | object | void>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [cooked, setCooked] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [query, setQuery] = useState("");
  const [portionGrams, setPortionGrams] = useState<Record<string, string>>({});

  const queryTrim = query.trim();
  const referenceHits = queryTrim.length >= 2 ? searchReferenceFoods(queryTrim, 8) : [];
  const localHits =
    queryTrim.length >= 2 ? products.filter((p) => foodQueryMatches(queryTrim, p.name)).slice(0, 6) : [];

  const preview = useMemo(() => {
    const ingredients = lines.flatMap((line) => {
      const grams = gramsFromAmount(parseAmount(line.amount), line.unit, line);
      if (grams == null) return [];
      return [
        {
          grams,
          kcalPer100: line.kcalPer100,
          proteinPer100: line.proteinPer100,
          fatPer100: line.fatPer100,
          carbsPer100: line.carbsPer100,
        },
      ];
    });
    if (ingredients.length === 0) return null;
    const cookedG = cooked.trim() ? parseAmount(cooked) : ingredients.reduce((sum, line) => sum + line.grams, 0);
    const calc = dishPer100(ingredients, cookedG);
    if ("error" in calc) return { error: calc.error };
    return { ...calc, cookedG };
  }, [lines, cooked]);

  function addLine(line: DraftLine) {
    setLines((rows) => [...rows, line]);
    setQuery("");
  }

  async function save() {
    if (!userId || !preview || "error" in preview) return;
    await run(async () => {
      const ingredients: { productId: string; grams: number }[] = [];
      for (const line of lines) {
        const grams = gramsFromAmount(parseAmount(line.amount), line.unit, line);
        if (grams == null) continue;
        let productId = line.productId;
        if (!productId) {
          const saved = await saveFoodProduct(userId, {
            name: line.name,
            source: "manual",
            externalId: line.externalId,
            kcalPer100: line.kcalPer100,
            proteinPer100: line.proteinPer100,
            fatPer100: line.fatPer100,
            carbsPer100: line.carbsPer100,
          });
          if ("error" in saved) return saved;
          productId = saved.product.id;
        }
        ingredients.push({ productId, grams });
      }
      const result = await saveDish(userId, {
        name,
        cookedWeightG: cooked.trim() ? parseAmount(cooked) : null,
        ingredients,
      });
      if (!("error" in result)) {
        setName("");
        setCooked("");
        setLines([]);
      }
      return result;
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Своё блюдо</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dishes.map((dish) => {
          const gramsText = portionGrams[dish.id] ?? "";
          const grams = parseAmount(gramsText);
          const portion = grams > 0 ? macrosForGrams(grams, dish.per100) : null;
          return (
            <div key={dish.id} className="space-y-2 rounded-lg border border-border/50 px-2 py-2">
              <div className="text-xs font-medium">{dish.name}</div>
              <div className="text-[11px] text-muted-foreground">
                всё {fmt(dish.cookedWeightG)} г: {fmt(dish.total.kcal)} ккал · Б {fmt(dish.total.proteinG)} · Ж{" "}
                {fmt(dish.total.fatG)} · У {fmt(dish.total.carbsG)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                на 100 г: {fmt(dish.per100.kcal)} ккал · Б {fmt(dish.per100.proteinG)} · Ж {fmt(dish.per100.fatG)} · У{" "}
                {fmt(dish.per100.carbsG)}
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  ["1/4", 0.25],
                  ["1/2", 0.5],
                  ["всё", 1],
                ].map(([label, fraction]) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPortionGrams((map) => ({
                        ...map,
                        [dish.id]: String(Math.round(dish.cookedWeightG * Number(fraction))),
                      }))
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={gramsText}
                  onChange={(e) => setPortionGrams((map) => ({ ...map, [dish.id]: e.target.value }))}
                  placeholder="граммы"
                  inputMode="decimal"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !userId || !(grams > 0)}
                  onClick={() =>
                    userId &&
                    void run(() =>
                      logDishPortion(userId, {
                        eatenOn: date,
                        slot,
                        dishId: dish.id,
                        grams,
                      })
                    )
                  }
                >
                  В приём
                </Button>
              </div>
              {portion ? (
                <div className="text-[11px] text-muted-foreground">
                  {fmt(grams)} г · {fmt(portion.kcal)} ккал · Б {fmt(portion.proteinG)} · Ж {fmt(portion.fatG)} · У{" "}
                  {fmt(portion.carbsG)}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="flex flex-wrap gap-1">
          {MEAL_SLOTS.map((s) => (
            <Button
              key={s.id}
              type="button"
              size="sm"
              variant={slot === s.id ? "default" : "outline"}
              onClick={() => onSlot(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название, например запеканка" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти продукт: творог, манка, капуста"
        />
        {localHits.length > 0 ? (
          <HitList
            title="Свои"
            items={localHits.map((p) => ({
              key: p.id,
              label: `${p.name} · ${fmt(p.kcalPer100)} ккал/100`,
              onPick: () => addLine(lineFromProduct(p)),
            }))}
          />
        ) : null}
        {referenceHits.length > 0 ? (
          <HitList
            title="Справочник"
            items={referenceHits.map((item) => ({
              key: item.id,
              label: `${item.name}${item.note ? ` · ${item.note}` : ""} · ${fmt(item.kcalPer100)} ккал/100`,
              onPick: () => addLine(lineFromReference(item)),
            }))}
          />
        ) : null}

        {lines.map((line) => (
          <div key={line.key} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs">{line.name}</span>
            <Input
              className="w-16"
              value={line.amount}
              placeholder={line.unit === "piece" ? "шт" : line.unit === "tbsp" ? "ложки" : "г"}
              inputMode="decimal"
              onChange={(e) =>
                setLines((rows) => rows.map((row) => (row.key === line.key ? { ...row, amount: e.target.value } : row)))
              }
            />
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-1 text-xs"
              value={line.unit}
              onChange={(e) =>
                setLines((rows) =>
                  rows.map((row) => (row.key === line.key ? { ...row, unit: e.target.value as AmountUnit } : row))
                )
              }
            >
              <option value="g">г</option>
              {line.pieceGrams ? <option value="piece">шт</option> : null}
              {line.tbspGrams ? <option value="tbsp">ст. л.</option> : null}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Убрать"
              onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}

        <Input
          value={cooked}
          onChange={(e) => setCooked(e.target.value)}
          placeholder="Вес готового, г. Пусто — сумма ингредиентов"
        />
        {preview && "error" in preview ? (
          <p className="text-[11px] text-destructive">{preview.error}</p>
        ) : preview ? (
          <div className="text-[11px] text-muted-foreground">
            всё {fmt(preview.cookedG)} г: {fmt(preview.total.kcal)} ккал · Б {fmt(preview.total.proteinG)} · Ж{" "}
            {fmt(preview.total.fatG)} · У {fmt(preview.total.carbsG)}. На 100 г: {fmt(preview.per100.kcal)} ккал. 1/4 ={" "}
            {fmt(Math.round(preview.cookedG / 4))} г, {fmt(preview.total.kcal / 4)} ккал.
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Найди продукты, укажи граммы, штуки или ложки. Потом сохрани и записывай порцию в приём.
          </p>
        )}
        <Button
          type="button"
          size="sm"
          disabled={busy || !userId || !name.trim() || !preview || "error" in preview}
          onClick={() => void save()}
        >
          Сохранить блюдо
        </Button>
      </CardContent>
    </Card>
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
      <div className="mb-1 text-[11px] text-muted-foreground">{title}</div>
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
