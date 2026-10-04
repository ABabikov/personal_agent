import { chatCompletion } from "@/lib/agent/llm/openrouter";
import { hasLlmApiKey } from "@/lib/agent/llm/models";
import { interestHint } from "@/lib/features/nearby/defaults";
import type { NearbyCandidate, ScoredNearbyEvent } from "@/lib/features/nearby/types";
import { dateInsideWindow } from "@/lib/features/nearby/window";

const RANK_SYSTEM = `Ты делаешь выжимку городской афиши. Ответь только JSON без пояснений.
Формат: {"digest":"string","picks":[{"key":"e1","score":80,"why":"string","startsOn":"YYYY-MM-DD"}]}
Оставь события, на которые в этом городе реально можно прийти в указанном окне: спектакли, домашние матчи хоккея и волейбола, выставки, концерты, фестивали, разовые выезды вроде прыжков с верёвки, аэротрубы и верёвочного парка, плюс личные интересы (плавание, гонки).
Личный интерес усиливает событие, но не выкидывай остальную афишу.
Выкинь выездные матчи, детские старты без взрослой категории, новости «уже прошло», энциклопедии и подборки без даты и места.
Если кандидатов хватает, оставь 10–16 событий, не сжимай список до двух-трёх.
why — одна короткая фраза по-русски. Без эмодзи.
digest — выжимка по темам (сцена, спорт, выставки), с датами. Только события из picks. Без эмодзи.
startsOn — дата из текста или null. score — целое 0–100.`;

export type RankResult = {
  digest: string;
  picks: ScoredNearbyEvent[];
  rankedByModel: boolean;
};

export async function rankNearbyCandidates(input: {
  cityLabel: string;
  today: string;
  until: string;
  interests: { label: string; terms: string[] }[];
  candidates: NearbyCandidate[];
}): Promise<RankResult> {
  const tagged = input.candidates.map((candidate, index) => ({
    candidate,
    key: `e${index + 1}`,
  }));
  if (tagged.length === 0) {
    return {
      digest: `В ${input.cityLabel} на ближайшие недели по твоим интересам ничего не нашлось.`,
      picks: [],
      rankedByModel: false,
    };
  }

  if (hasLlmApiKey()) {
    try {
      const completion = await chatCompletion({
        messages: [
          { role: "system", content: RANK_SYSTEM },
          { role: "user", content: rankPrompt(input, tagged) },
        ],
        temperature: 0.2,
        maxTokens: 1400,
      });
      const parsed = parseRank(completion.content ?? "");
      if (parsed) {
        return {
          digest: clip(parsed.digest, 1800) || fallbackDigest(input.cityLabel, []),
          picks: parsed.picks
            .map((pick) => toScored(pick, tagged, input.today, input.until))
            .filter((pick): pick is ScoredNearbyEvent => pick != null)
            .sort((a, b) => b.score - a.score)
            .slice(0, 16),
          rankedByModel: true,
        };
      }
    } catch (error) {
      console.warn("[nearby] rank failed", error instanceof Error ? error.message : error);
    }
  }

  const picks = heuristicPicks(tagged, input.interests);
  return {
    digest: fallbackDigest(input.cityLabel, picks),
    picks,
    rankedByModel: false,
  };
}

function rankPrompt(
  input: { cityLabel: string; today: string; until: string; interests: { label: string }[] },
  tagged: { candidate: NearbyCandidate; key: string }[]
): string {
  const interests = input.interests
    .map((interest) => `- ${interest.label}: ${interestHint(interest.label)}`)
    .join("\n");
  const lines = tagged.map(({ key, candidate }) => {
    const when = candidate.startsOn ?? "дата не указана";
    const place = candidate.place ? ` | ${candidate.place}` : "";
    return `${key} | ${candidate.source} | ${when}${place} | ${candidate.title} | ${candidate.snippet.slice(0, 280)}`;
  });
  return [
    `Город: ${input.cityLabel}`,
    `Окно: ${input.today} … ${input.until}`,
    "Интересы:",
    interests,
    "",
    "Кандидаты:",
    ...lines,
  ].join("\n");
}

type RawPick = { key?: unknown; score?: unknown; why?: unknown; startsOn?: unknown };

function parseRank(content: string): { digest: string; picks: RawPick[] } | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : content;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1)) as { digest?: unknown; picks?: unknown };
    if (!Array.isArray(json.picks)) return null;
    return {
      digest: typeof json.digest === "string" ? json.digest.trim() : "",
      picks: json.picks.filter((pick): pick is RawPick => !!pick && typeof pick === "object"),
    };
  } catch {
    return null;
  }
}

function toScored(
  pick: RawPick,
  tagged: { candidate: NearbyCandidate; key: string }[],
  today: string,
  until: string
): ScoredNearbyEvent | null {
  if (typeof pick.key !== "string") return null;
  const found = tagged.find((item) => item.key === pick.key);
  if (!found) return null;
  const score = typeof pick.score === "number" ? pick.score : Number(pick.score);
  if (!Number.isFinite(score) || score < 50) return null;
  const why = clip(typeof pick.why === "string" ? pick.why : "", 220);
  if (!why) return null;
  const modelDate = dateInsideWindow(typeof pick.startsOn === "string" ? pick.startsOn : null, today, until);
  return {
    candidate: found.candidate,
    score: Math.max(0, Math.min(100, Math.round(score))),
    why,
    startsOn: modelDate ?? found.candidate.startsOn,
  };
}

function heuristicPicks(
  tagged: { candidate: NearbyCandidate; key: string }[],
  interests: { label: string; terms: string[] }[]
): ScoredNearbyEvent[] {
  const termsByLabel = new Map(interests.map((interest) => [interest.label, interest.terms]));
  const matched = tagged.filter(({ candidate }) => {
    const hay = `${candidate.title} ${candidate.snippet}`.toLowerCase();
    const terms = termsByLabel.get(candidate.interestLabel) ?? [];
    return terms.some((term) => hay.includes(term));
  });
  const ordered = [
    ...matched.filter((item) => item.candidate.startsOn),
    ...matched.filter((item) => !item.candidate.startsOn),
  ];
  return ordered.slice(0, 8).map(({ candidate }) => ({
    candidate,
    score: candidate.startsOn ? 60 : 52,
    why: `Совпадает с интересом «${candidate.interestLabel}».`,
    startsOn: candidate.startsOn,
  }));
}

function fallbackDigest(cityLabel: string, picks: ScoredNearbyEvent[]): string {
  if (picks.length === 0) {
    return `В ${cityLabel} на ближайшие недели по твоим интересам ничего подходящего не нашлось.`;
  }
  const titles = picks
    .slice(0, 3)
    .map((pick) => pick.candidate.title)
    .join("; ");
  return `Разобрал без модели и оставил прямые совпадения: ${titles}.`;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
