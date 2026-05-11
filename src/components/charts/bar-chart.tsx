"use client";

import { useMemo, useState } from "react";

export type BarGroup = {
  /** Метка по оси X */
  label: string;
  /** Подпись в тултипе (например, полный месяц-год) */
  tooltip?: string;
  /** Значения по сериям, в том же порядке, что и `series` */
  values: number[];
};

export type BarSeriesDef = {
  id: string;
  label: string;
  color: string;
};

interface BarChartProps {
  groups: BarGroup[];
  series: BarSeriesDef[];
  height?: number;
  yFormat?: (n: number) => string;
  emptyMessage?: string;
}

const PADDING = { top: 12, right: 12, bottom: 30, left: 44 };

function defaultYFormat(n: number): string {
  if (Math.abs(n) >= 1000) return Math.round(n / 1000) + "k";
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 10) / 10).toLocaleString("ru");
}

export function BarChart({
  groups,
  series,
  height = 240,
  yFormat = defaultYFormat,
  emptyMessage = "Нет данных за период",
}: BarChartProps) {
  const width = 600;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const [hover, setHover] = useState<{
    groupIdx: number;
    seriesIdx: number;
    x: number;
    y: number;
  } | null>(null);

  const layout = useMemo(() => {
    if (groups.length === 0) return null;
    const allVals = groups.flatMap((g) => g.values);
    if (allVals.length === 0) return null;
    const yMaxRaw = Math.max(...allVals, 0);
    const yMax = yMaxRaw > 0 ? yMaxRaw * 1.1 : 1;
    const yScale = (v: number) => PADDING.top + innerH - (v / yMax) * innerH;

    const groupCount = groups.length;
    const groupSlot = innerW / groupCount;
    const groupPad = Math.min(8, groupSlot * 0.15);
    const innerSlot = groupSlot - groupPad * 2;
    const barCount = Math.max(1, series.length);
    const barW = innerSlot / barCount;

    const yTicks: number[] = [];
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i++) yTicks.push((yMax * i) / tickCount);

    return { yScale, yMax, groupSlot, groupPad, barW, yTicks };
  }, [groups, series, innerW, innerH]);

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

  const { yScale, groupSlot, groupPad, barW, yTicks } = layout;

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

        {groups.map((g, gi) => {
          const gx = PADDING.left + groupSlot * gi + groupPad;
          const cx = gx + (groupSlot - groupPad * 2) / 2;
          return (
            <g key={gi}>
              {g.values.map((v, si) => {
                const x = gx + barW * si;
                const y = yScale(v);
                const h = yScale(0) - y;
                return (
                  <rect
                    key={si}
                    x={x}
                    y={y}
                    width={Math.max(1, barW - 1)}
                    height={Math.max(0, h)}
                    fill={series[si]?.color ?? "currentColor"}
                    onMouseEnter={() =>
                      setHover({
                        groupIdx: gi,
                        seriesIdx: si,
                        x: x + barW / 2,
                        y,
                      })
                    }
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
              <text
                x={cx}
                y={height - PADDING.bottom + 14}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
          style={{
            left: `calc(${(hover.x / width) * 100}% - 70px)`,
            top: `${(hover.y / height) * 100}%`,
            transform: "translateY(-110%)",
            minWidth: 140,
          }}
        >
          <div className="text-muted-foreground">
            {groups[hover.groupIdx]?.tooltip ?? groups[hover.groupIdx]?.label}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: series[hover.seriesIdx]?.color }}
            />
            <span>{series[hover.seriesIdx]?.label}</span>
          </div>
          <div className="font-semibold tabular-nums">
            {groups[hover.groupIdx].values[hover.seriesIdx].toLocaleString("ru")}
          </div>
        </div>
      )}

      {series.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
