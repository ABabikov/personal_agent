"use client";

import { useMemo, useState } from "react";
import { dateFromIso } from "@/lib/features/workouts/analytics";

export type ChartSeries = {
  id: string;
  label: string;
  color: string;
  points: { date: string; value: number }[];
};

export interface LineChartProps {
  series: ChartSeries[];
  unit?: string;
  height?: number;
  /** Минимальная высота даже когда мало точек */
  yFormat?: (n: number) => string;
  emptyMessage?: string;
}

const PADDING = { top: 12, right: 12, bottom: 22, left: 36 };

function defaultYFormat(n: number): string {
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("ru");
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 10) / 10).toLocaleString("ru");
}

function formatDateShort(iso: string): string {
  return dateFromIso(iso).toLocaleDateString("ru", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Лёгкий SVG-line-chart с поддержкой нескольких рядов.
 * Без зависимостей; адаптивный viewBox.
 */
export function LineChart({
  series,
  unit,
  height = 220,
  yFormat = defaultYFormat,
  emptyMessage = "Нет данных за период",
}: LineChartProps) {
  const width = 600;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const allPoints = series.flatMap((s) => s.points);
  const [hover, setHover] = useState<{
    seriesId: string;
    x: number;
    y: number;
    date: string;
    value: number;
  } | null>(null);

  const layout = useMemo(() => {
    if (allPoints.length === 0) return null;

    const xDates = allPoints.map((p) => dateFromIso(p.date).getTime());
    const xMin = Math.min(...xDates);
    const xMax = Math.max(...xDates);
    const xSpan = Math.max(1, xMax - xMin);

    const yValues = allPoints.map((p) => p.value);
    const yMaxRaw = Math.max(...yValues);
    const yMinRaw = Math.min(...yValues);
    const yPad = (yMaxRaw - yMinRaw) * 0.1 || Math.max(1, yMaxRaw * 0.1);
    const yMin = Math.max(0, yMinRaw - yPad);
    const yMax = yMaxRaw + yPad || 1;

    const xScale = (iso: string) => {
      const t = dateFromIso(iso).getTime();
      return PADDING.left + ((t - xMin) / xSpan) * innerW;
    };
    const yScale = (v: number) =>
      PADDING.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const yTicks: number[] = [];
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i++) {
      yTicks.push(yMin + ((yMax - yMin) * i) / tickCount);
    }

    return { xScale, yScale, xMin, xMax, yMin, yMax, yTicks };
  }, [allPoints, innerH, innerW]);

  if (!layout) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card/50 text-xs text-muted-foreground"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const { xScale, yScale, yTicks } = layout;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-auto w-full"
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t, i) => {
          const y = yScale(t);
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={1}
                opacity={0.6}
              />
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {yFormat(t)}
              </text>
            </g>
          );
        })}

        {series.map((s) => {
          if (s.points.length === 0) return null;
          const d = s.points
            .map((p, i) => {
              const x = xScale(p.date);
              const y = yScale(p.value);
              return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ");
          return (
            <g key={s.id}>
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {s.points.map((p, i) => {
                const x = xScale(p.date);
                const y = yScale(p.value);
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={3.5}
                    fill={s.color}
                    onMouseEnter={() =>
                      setHover({
                        seriesId: s.id,
                        x,
                        y,
                        date: p.date,
                        value: p.value,
                      })
                    }
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </g>
          );
        })}

        {hover && (
          <g pointerEvents="none">
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PADDING.top}
              y2={height - PADDING.bottom}
              stroke="currentColor"
              className="text-muted-foreground"
              strokeDasharray="2 3"
              opacity={0.6}
            />
            <circle cx={hover.x} cy={hover.y} r={5} fill="white" opacity={0.15} />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
          style={{
            left: `calc(${(hover.x / width) * 100}% - 60px)`,
            top: `${(hover.y / height) * 100}%`,
            transform: "translateY(-110%)",
            minWidth: 110,
          }}
        >
          <div className="text-muted-foreground">{formatDateShort(hover.date)}</div>
          <div className="font-semibold tabular-nums">
            {yFormat(hover.value)}
            {unit ? ` ${unit}` : ""}
          </div>
        </div>
      )}

      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
              {s.points.length > 0 ? ` (${s.points.length})` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
