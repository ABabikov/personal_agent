import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface TotalCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  unit: string;
  variant?: "gym" | "swim";
}

export function TotalCard({
  icon: Icon,
  label,
  value,
  unit,
  variant = "gym",
}: TotalCardProps) {
  if (value <= 0) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl p-4",
        variant === "gym" && "bg-gym text-gym-foreground",
        variant === "swim" && "bg-swim text-swim-foreground"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-5 opacity-80" />
        <span className="text-sm font-medium opacity-90">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">
          {value.toLocaleString("ru")}
        </span>
        <span className="text-sm opacity-80">{unit}</span>
      </div>
    </div>
  );
}
