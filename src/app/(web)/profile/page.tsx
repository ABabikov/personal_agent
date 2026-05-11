"use client";

import { useState } from "react";
import { User, Flame, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  calculateBMR,
  calculateTDEE,
  ACTIVITY_LEVELS,
} from "@/lib/features/workouts/calories";
import { cn } from "@/lib/utils";

type Gender = "male" | "female";

export default function ProfilePage() {
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("male");
  const [activityLevel, setActivityLevel] = useState(1.55);
  const [bodyFat, setBodyFat] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");

  const w = parseFloat(weight);
  const h = parseFloat(height);
  const a = parseInt(age);
  const hasProfile = w > 0 && h > 0 && a > 0;

  const bmr = hasProfile ? calculateBMR(w, h, a, gender) : null;
  const tdee = bmr ? calculateTDEE(bmr, activityLevel) : null;

  async function handleSave() {
    // TODO: save to Supabase
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15">
          <User className="size-5 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">Профиль</h1>
      </div>

      {/* Physical parameters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Физические параметры</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="weight">Вес</Label>
              <div className="relative mt-1.5">
                <Input
                  id="weight"
                  type="number"
                  step="0.1"
                  min="30"
                  max="200"
                  placeholder="80"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="pr-8"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  кг
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="height">Рост</Label>
              <div className="relative mt-1.5">
                <Input
                  id="height"
                  type="number"
                  min="100"
                  max="250"
                  placeholder="178"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="pr-8"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  см
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="age">Возраст</Label>
              <Input
                id="age"
                type="number"
                min="10"
                max="100"
                placeholder="30"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          {/* Gender */}
          <div>
            <Label>Пол</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["male", "female"] as Gender[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
                    gender === g
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-accent"
                  )}
                >
                  {g === "male" ? "Мужской" : "Женский"}
                </button>
              ))}
            </div>
          </div>

          {/* Body fat (optional) */}
          <div>
            <Label htmlFor="body-fat">Процент жира (опционально)</Label>
            <div className="relative mt-1.5">
              <Input
                id="body-fat"
                type="number"
                step="0.1"
                min="3"
                max="50"
                placeholder="Для Katch-McArdle"
                value={bodyFat}
                onChange={(e) => setBodyFat(e.target.value)}
                className="pr-8"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                %
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity level */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Уровень активности</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {ACTIVITY_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setActivityLevel(level.value)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all",
                  activityLevel === level.value
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-accent"
                )}
              >
                <span className="text-sm">{level.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  x{level.value}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* BMR/TDEE Calculator */}
      {hasProfile && bmr && tdee ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4 text-primary" />
              Расход калорий
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
              <div>
                <p className="text-sm font-medium">BMR</p>
                <p className="text-xs text-muted-foreground">
                  Базовый метаболизм
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold tabular-nums">
                  {Math.round(bmr).toLocaleString("ru")}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">ккал</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-primary">TDEE</p>
                <p className="text-xs text-muted-foreground">
                  Суточный расход
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold tabular-nums text-primary">
                  {Math.round(tdee).toLocaleString("ru")}
                </span>
                <span className="ml-1 text-sm text-primary/70">ккал</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Формула Mifflin-St Jeor
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
              <Flame className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Заполните параметры для расчёта BMR и TDEE
            </p>
          </CardContent>
        </Card>
      )}

      {/* Save button */}
      <Button onClick={handleSave} className="w-full" size="lg">
        {saveState === "saved" ? "Сохранено" : "Сохранить профиль"}
      </Button>
    </div>
  );
}
