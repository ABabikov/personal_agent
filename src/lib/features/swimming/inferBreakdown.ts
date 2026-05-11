/**
 * Предзаполнение полей «повторы × м на отрезок» для серии плавания.
 * Сначала ищем в тексте конструкции вида 5×200 / 5x200 / 5х200; если произведение
 * совпадает с суммарным метражом серии — используем её.
 * Иначе подбираем натуральное разложение distance = reps × lap с типичными длинами дорожек.
 */
export function inferBreakdownForSeries(
  distanceM: number,
  description: string
): { reps: string; perRepM: string } | null {
  if (!Number.isFinite(distanceM) || distanceM < 25) return null;

  const multRe =
    /(\d+)\s*[×xх]\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  multRe.lastIndex = 0;
  while ((match = multRe.exec(description)) !== null) {
    const r = parseInt(match[1], 10);
    const lap = parseInt(match[2], 10);
    if (r > 0 && lap > 0 && r * lap === distanceM) {
      return { reps: String(r), perRepM: String(lap) };
    }
  }

  /** Типичные длины отрезков (м): раньше в списке — выше приоритет при равной делимости */
  const preferredLaps = [
    200, 100, 400, 300, 150, 50, 250, 75, 125, 175, 225, 350, 450, 500, 600,
    25,
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
