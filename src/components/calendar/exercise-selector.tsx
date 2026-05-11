"use client";

import { cn } from "@/lib/utils";

interface ExerciseSelectorProps {
  options: string[];
  value: string | null;
  onChange: (name: string) => void;
  label?: string;
}

export function ExerciseSelector({
  options,
  value,
  onChange,
  label = "Упражнение",
}: ExerciseSelectorProps) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              value === name
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
