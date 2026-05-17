import type { SwimBlockPhase } from "@/types/database";
import { roundSwimMeters } from "./distance";
import {
  normalizeGoalSelection,
  phasePercentsForGoals,
  type SwimGoalCode,
} from "./swimGoals";
import { templateFitsInventory } from "./swimEquipment";
import {
  catalogDateSeed,
  createSeededRng,
  type SeededRng,
} from "./swimPlanRng";

/** Поля шаблона, нужные сборщику (совпадают с select в fetchSwimBlockTemplates). */
export type SwimCatalogBlock = {
  slug: string;
  phase: SwimBlockPhase;
  goal_tags: string[];
  equipment_tags?: string[] | null;
  nominal_distance_m: number;
  min_m: number;
  max_m: number;
  scale_mode: string;
  body_text: string;
  active: boolean | null;
};

export type CatalogWorkoutSeries = {
  distance: number;
  description: string;
  phase?: SwimBlockPhase;
};

export type BuildCatalogOptions = {
  /** `null` — не фильтровать по снаряжению; `[]` — только блоки без требований */
  inventory?: string[] | null;
  /** Врезка в первый блок разминки (среднесрочный план и т.п.) */
  prependWarmupNote?: string;
  /**
   * Зерно детерминированной ротации. По умолчанию — календарная дата (один день → один порядок).
   */
  shuffleSeed?: number;
};

const TAIL_MERGE_THRESHOLD_M = 100;
const MIN_SERIES_COUNT = 2;
const MIN_SESSION_M = 200;
const MAX_SESSION_M = 12000;

function templateMatchesGoals(
  block: SwimCatalogBlock,
  goals: SwimGoalCode[]
): boolean {
  return goals.some((g) => block.goal_tags.includes(g));
}

function shuffleInPlace<T>(arr: T[], rng: SeededRng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/**
 * Масштабирование метража блока в [min_m, max_m] с округлением к 25 м.
 * Возвращает null, если в оставшийся бюджет фазы блок не влезает осмысленно.
 */
function scaleBlockDistance(
  block: SwimCatalogBlock,
  remaining: number
): number | null {
  if (remaining < 25) return null;

  const maxAllowed = Math.min(block.max_m, remaining);
  if (maxAllowed < block.min_m) return null;

  let raw = Math.min(remaining, block.nominal_distance_m);
  raw = Math.max(raw, block.min_m);
  raw = Math.min(raw, maxAllowed);

  let d = roundSwimMeters(raw);
  if (d > remaining) {
    const stepped = roundSwimMeters(remaining);
    if (stepped >= block.min_m && stepped <= maxAllowed) d = stepped;
    else return null;
  }
  if (d < block.min_m || d > maxAllowed) return null;
  return d;
}

function roundDeltaMeters(delta: number, step = 25): number {
  if (delta === 0) return 0;
  const rounded = Math.round(delta / step) * step;
  if (rounded === 0) return delta > 0 ? step : -step;
  return rounded;
}

/** Приклеить мелкий остаток (<100 м) к последнему блоку с поясняющей строкой. */
function mergeSessionTail(
  series: CatalogWorkoutSeries[],
  remainderM: number
): void {
  if (
    series.length === 0 ||
    remainderM === 0 ||
    Math.abs(remainderM) >= TAIL_MERGE_THRESHOLD_M
  ) {
    return;
  }
  const abs = Math.abs(remainderM);
  if (abs < 25) return;

  const last = series[series.length - 1]!;
  const adjusted = last.distance + roundDeltaMeters(remainderM);
  last.distance = Math.max(25, roundSwimMeters(adjusted));
  if (remainderM > 0) {
    last.description += `\n\n+${remainderM} м лёгкий/контроль — добор в том же режиме, без отдельной карточки`;
  } else {
    last.description += `\n\n−${abs} м убери ~1 повтор — сократи последний кусок блока на эту дистанцию`;
  }
}

function mergePhaseTail(
  blocks: CatalogWorkoutSeries[],
  remainder: number
): void {
  if (remainder < 25 || remainder >= TAIL_MERGE_THRESHOLD_M || blocks.length === 0) {
    return;
  }
  const last = blocks[blocks.length - 1]!;
  last.distance = Math.max(
    25,
    roundSwimMeters(last.distance + roundDeltaMeters(remainder))
  );
  last.description += `\n\n+${remainder} м в конце блока — добор в том же режиме`;
}

function fillPhase(
  budget: number,
  phase: SwimBlockPhase,
  pool: SwimCatalogBlock[],
  goals: SwimGoalCode[],
  inventory: string[] | null,
  lastSlug: { current: string | null },
  rng: SeededRng
): CatalogWorkoutSeries[] | null {
  const candidates = pool.filter(
    (t) =>
      t.phase === phase &&
      (t.active ?? true) &&
      templateMatchesGoals(t, goals) &&
      templateFitsInventory(t.equipment_tags, inventory)
  );

  if (budget < 25) return [];
  if (candidates.length === 0) return null;

  shuffleInPlace(candidates, rng);

  const out: CatalogWorkoutSeries[] = [];
  let remaining = budget;
  let scan = 0;
  const maxPasses = candidates.length * 48;

  for (let pass = 0; pass < maxPasses && remaining >= 25; pass++) {
    const t = candidates[scan % candidates.length]!;
    scan++;

    const d = scaleBlockDistance(t, remaining);
    if (d === null) continue;
    if (t.slug === lastSlug.current && candidates.length > 1) continue;

    out.push({
      distance: d,
      description: t.body_text,
      phase,
    });
    lastSlug.current = t.slug;
    remaining -= d;
  }

  if (remaining >= 25) {
    if (out.length > 0 && remaining < TAIL_MERGE_THRESHOLD_M) {
      mergePhaseTail(out, remaining);
      return out;
    }
    return null;
  }

  if (remaining > 0 && remaining < 25 && out.length > 0) {
    mergePhaseTail(out, remaining);
  }

  return out;
}

/**
 * Собирает тренировку из каталога `swim_block_template`: фазы, ротация шаблонов,
 * масштабирование в [min_m, max_m], округление к 25 м, склейка хвоста <100 м.
 *
 * @returns Серии с опциональным `phase` или `null` — вызывающий код должен вызвать
 *          {@link generateSwimWorkoutPlan} как fallback.
 */
export function buildWorkoutFromCatalog(
  goal: SwimGoalCode | SwimGoalCode[],
  targetVolume: number,
  blocks: SwimCatalogBlock[],
  options?: BuildCatalogOptions
): CatalogWorkoutSeries[] | null {
  if (!blocks.length) return null;

  const raw = Number(targetVolume);
  if (!Number.isFinite(raw) || raw < MIN_SESSION_M) return null;

  const goals = normalizeGoalSelection(
    Array.isArray(goal) ? goal : [goal]
  );
  const inventory =
    options?.inventory !== undefined ? options.inventory : null;
  const total = roundSwimMeters(Math.min(MAX_SESSION_M, raw));
  const { warmPct, coolPct } = phasePercentsForGoals(goals);

  let warm = roundSwimMeters(total * warmPct);
  let cool = roundSwimMeters(total * coolPct);
  let main = total - warm - cool;
  if (main < 200) {
    main += warm - roundSwimMeters(100);
    warm = roundSwimMeters(100);
  }

  const seed =
    options?.shuffleSeed != null
      ? (options.shuffleSeed ^ 0x13579bdf) >>> 0
      : (catalogDateSeed() ^ 0x13579bdf) >>> 0;
  const rng = createSeededRng(seed);
  const lastSlug = { current: null as string | null };

  const w = fillPhase(warm, "warmup", blocks, goals, inventory, lastSlug, rng);
  if (w === null) return null;
  const m = fillPhase(main, "main", blocks, goals, inventory, lastSlug, rng);
  if (m === null) return null;
  const c = fillPhase(
    cool,
    "cooldown",
    blocks,
    goals,
    inventory,
    lastSlug,
    rng
  );
  if (c === null) return null;

  const out: CatalogWorkoutSeries[] = [...w, ...m, ...c];

  const note = options?.prependWarmupNote?.trim();
  if (note && out.length > 0) {
    const first = out[0]!;
    out[0] = {
      ...first,
      description: `Связка с планом: ${note}\n\n${first.description}`,
    };
  }

  const sum = out.reduce((s, x) => s + x.distance, 0);
  const drift = total - sum;

  if (Math.abs(drift) < TAIL_MERGE_THRESHOLD_M) {
    mergeSessionTail(out, drift);
  } else if (drift !== 0) {
    return null;
  }

  if (out.length < MIN_SERIES_COUNT) return null;

  const finalSum = out.reduce((s, x) => s + x.distance, 0);
  if (finalSum !== total && Math.abs(total - finalSum) >= TAIL_MERGE_THRESHOLD_M) {
    return null;
  }

  return out;
}
