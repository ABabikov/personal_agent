export type AmountUnit = "g" | "piece" | "tbsp";

export function gramsFromAmount(
  amount: number,
  unit: AmountUnit,
  food: { pieceGrams?: number | null; tbspGrams?: number | null }
): number | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  if (unit === "g") return Math.round(amount * 10) / 10;
  if (unit === "piece" && food.pieceGrams != null && food.pieceGrams > 0) {
    return Math.round(amount * food.pieceGrams * 10) / 10;
  }
  if (unit === "tbsp" && food.tbspGrams != null && food.tbspGrams > 0) {
    return Math.round(amount * food.tbspGrams * 10) / 10;
  }
  return null;
}
