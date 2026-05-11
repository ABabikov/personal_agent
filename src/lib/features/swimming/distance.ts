/** Calculate total distance for a swimming workout */
export function totalDistance(series: { distance: number }[]): number {
  return series.reduce((sum, s) => sum + s.distance, 0);
}

/** Округление метража к шагу бассейна (по умолчанию 25 м). */
export function roundSwimMeters(m: number, step = 25): number {
  return Math.max(step, Math.round(m / step) * step);
}
