/**
 * Методика сборки черновиков плавания (для алгоритма и для текстового контекста в UI/агенте).
 * Опираемся на классическую структуру сессии: разминка → основная часть → заминка.
 */

import type { SwimMediumGoals } from "./swimMediumGoalsStorage";

/** Кратко для подсказки чату / подписи к сгенерированному плану */
export const SWIM_GENERATION_COACH_PROMPT_BLOCK = [
  "Ты составляешь план тренировки в бассейне на русском.",
  "Структура: разминка (постепенный разгон, смена стилей, без жёсткого темпа) → основная часть (ядро задачи дня) → заминка (снижение интенсивности, техника «на откате»).",
  "Указывай дистанции кратно 25 м, стили сокращённо: вс, бр, сп, кр; отдых в секундах (″) или мин:сек.",
  "Для техники — чередуй короткие отрезки 25–50 м с дриллами и «чистым» плаванием; для скорости — не удлиняй работу без восстановления; для базы — длиннее непрерывные отрезки или ровные серии с умеренным отдыхом.",
  "Если у спортсмена есть снаряжение (доска, ласты, лопаты, колобашка, трубка) — вплетай его в основную часть осмысленно, а не в каждую строку.",
  "Сумма дистанций по блокам должна совпадать с заявленным целевым метражом.",
].join("\n");

export type SwimVolumeBias = "neutral" | "add_base" | "trim_fatigue";

/** Сравнение со средним за 4 недели и целью м/нед → лёгкая подстройка объёма черновика */
export function suggestVolumeBias(
  targetWeeklyM: number,
  avgWeeklyM: number | null
): SwimVolumeBias {
  if (avgWeeklyM == null || targetWeeklyM <= 0) return "neutral";
  const ratio = avgWeeklyM / targetWeeklyM;
  if (ratio < 0.82) return "add_base";
  if (ratio > 1.18) return "trim_fatigue";
  return "neutral";
}

export function adjustTargetVolumeForBias(
  volumeM: number,
  bias: SwimVolumeBias
): number {
  const v = Math.round(volumeM);
  if (bias === "add_base") return Math.min(12000, Math.round(v * 1.06));
  if (bias === "trim_fatigue") return Math.max(200, Math.round(v * 0.94));
  return v;
}

export function formatMediumPlanForCoachNote(
  goals: SwimMediumGoals,
  avgWeeklyM: number | null
): string {
  const parts: string[] = [
    `Среднесрочный ориентир: ${goals.weeklyTargetM.toLocaleString("ru")} м/нед, горизонт ${goals.horizonWeeks} нед.`,
  ];
  if (goals.goalNote.trim()) {
    parts.push(`Формулировка цели: ${goals.goalNote.trim()}`);
  }
  if (avgWeeklyM != null) {
    parts.push(
      `Факт за последние 4 недели в среднем: ${avgWeeklyM.toLocaleString("ru")} м/нед.`
    );
    const bias = suggestVolumeBias(goals.weeklyTargetM, avgWeeklyM);
    if (bias === "add_base") {
      parts.push(
        "Темп ниже цели — в основной части чуть больше монотонной базы и ровного крейсера, без лишних рывков."
      );
    } else if (bias === "trim_fatigue") {
      parts.push(
        "Темп выше цели — умеренный объём, проще заминка; без новых пиковых блоков."
      );
    }
  }
  return parts.join(" ");
}
