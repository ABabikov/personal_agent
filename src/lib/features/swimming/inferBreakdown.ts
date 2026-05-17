import { parseFixedSegmentDistances } from "./swimSeriesText";

/**
 * Предзаполнение полей «повторы × м на отрезок» для серии плавания.
 * 1) Явные N×M в тексте, если произведение = метраж серии.
 * 2) Одинаковые отрезки в начале строк («150 сп…», «150 вс…») → reps × lap.
 * 3) Иначе типичные длины дорожки, совпадающие с метражом.
 */
export function inferBreakdownForSeries(
  distanceM: number,
  description: string
): { reps: string; perRepM: string } | null {
  if (!Number.isFinite(distanceM) || distanceM < 25) return null;

  const multRe = /(\d+)\s*[×xх]\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  multRe.lastIndex = 0;
  while ((match = multRe.exec(description)) !== null) {
    const r = parseInt(match[1]!, 10);
    const lap = parseInt(match[2]!, 10);
    if (r > 0 && lap > 0 && r * lap === distanceM) {
      return { reps: String(r), perRepM: String(lap) };
    }
  }

  const segments = parseFixedSegmentDistances(description);
  if (segments.length > 0) {
    const lap = segments[0]!;
    if (segments.every((d) => d === lap)) {
      const n = segments.length;
      const sum = n * lap;
      if (sum === distanceM) {
        return { reps: String(n), perRepM: String(lap) };
      }
    }
  }

  const preferredLaps = [
    150, 200, 100, 400, 300, 50, 250, 75, 125, 175, 225, 350, 450, 500,
    600, 25,
  ];

  for (const lap of preferredLaps) {
    if (lap > distanceM || lap < 25) continue;
    if (distanceM % lap !== 0) continue;
    const reps = distanceM / lap;
    if (reps >= 1 && reps <= 500) {
      return { reps: String(reps), perRepM: String(lap) };
    }
  }

  for (let lap = 25; lap <= distanceM; lap += 25) {
    if (distanceM % lap !== 0) continue;
    const reps = distanceM / lap;
    if (reps >= 1 && reps <= 500) {
      return { reps: String(reps), perRepM: String(lap) };
    }
  }

  return null;
}
