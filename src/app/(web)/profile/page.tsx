"use client";

import { useState } from "react";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  calculateBMR,
  calculateTDEE,
  ACTIVITY_LEVELS,
} from "@/lib/features/workouts/calories";

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
    // TODO: сохранить в Supabase
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <User className="size-5" />
        <h2 className="text-xl font-semibold">Профиль</h2>
      </div>

      {/* Основные данные */}
      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle>Физические параметры</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="weight">Вес (кг)</Label>
              <Input
                id="weight"
                type="number"
                step="0.1"
                min="30"
                max="200"
                placeholder="80.0"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="height">Рост (см)</Label>
              <Input
                id="height"
                type="number"
                min="100"
                max="250"
                placeholder="178"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="mt-1"
              />
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
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>Пол</Label>
            <div className="mt-1 flex gap-2">
              {(["male", "female"] as Gender[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    gender === g
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-muted"
                  }`}
                >
                  {g === "male" ? "Мужской" : "Женский"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="body-fat">% жира (необязательно)</Label>
            <Input
              id="body-fat"
              type="number"
              step="0.1"
              min="3"
              max="50"
              placeholder="Для формулы Katch-McArdle"
              value={bodyFat}
              onChange={(e) => setBodyFat(e.target.value)}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Уровень активности */}
      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle>Уровень активности</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-2">
            {ACTIVITY_LEVELS.map((level) => (
              <button
                key={level.value}
                onClick={() => setActivityLevel(level.value)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  activityLevel === level.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-input bg-background hover:bg-muted"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>{level.label}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    ×{level.value}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Калькулятор BMR/TDEE */}
      {hasProfile && bmr && tdee ? (
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle>Расчёт калорий (Mifflin-St Jeor)</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <div>
                  <p className="font-medium">BMR</p>
                  <p className="text-xs text-muted-foreground">
                    Базовый метаболизм в покое
                  </p>
                </div>
                <span className="text-xl font-bold">
                  {Math.round(bmr).toLocaleString("ru")} ккал
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <div>
                  <p className="font-medium">TDEE</p>
                  <p className="text-xs text-muted-foreground">
                    Суточный расход с учётом активности
                  </p>
                </div>
                <span className="text-xl font-bold text-primary">
                  {Math.round(tdee).toLocaleString("ru")} ккал
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground text-center py-2">
              Заполните вес, рост и возраст — покажем BMR и TDEE
            </p>
          </CardContent>
        </Card>
      )}

      <Button onClick={handleSave} className="w-full" size="lg">
        {saveState === "saved" ? "Сохранено ✓" : "Сохранить профиль"}
      </Button>
    </div>
  );
}
