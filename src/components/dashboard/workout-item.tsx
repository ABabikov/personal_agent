import { Dumbbell, Waves, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkoutItemProps {
  type: "gym" | "swim";
  date: string;
  value: number;
  unit: string;
  exercises?: number;
  onClick?: () => void;
}

export function WorkoutItem({
  type,
  date,
  value,
  unit,
  exercises,
  onClick,
}: WorkoutItemProps) {
  const Icon = type === "gym" ? Dumbbell : Waves;
  const formattedDate = new Date(date).toLocaleDateString("ru", {
    day: "numeric",
    month: "short",
  });

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent active:scale-[0.99]"
      )}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          type === "gym" && "bg-gym/15 text-gym",
          type === "swim" && "bg-swim/15 text-swim"
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {type === "gym" ? "Силовая" : "Плавание"}
          </span>
          <span className="text-xs text-muted-foreground">{formattedDate}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {value.toLocaleString("ru")}
          </span>
          <span>{unit}</span>
          {exercises !== undefined && (
            <>
              <span className="text-border">|</span>
              <span>
                {exercises} {exercises === 1 ? "упражнение" : "упражнений"}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}
