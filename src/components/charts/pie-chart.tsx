"use client";

import { useMemo, useState } from "react";

export type PieSlice = {
  id: string;
  label: string;
  value: number;
  /** CSS color */
  color: string;
};

interface PieChartProps {
  slices: PieSlice[];
  /** Виден размер svg в пикселях (виды масштабируется через viewBox) */
  size?: number;
  /** Радиус «дырки» как доля от внешнего радиуса (0 = pie, 0.6 = donut) */
  innerRadiusRatio?: number;
  /** Подпись по центру (например, "1.2 млн ₽") */
  centerLabel?: string;
  centerSubLabel?: string;
  /** Форматирование значения для тултипа */
  valueFormat?: (v: number) => string;
  emptyMessage?: string;
}

const VIEW_SIZE = 200;

function polarToCart(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number
): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const a = polarToCart(cx, cy, rOuter, startAngle);
  const b = polarToCart(cx, cy, rOuter, endAngle);
  const c = polarToCart(cx, cy, rInner, endAngle);
  const d = polarToCart(cx, cy, rInner, startAngle);
  return [
    `M ${a.x} ${a.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${b.x} ${b.y}`,
    `L ${c.x} ${c.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${d.x} ${d.y}`,
    "Z",
  ].join(" ");
}

export function PieChart({
  slices,
  size = 200,
  innerRadiusRatio = 0.6,
  centerLabel,
  centerSubLabel,
  valueFormat = (v) => v.toLocaleString("ru"),
  emptyMessage = "Нет данных",
}: PieChartProps) {
  const total = useMemo(
    () => slices.reduce((s, x) => s + Math.max(0, x.value), 0),
    [slices]
  );

  const [hover, setHover] = useState<{ id: string; cx: number; cy: number } | null>(null);

  const cx = VIEW_SIZE / 2;
  const cy = VIEW_SIZE / 2;
  const rOuter = VIEW_SIZE / 2 - 4;
  const rInner = rOuter * innerRadiusRatio;

  // Начинаем сверху (12 часов).
  const startBase = -Math.PI / 2;

  const paths = useMemo(() => {
    if (total <= 0) return [];
    let angle = startBase;
    const out: { slice: PieSlice; d: string; midAngle: number }[] = [];
    for (const s of slices) {
      const v = Math.max(0, s.value);
      if (v === 0) continue;
      const span = (v / total) * Math.PI * 2;
      const next = angle + span;
      out.push({ slice: s, d: arcPath(cx, cy, rOuter, rInner, angle, next), midAngle: (angle + next) / 2 });
      angle = next;
    }
    return out;
  }, [slices, total, cx, cy, rOuter, rInner, startBase]);

  if (total <= 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card/50 text-xs text-muted-foreground"
        style={{ height: size }}
      >
        {emptyMessage}
      </div>
    );
  }

  const hoverSlice = hover ? slices.find((s) => s.id === hover.id) : null;
  const hoverShare = hoverSlice ? hoverSlice.value / total : 0;

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
        width={size}
        height={size}
        className="block"
        onMouseLeave={() => setHover(null)}
      >
        {paths.map(({ slice, d, midAngle }) => {
          const isHover = hover?.id === slice.id;
          const hit = polarToCart(cx, cy, (rOuter + rInner) / 2, midAngle);
          return (
            <path
              key={slice.id}
              d={d}
              fill={slice.color}
              opacity={hover && !isHover ? 0.45 : 1}
              onMouseEnter={() => setHover({ id: slice.id, cx: hit.x, cy: hit.y })}
              style={{ cursor: "pointer", transition: "opacity 120ms" }}
            />
          );
        })}

        {(centerLabel || centerSubLabel) && (
          <g>
            {centerLabel && (
              <text
                x={cx}
                y={cy - (centerSubLabel ? 4 : 0)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground"
                fontSize={16}
                fontWeight={600}
              >
                {centerLabel}
              </text>
            )}
            {centerSubLabel && (
              <text
                x={cx}
                y={cy + 12}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={9}
              >
                {centerSubLabel}
              </text>
            )}
          </g>
        )}
      </svg>

      {hoverSlice && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${(hover!.cx / VIEW_SIZE) * 100}%`,
            top: `${(hover!.cy / VIEW_SIZE) * 100}%`,
            transform: "translate(-50%, -120%)",
            minWidth: 120,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: hoverSlice.color }}
            />
            <span className="truncate font-medium">{hoverSlice.label}</span>
          </div>
          <div className="font-semibold tabular-nums">
            {valueFormat(hoverSlice.value)}
          </div>
          <div className="text-muted-foreground tabular-nums">
            {(hoverShare * 100).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}
