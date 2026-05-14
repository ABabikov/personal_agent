import type { SwimPlanSeries } from "./generatePlan";
import { roundSwimMeters } from "./distance";
import type { SwimGoalCode } from "./swimGoals";
import {
  normalizeGoalSelection,
  phasePercentsForGoals,
} from "./swimGoals";
import { templateFitsInventory } from "./swimEquipment";
import { createSeededRng, defaultShuffleSeed, type SeededRng } from "./swimPlanRng";

function templateMatchesGoals(
  t: SwimBlockTemplateRow,
  goals: SwimGoalCode[]
): boolean {
  return goals.some((g) => t.goal_tags.includes(g));
}

export type SwimBlockTemplateRow = {
  slug: string;
  phase: "warmup" | "main" | "cooldown";
  goal_tags: string[];
  /** Требуемое снаряжение; пусто или отсутствует — блок без особых требований */
  equipment_tags?: string[] | null;
  nominal_distance_m: number;
  min_m: number;
  max_m: number;
  scale_mode: string;
  body_text: string;
  active: boolean | null;
};

function mergeSmallRemainder(
  blocks: SwimPlanSeries[],
  remainder: number,
  threshold: number
): void {
  if (remainder < 25 || remainder >= threshold || blocks.length === 0) return;
  const last = blocks[blocks.length - 1];
  last.distance += remainder;
  last.description +=
    `\n\n+ добор ${remainder} м сразу тем же режимом без паузы между «сериями» (общий метраж блока уже учитывает добор)`;
}

function pickDistance(
  t: SwimBlockTemplateRow,
  remaining: number
): number | null {
  if (remaining < 25) return null;
  if (remaining < t.min_m) return null;
  const raw = Math.min(remaining, t.nominal_distance_m);
  let d = Math.max(raw, t.min_m);
  d = Math.min(d, t.max_m, remaining);
  if (d < t.min_m || d > remaining) return null;
  return d;
}

const TAIL_MERGE_MAX_M = 220;

function fillPhase(
  budget: number,
  phase: SwimBlockTemplateRow["phase"],
  pool: SwimBlockTemplateRow[],
  goals: SwimGoalCode[],
  inventory: string[] | null,
  lastSlug: { current: string | null },
  rng: SeededRng
): SwimPlanSeries[] | null {
  const rows = pool.filter(
    (t) =>
      t.phase === phase &&
      templateMatchesGoals(t, goals) &&
      templateFitsInventory(t.equipment_tags, inventory) &&
      (t.active ?? true)
  );
  if (budget < 25) return [];
  if (rows.length === 0) return null;

  const out: SwimPlanSeries[] = [];
  let remaining = budget;

  while (remaining >= 25) {
    const scored = rows
      .map((t) => ({ t, d: pickDistance(t, remaining) }))
      .filter((x): x is { t: SwimBlockTemplateRow; d: number } => x.d !== null);

    if (scored.length === 0) {
      if (out.length > 0 && remaining >= 25 && remaining <= TAIL_MERGE_MAX_M) {
        mergeSmallRemainder(out, remaining, TAIL_MERGE_MAX_M + 1);
        return out;
      }
      return null;
    }

    let filtered = scored.filter((x) => x.t.slug !== lastSlug.current);
    if (filtered.length === 0) filtered = scored;

    filtered.sort((a, b) => b.d - a.d || a.t.slug.localeCompare(b.t.slug));
    const topK = Math.min(6, filtered.length);
    const slice = filtered.slice(0, topK);
    const noRepeat = slice.filter((x) => x.t.slug !== lastSlug.current);
    const pickFrom = noRepeat.length > 0 ? noRepeat : slice;
    const { t, d } = pickFrom[rng.nextInt(pickFrom.length)]!;
    out.push({ distance: d, description: t.body_text });
    lastSlug.current = t.slug;
    remaining -= d;
  }

  if (remaining > 0 && remaining < 25 && out.length > 0) {
    mergeSmallRemainder(out, remaining, 100);
  }

  return out;
}

/**
 * Сборка серий из каталога шаблонов. Возвращает null, если для какой-то фазы не удалось набрать метраж —
 * тогда вызывающий код должен перейти на эвристический {@link generateSwimWorkoutPlan}.
 */
export type BuildCatalogOptions = {
  /** Если не передано или `inventory === null` — не фильтровать по снаряжению */
  inventory?: string[] | null;
  /** Врезка в первый блок разминки из каталога (среднесрочный план и т.п.) */
  prependWarmupNote?: string;
  /**
   * Зерно случайности при выборе блоков из каталога (на каждое нажатие «Сгенерировать» — новое).
   * Без него выбор жёстко детерминирован (всегда «лучший» по метражу шаблон).
   */
  shuffleSeed?: number;
};

export function buildWorkoutFromCatalog(
  templates: SwimBlockTemplateRow[],
  goalCodes: SwimGoalCode[],
  totalMetersRaw: number,
  options?: BuildCatalogOptions
): SwimPlanSeries[] | null {
  const raw = Number(totalMetersRaw);
  if (!Number.isFinite(raw) || raw < 200) return null;

  const inventory =
    options?.inventory !== undefined ? options.inventory : null;
  const goals = normalizeGoalSelection(goalCodes);
  const total = roundSwimMeters(Math.min(12000, raw));
  const { warmPct, coolPct } = phasePercentsForGoals(goals);

  let warm = roundSwimMeters(total * warmPct);
  let cool = roundSwimMeters(total * coolPct);
  let main = total - warm - cool;
  if (main < 200) {
    main += warm - roundSwimMeters(100);
    warm = roundSwimMeters(100);
  }

  const lastSlug = { current: null as string | null };
  const seed =
    options?.shuffleSeed != null
      ? (options.shuffleSeed ^ 0x13579bdf) >>> 0
      : (defaultShuffleSeed() ^ 0x13579bdf) >>> 0;
  const rng = createSeededRng(seed);

  const w = fillPhase(warm, "warmup", templates, goals, inventory, lastSlug, rng);
  if (w === null) return null;
  const m = fillPhase(main, "main", templates, goals, inventory, lastSlug, rng);
  if (m === null) return null;
  const c = fillPhase(cool, "cooldown", templates, goals, inventory, lastSlug, rng);
  if (c === null) return null;

  const out = [...w, ...m, ...c];
  const note = options?.prependWarmupNote?.trim();
  if (note && out.length > 0) {
    const first = out[0]!;
    out[0] = {
      ...first,
      description: `Связка с планом: ${note}\n\n${first.description}`,
    };
  }
  let sum = out.reduce((s, x) => s + x.distance, 0);
  const delta = total - sum;
  if (delta !== 0 && out.length > 0) {
    const last = out[out.length - 1];
    last.distance = Math.max(25, last.distance + delta);
  }

  return out;
}
