/**
 * Упрощённый снимок позиции: активы / пассивы / чистыми.
 * Цифры — ориентир из env (пока нет балансов на счетах в БД).
 * Не путать с кривой cashflow: там только операционный ₽ «на жизнь».
 */

export type PositionLine = {
  id: string;
  label: string;
  /** Сумма в ₽ для сравнения на графике */
  amountRub: number;
  /** Подпись вторичная, напр. «4 000 $» */
  detail?: string;
  side: "asset" | "liability";
};

export type PositionSnapshot = {
  assets: PositionLine[];
  liabilities: PositionLine[];
  assetsTotalRub: number;
  liabilitiesTotalRub: number;
  /** Активы − пассивы */
  netRub: number;
  /** Курс USD→RUB, которым считали резерв */
  usdRate: number;
};

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Операционный ₽-кэш (якорь cashflow). */
export function getOperatingCashRub(): number {
  return envNumber("NEXT_PUBLIC_EXPENSE_OPERATING_CASH", 125_000);
}

/** Резерв USD (не операционный). */
export function getUsdReserve(): number {
  return envNumber("NEXT_PUBLIC_EXPENSE_USD_RESERVE", 4_000);
}

/** Курс для перевода резерва в ₽ на снимке. */
export function getUsdRateRub(): number {
  return envNumber("NEXT_PUBLIC_EXPENSE_USD_RATE", 95);
}

/** ОД кредитки, ₽. */
export function getCardDebtRub(): number {
  return envNumber("NEXT_PUBLIC_EXPENSE_CARD_DEBT", 200_000);
}

export function buildPositionSnapshot(
  overrides: Partial<{
    operatingCashRub: number;
    usdReserve: number;
    usdRate: number;
    cardDebtRub: number;
  }> = {}
): PositionSnapshot {
  const operatingCashRub = overrides.operatingCashRub ?? getOperatingCashRub();
  const usdReserve = overrides.usdReserve ?? getUsdReserve();
  const usdRate = overrides.usdRate ?? getUsdRateRub();
  const cardDebtRub = overrides.cardDebtRub ?? getCardDebtRub();
  const usdRub = Math.round(usdReserve * usdRate);

  const assets: PositionLine[] = [
    {
      id: "operating",
      label: "Операционный кэш",
      amountRub: operatingCashRub,
      detail: "на жизнь",
      side: "asset",
    },
  ];
  if (usdReserve > 0) {
    assets.push({
      id: "usd-reserve",
      label: "Резерв USD",
      amountRub: usdRub,
      detail: `${usdReserve.toLocaleString("ru")} $ × ${usdRate}`,
      side: "asset",
    });
  }

  const liabilities: PositionLine[] = [];
  if (cardDebtRub > 0) {
    liabilities.push({
      id: "card-debt",
      label: "Долг кредитки",
      amountRub: cardDebtRub,
      detail: "ОД",
      side: "liability",
    });
  }

  const assetsTotalRub = assets.reduce((s, a) => s + a.amountRub, 0);
  const liabilitiesTotalRub = liabilities.reduce((s, a) => s + a.amountRub, 0);

  return {
    assets,
    liabilities,
    assetsTotalRub,
    liabilitiesTotalRub,
    netRub: assetsTotalRub - liabilitiesTotalRub,
    usdRate,
  };
}
