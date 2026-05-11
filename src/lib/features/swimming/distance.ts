/** Calculate total distance for a swimming workout */
export function totalDistance(series: { distance: number }[]): number {
  return series.reduce((sum, s) => sum + s.distance, 0);
}
