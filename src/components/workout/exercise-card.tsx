"use client";

import { Trash2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SetInput {
  weight: string;
  reps: string;
}

export interface ExerciseInput {
  id: string;
  name: string;
  sets: SetInput[];
}

interface ExerciseCardProps {
  exercise: ExerciseInput;
  index: number;
  tonnage: number;
  canDelete: boolean;
  onNameChange: (name: string) => void;
  onSetChange: (setIndex: number, field: "weight" | "reps", value: string) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
  onDelete: () => void;
}

export function ExerciseCard({
  exercise,
  index,
  tonnage,
  canDelete,
  onNameChange,
  onSetChange,
  onAddSet,
  onRemoveSet,
  onDelete,
}: ExerciseCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gym/15 text-xs font-medium text-gym">
          {index + 1}
        </span>
        <Input
          placeholder="Название упражнения"
          value={exercise.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="h-8 flex-1 border-0 bg-transparent px-2 focus-visible:ring-0"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={!canDelete}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {/* Sets */}
      <div className="p-3">
        <div className="overflow-x-auto -mx-3 px-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="w-10 pb-2 text-left text-xs font-normal">Подход</th>
                {exercise.sets.map((_, i) => (
                  <th
                    key={i}
                    className="min-w-[60px] pb-2 text-center text-xs font-normal"
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>{i + 1}</span>
                      {exercise.sets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveSet(i)}
                          className="ml-0.5 rounded-sm p-0.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Minus className="size-2.5" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                {exercise.sets.length < 6 && (
                  <th className="w-8 pb-2">
                    <button
                      type="button"
                      onClick={onAddSet}
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1 text-xs text-muted-foreground">кг</td>
                {exercise.sets.map((s, i) => (
                  <td key={i} className="px-0.5 py-1">
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="—"
                      value={s.weight}
                      onChange={(e) => onSetChange(i, "weight", e.target.value)}
                      className="h-9 text-center tabular-nums"
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1 text-xs text-muted-foreground">повт</td>
                {exercise.sets.map((s, i) => (
                  <td key={i} className="px-0.5 py-1">
                    <Input
                      type="number"
                      min="0"
                      placeholder="—"
                      value={s.reps}
                      onChange={(e) => onSetChange(i, "reps", e.target.value)}
                      className="h-9 text-center tabular-nums"
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tonnage */}
        {tonnage > 0 && (
          <div className="mt-3 flex items-center justify-end gap-1.5 text-sm">
            <span className="text-muted-foreground">Тоннаж:</span>
            <span className="font-semibold text-gym tabular-nums">
              {tonnage.toLocaleString("ru")} кг
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
