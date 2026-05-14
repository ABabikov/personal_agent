/**
 * Черновик тренировки в стиле «записок тренера»: горки, повторения, отдых, сокращения (вс/бр/сп).
 * Суммы по сериям совпадают с целевым объёмом (шаг 25 м).
 *
 * Методика (текст для агента — `SWIM_GENERATION_COACH_PROMPT_BLOCK` в swimGenerationMethodology.ts):
 * — фазы: разминка → основная часть → заминка; доли фаз зависят от типа сессии;
 * — не повторять подряд один и тот же шаблон в смешанном режиме;
 * — крупные связки раньше мелких повторов;
 * — мелкий остаток метража — добором к предыдущему блоку;
 * — при переданном инвентаре — короткая подсказка по осмысленному использованию снаряжения в основной части.
 */

import { roundSwimMeters } from "./distance";
import { swimEquipmentLabel } from "./swimEquipment";

export type SwimPlanSeries = { distance: number; description: string };

export type SwimPlanGenerationOptions = {
  /** Сжатая справка по среднесрочному плану — врезается в первый блок (разминка) */
  mediumPlanCoachNote?: string;
  /** id снаряжения из профиля — подсказки в описаниях основной части */
  inventoryIds?: string[];
};

function detectKind(
  focusRaw: string
): "sprint" | "technique" | "endurance" | "recovery" | "mixed" {
  const f = focusRaw.toLowerCase();
  if (/восстанов|лёгк|легк|recovery|easy|щадящ|отдыхн/u.test(f))
    return "recovery";
  if (/спринт|скорост|интервал|рывок|50\s*м|25\s*м/u.test(f)) return "sprint";
  if (/техник|дрилл|ладони|положен|колоб|ладош|упражнен/u.test(f))
    return "technique";
  if (/вынос|длинн|аэроб|база|объём|объем|монотон/u.test(f))
    return "endurance";
  return "mixed";
}

function inventoryHintSuffix(ids: string[] | undefined): string {
  if (!ids?.length) return "";
  const labels = ids.map(swimEquipmentLabel);
  return `\n\nИнвентарь: ${labels.join(", ")} — выбери 1–2 предмета в этом блоке по смыслу (не перегружай каждый повтор).`;
}

function withGear(desc: string, ids: string[] | undefined): string {
  if (!ids?.length) return desc;
  return `${desc}${inventoryHintSuffix(ids)}`;
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
  "5×100: 50 доска ногами кр + 50 вс спокойно\nотдых 2:00 — чистая работа ног без провала корпуса",
  "10×50: чётные 25 м с лопатами + 25 вс, нечётные только вс технично\nотдых 50″–1:00",
  "4×125 вс с колобашкой: акцент на ротацию корпуса и длину гребка\nотдых 2:30",
  "8×50 вс + ласты: умеренное усилие, не «рваный» спринт\nотдых 1:00",
  "5×100: 25 трубка на баланс + 75 вс ровно\nотдых 2:15",
  "20×25: смена стилей по 4 отрезка (вс/сп/бр/кр) кругами\nотдых 20″–30″",
  "4×125 вс negative split: вторая половина каждой чуть быстрее\nотдых 2:30",
];

const ENDURANCE_800_VARIANTS: readonly string[] = [
  "800 вс одним отрезком или 2×400 вс ровным темпом\nмонотонно, без провала техники",
  "800 вс стабильным крейсером\nконтроль дыхания и положения на воде",
  "4×200 вс ровно и одинаково по всем двухсоткам\nотдых 2:30–3:00",
  "2×400: первый отрезок спокойный крейсер, второй на 5–8 с быстрее на 100 м\nотдых 3:00 между четырёхсотками",
  "16×50 вс крейсер\nотдых 15″–20″ — ритм важнее скорости",
  "600 вс + 200 доска ногами кр очень ровно\nмонотонная база ног",
];

const SPRINT_300_VARIANTS: readonly string[] = [
  "6×50 вс быстро\nотдых 1:00–1:15 между отрезками",
  "12×25 вс с упором на старт с бортика и первые циклы\nотдых 30″–40″",
  "3×100 вс быстрый темп\nотдых 3:00–4:00",
  "8×50: 25 м ласты (вход в воду) + 25 вс мощно\nотдых 1:15",
  "16×25 вс: каждые 4 отрезка чуть быстрее (лесенка внутри блока)\nотдых 25″",
  "4×75 вс почти на максимум\nотдых 2:00–2:30",
];

const TECH_300_VARIANTS: readonly string[] = [
  "Короткие 25–50 м: ладони, скольжение, положение тела\nостаток блока — спокойный вс с тем же контролем",
  "50 м на одной руке / смена рук по длине дорожки\nостальное метража — техничный вс",
  "25 м дрилл + 25 м полноценный вс — чередуй циклами до конца блока",
  "12×25: трубка + лопаты — только руки, корпус стабилен\nочень лёгкий отдых",
  "6×50: антилопатки или «кулак» 25 м + 25 м чистый гребок\nотдых 1:00",
  "300 как 3×100: доска ногами кр — счёт ударов, потом 50 вс + 50 сп с длиной тела",
];

const RECOVERY_400_VARIANTS: readonly string[] = [
  "400 вс или 4×100 вс/сп вперемешку очень спокойно\nотдых по ощущениям, без гонки",
  "8×50 вс лёгкий крейсер\nотдых 20″–30″ — пульс не поднимать",
  "2×200 сп + 2×100 вс\nвсё в комфортной зоне разговора",
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
function mergeSmallRemainder(
  blocks: SwimPlanSeries[],
  remainder: number,
  threshold = 100
): void {
  if (remainder < 25 || remainder >= threshold || blocks.length === 0) return;
  const last = blocks[blocks.length - 1];
  last.distance += remainder;
  last.description +=
    `\n\n+ добор ${remainder} м сразу тем же режимом без паузы между «сериями» (общий метраж блока уже учитывает добор)`;
}

function allocateMixedMain(
  main: number,
  inventoryIds?: string[]
): SwimPlanSeries[] {
  const out: SwimPlanSeries[] = [];
  let rem = main;

  if (rem >= 400) {
    out.push({
      distance: 400,
      description: withGear(PYRAMID_400, inventoryIds),
    });
    rem -= 400;
  }

  while (rem >= 1200) {
    out.push({
      distance: 1200,
      description: withGear(FOUR_300, inventoryIds),
    });
    rem -= 1200;
  }

  if (rem >= 600) {
    out.push({
      distance: 600,
      description: withGear(SIX_100, inventoryIds),
    });
    rem -= 600;
  }

  let rot500 = 0;
  while (rem >= 500) {
    const raw =
      VARIANT_500[rot500 % VARIANT_500.length] ?? VARIANT_500[0] ?? "";
    out.push({
      distance: 500,
      description: withGear(raw, inventoryIds),
    });
    rot500++;
    rem -= 500;
  }

  if (rem >= 300) {
    out.push({
      distance: 300,
      description: withGear(THREE_100_COMP, inventoryIds),
    });
    rem -= 300;
  }

  if (rem >= 100) {
    out.push({
      distance: rem,
      description: withGear(
        `Спокойный крейсерный отрезок ${rem} м (вс/сп по ощущениям), без лишних остановок на стенке`,
        inventoryIds
      ),
    });
  } else if (rem >= 25) {
    if (out.length > 0) {
      mergeSmallRemainder(out, rem, 100);
    } else {
      out.push({
        distance: rem,
        description: withGear(
          `Лёгкий отрезок ${rem} м вс под доступный объём — можно совместить с закупом мысленно как продолжение`,
          inventoryIds
        ),
      });
    }
  }

  return out;
}

function allocateMainBlocks(
  main: number,
  kind: ReturnType<typeof detectKind>,
  inventoryIds?: string[]
): SwimPlanSeries[] {
  const out: SwimPlanSeries[] = [];
  let r = main;

  if (kind === "recovery") {
    let ri = 0;
    while (r >= 400) {
      out.push({
        distance: 400,
        description:
          RECOVERY_400_VARIANTS[ri % RECOVERY_400_VARIANTS.length] ??
          RECOVERY_400_VARIANTS[0],
      });
      ri++;
      r -= 400;
    }
    if (r >= 200) {
      out.push({
        distance: r,
        description: `${r} м очень спокойно вс/сп — без акцента на скорость`,
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: `${r} м совсем легко`,
        });
      }
    }
    return out;
  }

  if (kind === "technique") {
    let ti = 0;
    while (r >= 300) {
      const raw =
        TECH_300_VARIANTS[ti % TECH_300_VARIANTS.length] ?? TECH_300_VARIANTS[0];
      out.push({ distance: 300, description: withGear(raw, inventoryIds) });
      ti++;
      r -= 300;
    }
    if (r >= 100) {
      out.push({
        distance: r,
        description: withGear(
          `${r} м — короткие дриллы 25–50 + очень лёгкий вс`,
          inventoryIds
        ),
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: withGear(
            `${r} м техника 25 м / очень лёгкий вс`,
            inventoryIds
          ),
        });
      }
    }
    return out;
  }

  if (kind === "sprint") {
    let si = 0;
    while (r >= 300) {
      const raw =
        SPRINT_300_VARIANTS[si % SPRINT_300_VARIANTS.length] ??
        SPRINT_300_VARIANTS[0];
      out.push({ distance: 300, description: withGear(raw, inventoryIds) });
      si++;
      r -= 300;
    }
    if (r >= 100) {
      out.push({
        distance: r,
        description: withGear(
          `Интервалы на ${r} м: 50 или 25 м быстрый вс — отдых не короче работы`,
          inventoryIds
        ),
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: withGear(`${r} м короткие быстрые отрезки`, inventoryIds),
        });
      }
    }
    return out;
  }

  if (kind === "endurance") {
    let ei = 0;
    while (r >= 800) {
      const raw =
        ENDURANCE_800_VARIANTS[ei % ENDURANCE_800_VARIANTS.length] ??
        ENDURANCE_800_VARIANTS[0];
      out.push({ distance: 800, description: withGear(raw, inventoryIds) });
      ei++;
      r -= 800;
    }
    if (r >= 400) {
      out.push({
        distance: 400,
        description: withGear(
          "400 вс ровным крейсерским — последние метры держать технику",
          inventoryIds
        ),
      });
      r -= 400;
    }
    if (r >= 100) {
      out.push({
        distance: r,
        description: withGear(
          `${r} м добить базу вс/сп спокойно и монотонно`,
          inventoryIds
        ),
      });
    } else if (r >= 25) {
      if (out.length > 0) mergeSmallRemainder(out, r, 100);
      else {
        out.push({
          distance: r,
          description: withGear(`${r} м лёгкая база вс/сп`, inventoryIds),
        });
      }
    }
    return out;
  }

  return allocateMixedMain(main, inventoryIds);
}

export function generateSwimWorkoutPlan(
  totalMeters: number,
  focusRaw: string,
  options?: SwimPlanGenerationOptions
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
  const inv = options?.inventoryIds?.filter(Boolean);

  let warmPct = 0.14;
  let coolPct = 0.08;
  if (kind === "sprint") {
    warmPct = 0.18;
    coolPct = 0.1;
  } else if (kind === "technique") {
    warmPct = 0.2;
    coolPct = 0.08;
  } else if (kind === "recovery") {
    warmPct = 0.24;
    coolPct = 0.14;
  }

  let warm = roundSwimMeters(total * warmPct);
  let cool = roundSwimMeters(total * coolPct);
  let main = total - warm - cool;
  if (main < 200) {
    main += warm - 100;
    warm = 100;
  }

  const out: SwimPlanSeries[] = [];

  const warmBody = buildWarmupLines(warm);
  const warmDesc =
    options?.mediumPlanCoachNote?.trim() != null &&
    options.mediumPlanCoachNote!.trim() !== ""
      ? `Связка с планом: ${options.mediumPlanCoachNote!.trim()}\n\n${warmBody}`
      : warmBody;

  out.push({
    distance: warm,
    description: warmDesc,
  });

  const mainBlocks = allocateMainBlocks(main, kind, inv);
  const mainSum = mainBlocks.reduce((s, b) => s + b.distance, 0);
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
    const last = out[out.length - 1]!;
    out[out.length - 1] = {
      ...last,
      distance: Math.max(25, last.distance + delta),
    };
  }

  return out;
}
