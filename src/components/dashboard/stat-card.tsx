import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  trend?: {
    value: number;
    label: string;
  };
  variant?: "default" | "gym" | "swim";
  className?: string;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  trend,
  variant = "default",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-3",
        className
      )}
    >
      <div
        className={cn(
          "absolute -right-2 -top-2 size-16 rounded-full opacity-10",
          variant === "gym" && "bg-gym",
          variant === "swim" && "bg-swim",
          variant === "default" && "bg-primary"
        )}
      />
      <div className="relative">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon
            className={cn(
              "size-3.5",
              variant === "gym" && "text-gym",
              variant === "swim" && "text-swim",
              variant === "default" && "text-primary"
            )}
          />
          <span className="text-xs">{label}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {unit && (
            <span className="text-sm text-muted-foreground">{unit}</span>
          )}
        </div>
        {trend && (
          <div
            className={cn(
              "mt-1 text-xs",
              trend.value >= 0 ? "text-primary" : "text-destructive"
            )}
          >
            {trend.value >= 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </div>
        )}
      </div>
    </div>
  );
}
