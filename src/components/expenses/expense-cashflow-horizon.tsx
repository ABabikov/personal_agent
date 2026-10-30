"use client";

import { useMemo, useState } from "react";
import type { CashflowMonthBucket } from "@/lib/features/expenses/cashflowHorizon";
import { formatRub } from "@/lib/db/expensesData";

type Props = {
  buckets: CashflowMonthBucket[];
  height?: number;
};

const PADDING = { top: 14, right: 44, bottom: 28, left: 40 };
const COLOR_INCOME = "#10b981";
const COLOR_EXPENSE = "#ef4444";
const COLOR_BALANCE = "#0ea5e9";

function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

/**
 * Гистограмма доход/расход + кривая накопительного баланса.
 * 12 мес назад + текущий + 6 вперёд (прогноз/HOLD).
 */
export function ExpenseCashflowHorizon({ buckets, height = 200 }: Props) {
  const width = 720;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const [hover, setHover] = useState<number | null>(null);

  const layout = useMemo(() => {
    if (buckets.length === 0) return null;
    const barMax = Math.max(
      ...buckets.flatMap((b) => [b.income, b.expense]),
      1
    );
    const balVals = buckets
      .map((b) => b.balance)
      .filter((v): v is number => v != null);
    const balMin = balVals.length ? Math.min(...balVals, 0) : 0;
    const balMax = balVals.length ? Math.max(...balVals, 0) : 100_000;
    const balPad =
      (balMax - balMin) * 0.12 || Math.max(10_000, Math.abs(balMax) * 0.1);
    const yBalMin = balMin - balPad;
    const yBalMax = balMax + balPad;

    const slot = innerW / buckets.length;
    const barPad = Math.min(3, slot * 0.12);
    const pairW = slot - barPad * 2;
    const barW = pairW / 2;

    const yBar = (v: number) =>
      PADDING.top + innerH - (v / (barMax * 1.08)) * innerH;
    const yBal = (v: number) =>
      PADDING.top +
      innerH -
      ((v - yBalMin) / Math.max(1, yBalMax - yBalMin)) * innerH;

    const barTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * barMax * 1.08);
    const balTicks = [0, 0.25, 0.5, 0.75, 1].map(
      (t) => yBalMin + t * (yBalMax - yBalMin)
    );

    return {
      barMax,
      yBar,
      yBal,
      slot,
      barPad,
      barW,
      barTicks,
      balTicks,
      yBalMin,
      yBalMax,
    };
  }, [buckets, innerH, innerW]);

  if (!layout) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
        style={{ height }}
      >
        Нет данных для горизонта
      </div>
    );
  }

  const { yBar, yBal, slot, barPad, barW, barTicks, balTicks } = layout;
  const zeroY = yBar(0);

  // Кривая только там, где balance известен (текущий + прогноз)
  const firstBalIdx = buckets.findIndex((p) => p.balance != null);
  const balancePath = buckets
    .map((b, i) => {
      if (b.balance == null) return null;
      const x = PADDING.left + slot * i + slot / 2;
      const y = yBal(b.balance);
      return `${i === firstBalIdx ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");

  const hovered = hover != null ? buckets[hover] : null;

  return (
    <div className="relative w-full">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          12 мес назад · вперёд · доход / расход; баланс с «сейчас»
        </p>
        <p className="text-[10px] text-muted-foreground">
          баланс = операционный ₽ с текущего месяца (якорь); прошлое — только
          столбцы; USD/пассив вне кривой
        </p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-auto w-full"
        onMouseLeave={() => setHover(null)}
      >
        {/* сетка по расходам/доходам */}
        {barTicks.map((t, i) => {
          const y = yBar(t);
          return (
            <g key={`g-${i}`}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={1}
                opacity={0.5}
              />
              <text
                x={PADDING.left - 4}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={9}
              >
                {fmtK(t)}
              </text>
            </g>
          );
        })}

        {/* правая ось баланса */}
        {balTicks.map((t, i) => (
          <text
            key={`b-${i}`}
            x={width - PADDING.right + 4}
            y={yBal(t)}
            textAnchor="start"
            dominantBaseline="middle"
            className="fill-sky-600/80 dark:fill-sky-400/80"
            fontSize={9}
          >
            {fmtK(t)}
          </text>
        ))}

        {/* зона прогноза */}
        {buckets.map((b, i) => {
          if (!b.isForecast) return null;
          const x = PADDING.left + slot * i;
          return (
            <rect
              key={`fc-${b.ym}`}
              x={x}
              y={PADDING.top}
              width={slot}
              height={innerH}
              className="fill-muted/40"
            />
          );
        })}

        {/* столбцы */}
        {buckets.map((b, i) => {
          const gx = PADDING.left + slot * i + barPad;
          const cx = PADDING.left + slot * i + slot / 2;
          const monthNum = Number(b.ym.slice(5, 7));
          const showLabel =
            buckets.length <= 14 || monthNum % 2 === 1 || b.isCurrent;
          const axisLabel =
            monthNum === 1 ? `${b.label}’${b.ym.slice(2, 4)}` : b.label;
          return (
            <g
              key={b.ym}
              onMouseEnter={() => setHover(i)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={gx}
                y={yBar(b.income)}
                width={Math.max(1, barW - 0.5)}
                height={Math.max(0, zeroY - yBar(b.income))}
                fill={COLOR_INCOME}
                opacity={b.isForecast ? 0.55 : 0.9}
              />
              <rect
                x={gx + barW}
                y={yBar(b.expense)}
                width={Math.max(1, barW - 0.5)}
                height={Math.max(0, zeroY - yBar(b.expense))}
                fill={COLOR_EXPENSE}
                opacity={b.isForecast ? 0.55 : 0.9}
              />
              {b.isCurrent && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={PADDING.top}
                  y2={height - PADDING.bottom}
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.45}
                />
              )}
              {showLabel && (
                <text
                  x={cx}
                  y={height - PADDING.bottom + 12}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                  fontWeight={b.isCurrent ? 600 : 400}
                >
                  {axisLabel}
                </text>
              )}
            </g>
          );
        })}

        {/* кривая баланса — только текущий + прогноз */}
        {balancePath && (
          <path
            d={balancePath}
            fill="none"
            stroke={COLOR_BALANCE}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {buckets.map((b, i) => {
          if (b.balance == null) return null;
          const x = PADDING.left + slot * i + slot / 2;
          const y = yBal(b.balance);
          return (
            <circle
              key={`pt-${b.ym}`}
              cx={x}
              cy={y}
              r={b.isCurrent ? 3.5 : 2.2}
              fill={COLOR_BALANCE}
              opacity={b.isForecast ? 0.7 : 1}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-10 w-[min(100%,220px)] -translate-x-1/2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm">
          <div className="font-medium capitalize">
            {hovered.tooltip}
            {hovered.isForecast ? " · прогноз" : ""}
            {hovered.isCurrent ? " · сейчас" : ""}
          </div>
          <div className="mt-0.5 space-y-0.5 tabular-nums">
            <div className="flex justify-between gap-3">
              <span className="text-emerald-600 dark:text-emerald-400">доход</span>
              <span>{formatRub(hovered.income)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-red-500">расход</span>
              <span>{formatRub(hovered.expense)}</span>
            </div>
            {hovered.transfer > 0 && (
              <div className="flex justify-between gap-3">
                <span className="text-sky-600 dark:text-sky-400">
                  списания с дебета
                </span>
                <span>{formatRub(hovered.transfer)}</span>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-border/60 pt-0.5 font-semibold">
              <span className="text-sky-600 dark:text-sky-400">баланс</span>
              <span>
                {hovered.balance != null
                  ? formatRub(hovered.balance)
                  : "н/д"}
              </span>
            </div>
            {hovered.balance == null && (
              <div className="text-[10px] font-normal text-muted-foreground">
                нетто по ликвиду за месяц: {formatRub(hovered.liquidNet)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ background: COLOR_INCOME }} />
          доход
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ background: COLOR_EXPENSE }} />
          расход
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ background: COLOR_BALANCE }} />
          баланс (с сейчас)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-muted" />
          прогноз
        </span>
      </div>
    </div>
  );
}
