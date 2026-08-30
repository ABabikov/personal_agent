"use client";

import type { ReactNode } from "react";
import { Watch, Flame, Heart } from "lucide-react";
import type { DeviceWorkoutEnrichment } from "@/lib/db/deviceWorkoutEnrichment";
import { cn } from "@/lib/utils";

interface DeviceMetricsStripProps {
  device: DeviceWorkoutEnrichment;
  /** MET-оценка из workouts.calories_estimated — показываем рядом для сравнения */
  caloriesEstimated?: number | null;
  className?: string;
  compact?: boolean;
}

export function DeviceMetricsStrip({
  device,
  caloriesEstimated,
  className,
  compact = false,
}: DeviceMetricsStripProps) {
  const parts: { icon: ReactNode | null; text: string }[] = [];

  if (device.activityLabel) {
    parts.push({
      icon: <Watch className="size-3 shrink-0 opacity-70" />,
      text: device.activityLabel,
    });
  }
  if (device.durationMinutes != null) {
    parts.push({
      icon: null,
      text: `${device.durationMinutes} мин`,
    });
  }
  if (device.caloriesDevice != null) {
    parts.push({
      icon: <Flame className="size-3 shrink-0 text-orange-500/80" />,
      text: `${Math.round(device.caloriesDevice)} ккал`,
    });
  }
  if (device.avgHeartRate != null) {
    parts.push({
      icon: <Heart className="size-3 shrink-0 text-rose-500/80" />,
      text: `${Math.round(device.avgHeartRate)} уд/мин`,
    });
  }

  if (parts.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-muted/25",
        compact ? "px-2.5 py-1.5" : "px-3 py-2",
        className
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Huawei Health
      </p>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums",
          compact ? "text-xs" : "text-sm"
        )}
      >
        {parts.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-foreground/90">
            {p.icon}
            {p.text}
          </span>
        ))}
      </div>
      {caloriesEstimated != null && device.caloriesDevice != null && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          MET в журнале: ~{Math.round(caloriesEstimated)} ккал · часы:{" "}
          {Math.round(device.caloriesDevice)} ккал
        </p>
      )}
    </div>
  );
}
