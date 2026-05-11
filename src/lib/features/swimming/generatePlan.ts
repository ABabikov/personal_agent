/**
 * Черновик тренировки в стиле «записок тренера»: горки, повторения, отдых, сокращения (вс/бр/сп).
 * Суммы по сериям совпадают с целевым объёмом (шаг 25 м).
 *
 * Принципы: не повторять подряд один и тот же шаблон; крупные связки раньше мелких повторов;
 * мелкий остаток метража — добором к предыдущему блоку, а не отдельной «левой» серией.
 */

import { roundSwimMeters } from "./distance";

export type SwimPlanSeries = { distance: number; description: string };

function detectKind(focusRaw: string): "sprint" | "technique" | "endurance" | "mixed" {
  const f = focusRaw.toLowerCase();
  if (/спринт|скорост|интервал|рывок|50\s*м|25\s*м/u.test(f)) return "sprint";
  if (/техник|дрилл|ладони|положен|колоб|ладош|упражнен/u.test(f)) return "technique";
  if (/вынос|длинн|аэроб|база|объём|объем|монотон/u.test(f)) return "endurance";
  return "mixed";
}

const PYRAMID_400 =
  "Горка 25–50–75–100–75–50–25 вс\n" +
  "через 25 м в дорожке (или старт по готовности — как у вас принято)";

const FOUR_300 =
  "4×300 вс\n" +
  "каждые 100 м можно чередовать стили: бр → сп → бр → вс на последнем отрезке";

const THREE_100_COMP =
  "3×100 вс\n" + "спокойно, разворот и выход с контролем";

const SIX_100 =
  "6×100 вс средним темпом\n" + "отдых 1:30–2:00 между отрезками";

/** Разные по ощущению блоки на 500 м — не копируем один и тот же текст подряд */
const VARIANT_500: readonly string[] = [
  "5×100 вс рабочий темп\nотдых 2:00 между сотнями",
  "10×50 вс: нечётные отрезки спокойнее, чётные чуть острее\nотдых ~45″–1:00",
  "4×125 вс ровный крейсер\nотдых 2:30",
  "20×25 вс: в каждой 25 м — стабильный ритм, последние 5 м без провала\nотдых 25″–35″",
  "5×100 вс: каждая сотня — 50 м на спине + 50 м вольным\nотдых 2:00",
  "10×50 вс «по парам» — 2×50 подряд, между парами отдых 1:15\nвнутри пары отдых минимальный",
  "5×100 вс с нарастающим темпом: каждая следующая сотня не медленнее предыдущей\nотдых 2:00",
];

const ENDURANCE_800_VARIANTS: readonly string[] = [
  "800 вс одним отрезком или 2×400 вс ровным темпом\nмонотонно, без провала техники",
  "800 вс стабильным крейсером\nконтроль дыхания и положения на воде",
  "4×200 вс ровно и одинаково по всем двухсоткам\nотдых 2:30–3:00",
];

const SPRINT_300_VARIANTS: readonly string[] = [
  "6×50 вс быстро\nотдых 1:00–1:15 между отрезками",
  "12×25 вс с упором на старт с бортика и первые циклы\nотдых 30″–40″",
  "3×100 вс быстрый темп\nотдых 3:00–4:00",
];

const TECH_300_VARIANTS: readonly string[] = [
  "Короткие 25–50 м: ладони, скольжение, положение тела\nостаток блока — спокойный вс с тем же контролем",
  "50 м на одной руке / смена рук по длине дорожки\nостальное метража — техничный вс",
  "25 м дрилл + 25 м полноценный вс — чередуй циклами до конца блока",
];

/** Собирает строки разминки с суммой distance = m */
function buildWarmupLines(m: number): string {
  const lines: string[] = [];
  let left = m;
  const head: [number, string][] = [
    [100, "100 вс закуп"],
    [100, "100 бр легко"],
    [100, "100 сп легко"],
  ];
  for (const [len, label] of head) {
    if (left >= len) {
      lines.push(label);
      left -= len;
    }
  }
  while (left >= 100) {
    lines.push("100 вс — наращивание темпа");
    left -= 100;
  }
  if (left >= 50) {
    lines.push(`${left} вс / смешанный — добить закуп`);
    left = 0;
  } else if (left >= 25) {
    lines.push(`${left} добить закуп тем стилем, что удобнее`);
  }
  return lines.join("\n");
}

function buildCooldownLines(m: number): string {
  const lines: string[] = [];
  let left = m;
  if (left >= 100) {
    lines.push("100 вс откуп");
    left -= 100;
  }
  while (left >= 50) {
    const x = Math.min(100, left);
    lines.push(`${x} сп/вс очень легко`);
    left -= x;
  }
  if (left >= 25) {
    lines.push(`${left} добить откуп совсем легко`);
  }
  return lines.join("\n");
}

/** Приклеить мелкий остаток метража к последнему блоку (чтобы не было «отдельных 50 м») */
function mergeSmallRemainder(blocks: SwimPlanSeries[], remainder: number, threshold = 100): void {
  if (remainder < 25 || remainder >= threshold || blocks.length === 0) return;
  const last = blocks[blocks.length - 1];
  last.distance += remainder;
  last.description +=
    `\n\n+ добор ${remainder} м сразу тем же режимом без паузы между «сериями» (общий метраж блока уже учитывает добор)`;
}

function allocateMixedMain(main: number): SwimPlanSeries[] {
  const out: SwimPlanSeries[] = [];
  let rem = main;

  if (rem >= 400) {
    out.push({ distance: 400, description: PYRAMID_400 });
    rem -= 400;
  }

  while (rem >= 1200) {
    out.push({ distance: 1200, description: FOUR_300 });
    rem -= 1200;
  }

  if (rem >= 600) {
    out.push({ distance: 600, description: SIX_100 });
    rem -= 600;
  }

  let rot500 = 0;
  while (rem >= 500) {
    out.push({
      distance: 500,
      description: VARIANT_500[rot500 % VARIANT_500.length] ?? VARIANT_500[0],
    });
    rot500++;
    rem -= 500;
  }

  if (rem >= 300) {
    out.push({ distance: 300, description: THREE_100_COMP });
    rem -= 300;
  }

  if (rem >= 100) {
    out.push({
      distance: rem,
      description:
        `Спокойный крейсерный отрезок ${rem} м (вс/сп по ощущениям), без лишних остановок на стенке`,
    });
  } else if (rem >= 25) {
    if (out.length > 0) {
      mergeSmallRemainder(out, rem, 100);
    } else {
      out.push({
        distance: rem,
        description: `Лёгкий отрезок ${rem} м вс под доступный объём — можно совместить с закупом мысленно как продолжение`,
      });
    }
  }

  return out;
}

function allocateMainBlocks(main: number, kind: ReturnType<typeof detectKind>): SwimPlanSeries[] {
  const out: SwimPlanSeries[] = [];
  let r = main;

  if (kind === "technique") {
    let ti = 0;
    while (r >= 300) {
      out.push({
        distance: 300,
        description: TECH_300_VARIANTS[ti % TECH_300_VARIANTS.length] ?? TECH_300_VARIANTS[0],
      });
      ti++;
      r -= 300;
    }
    if (r >= 100) {
      out.push({
        distance: r,
        description: `${r} м — короткие дриллы 25–50 + очень лёгкий вс`,
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: `${r} м техника 25 м / очень лёгкий вс`,
        });
      }
    }
    return out;
  }

  if (kind === "sprint") {
    let si = 0;
    while (r >= 300) {
      out.push({
        distance: 300,
        description: SPRINT_300_VARIANTS[si % SPRINT_300_VARIANTS.length] ?? SPRINT_300_VARIANTS[0],
      });
      si++;
      r -= 300;
    }
    if (r >= 100) {
      out.push({
        distance: r,
        description: `Интервалы на ${r} м: 50 или 25 м быстрый вс — отдых не короче работы`,
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: `${r} м короткие быстрые отрезки`,
        });
      }
    }
    return out;
  }

  if (kind === "endurance") {
    let ei = 0;
    while (r >= 800) {
      out.push({
        distance: 800,
        description: ENDURANCE_800_VARIANTS[ei % ENDURANCE_800_VARIANTS.length] ?? ENDURANCE_800_VARIANTS[0],
      });
      ei++;
      r -= 800;
    }
    if (r >= 400) {
      out.push({
        distance: 400,
        description: "400 вс ровным крейсерским — последние метры держать технику",
      });
      r -= 400;
    }
    if (r >= 100) {
      out.push({
        distance: r,
        description: `${r} м добить базу вс/сп спокойно и монотонно`,
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: `${r} м лёгкая база вс/сп`,
        });
      }
    }
    return out;
  }

  return allocateMixedMain(main);
}

export function generateSwimWorkoutPlan(
  totalMeters: number,
  focusRaw: string
): SwimPlanSeries[] {
  const raw = Number(totalMeters);
  if (!Number.isFinite(raw) || raw < 200) {
    return [
      {
        distance: 200,
        description: "200 вс спокойно\nподстрой объём и задание вручную",
      },
    ];
  }

  const total = roundSwimMeters(Math.min(12000, raw));
  const kind = detectKind(focusRaw.trim() || "смешанная");

  let warmPct = 0.14;
  let coolPct = 0.08;
  if (kind === "sprint") {
    warmPct = 0.18;
    coolPct = 0.1;
  } else if (kind === "technique") {
    warmPct = 0.2;
    coolPct = 0.08;
  }

  let warm = roundSwimMeters(total * warmPct);
  let cool = roundSwimMeters(total * coolPct);
  let main = total - warm - cool;
  if (main < 200) {
    main += warm - 100;
    warm = 100;
  }

  const out: SwimPlanSeries[] = [];

  out.push({
    distance: warm,
    description: buildWarmupLines(warm),
  });

  const mainBlocks = allocateMainBlocks(main, kind);
  let mainSum = mainBlocks.reduce((s, b) => s + b.distance, 0);
  const drift = main - mainSum;
  if (drift !== 0 && mainBlocks.length > 0) {
    const last = mainBlocks[mainBlocks.length - 1];
    last.distance = Math.max(25, last.distance + drift);
  }

  out.push(...mainBlocks);

  out.push({
    distance: cool,
    description: buildCooldownLines(cool),
  });

  let sum = out.reduce((s, x) => s + x.distance, 0);
  if (sum !== total && out.length > 0) {
    const delta = total - sum;
    out[out.length - 1] = {
      ...out[out.length - 1],
      distance: Math.max(25, out[out.length - 1].distance + delta),
    };
  }

  return out;
}
