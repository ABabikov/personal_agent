/** Детерминированный RNG для воспроизводимых тестов; на UI — новый seed на каждое нажатие. */

export type SeededRng = {
  /** [0, 1) */
  next: () => number;
  /** [0, n), n >= 1 */
  nextInt: (n: number) => number;
};

export function createSeededRng(seed: number): SeededRng {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
  return {
    next,
    nextInt(n: number) {
      if (n <= 1) return 0;
      return Math.floor(next() * n);
    },
  };
}

export function defaultShuffleSeed(): number {
  return (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
}

/** Календарный сид: одинаковые входы в один день дают одинаковую ротацию блоков. */
export function catalogDateSeed(date = new Date()): number {
  return (
    date.getFullYear() * 10_000 +
    (date.getMonth() + 1) * 100 +
    date.getDate()
  ) >>> 0;
}

/** Выбор элемента массива, избегая последних `avoidRecent` индексов (если возможно). */
export function pickVariantAvoidingRecent<T>(
  arr: readonly T[],
  rng: SeededRng,
  recentIdx: number[],
  avoidRecent = 2
): { value: T; idx: number } {
  const L = arr.length;
  if (L === 0) throw new Error("empty variants");
  const avoid = new Set(recentIdx.slice(-avoidRecent));
  for (let attempt = 0; attempt < 24; attempt++) {
    const idx = rng.nextInt(L);
    if (!avoid.has(idx) || avoid.size >= L) {
      return { value: arr[idx]!, idx };
    }
  }
  const idx = rng.nextInt(L);
  return { value: arr[idx]!, idx };
}
