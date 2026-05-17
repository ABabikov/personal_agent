import { roundSwimMeters } from "./distance";

/** Строки про остаток / добор / правку после склейки фаз — пересчитываются или убираются. */
export function isRemainderDescriptionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /остаток|оставш|добор|убери\s+~?\d+|^\+\d+\s*м\b|^\−\d+\s*м\b/i.test(t);
}

/** Подсказка «если блок длиннее номинала» — оставляем на номинальном метраже. */
export function isExtensionHintLine(line: string): boolean {
  return /при большем/i.test(line.trim());
}

export function isVariableDescriptionLine(line: string): boolean {
  return isRemainderDescriptionLine(line) || isExtensionHintLine(line);
}

/** Метражи из начала строк («150 сп легко», «100 м вс»). */
export function parseFixedSegmentDistances(description: string): number[] {
  const out: number[] = [];
  for (const raw of description.split(/\n/)) {
    const t = raw.trim();
    if (!t || isVariableDescriptionLine(t)) continue;
    const m =
      t.match(/^(\d+)\s*(?:м\b)?(?:\s|$)/i) ??
      t.match(/^(\d+)\s+(?:вс|сп|бр|бат|кр|плав|ноги)\b/i);
    if (!m) continue;
    const d = parseInt(m[1]!, 10);
    if (d >= 25 && d % 25 === 0) out.push(d);
  }
  return out;
}

function replaceLeadingDistance(line: string, meters: number): string {
  const t = line.trim();
  const rest = t.replace(/^(\d+)\s*(?:м\s*)?/i, "").trim();
  return rest ? `${meters} ${rest}` : `${meters} м`;
}

/**
 * Подгоняет текст блока под фактический метраж серии: пересчитывает «150+150+остаток»
 * и убирает/обновляет строки про остаток и «при большем метраже».
 */
export function adaptSwimSeriesDescription(
  bodyText: string,
  targetM: number,
  nominalM?: number
): string {
  if (!Number.isFinite(targetM) || targetM < 25) return bodyText;

  const lines = bodyText.split(/\n/);
  const fixed = parseFixedSegmentDistances(bodyText);
  if (fixed.length === 0) return bodyText;

  const nominal =
    nominalM && nominalM >= 25
      ? nominalM
      : fixed.reduce((a, b) => a + b, 0);
  const lap0 = fixed[0]!;
  const uniform = fixed.every((d) => d === lap0);
  if (!uniform) return bodyText;

  const n = fixed.length;
  let newLap = roundSwimMeters(targetM / n);
  let newFixedSum = newLap * n;
  if (newFixedSum !== targetM) {
    const delta = targetM - newFixedSum;
    if (Math.abs(delta) < 25 && n > 1) {
      newLap = roundSwimMeters((targetM - delta) / n);
      newFixedSum = newLap * n;
    }
  }

  const remainderM = targetM - newFixedSum;
  let fixIdx = 0;
  const out: string[] = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (isRemainderDescriptionLine(t)) continue;
    if (isExtensionHintLine(t)) {
      if (targetM <= nominal && remainderM < 25) out.push(t);
      continue;
    }

    const hasLead =
      /^(\d+)\s*(?:м\b)?(?:\s|$)/i.test(t) ||
      /^(\d+)\s+(?:вс|сп|бр|бат|кр|плав|ноги)\b/i.test(t);
    if (hasLead && fixIdx < n) {
      fixIdx++;
      out.push(replaceLeadingDistance(t, newLap));
      continue;
    }
    out.push(raw.trim());
  }

  if (remainderM >= 25) {
    out.push(
      `${remainderM} м — остаток блока, спокойный вс/сп с контролем техники`
    );
  } else if (targetM > nominal) {
    const extra = targetM - newFixedSum;
    if (extra >= 50) {
      out.push(
        `${extra} м — сп/вс чередованием в лёгком темпе до конца блока`
      );
    }
  }

  return out.join("\n").trim();
}
