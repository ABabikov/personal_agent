import { chatCompletion } from "@/lib/agent/llm/openrouter";
import { hasLlmApiKey } from "@/lib/agent/llm/models";
import { isCatalogTitle } from "@/lib/features/nearby/collect";
import { interestHint } from "@/lib/features/nearby/defaults";
import type { NearbyCandidate, ScoredNearbyEvent } from "@/lib/features/nearby/types";
import { dateInsideWindow } from "@/lib/features/nearby/window";

const RANK_SYSTEM = `Ты пишешь выжимку конкретных событий, на которые можно прийти в этом городе.
Ответь только JSON без пояснений.
Формат: {"digest":"string","picks":[{"key":"e1","title":"string","score":80,"why":"string","place":"string или null","startsOn":"YYYY-MM-DD или null"}]}
Каждый pick — одно событие: спектакль, домашний матч с соперником, выставка, концерт, фестиваль, старт, прыжки.
Страница «афиша», «календарь», «расписание», «купить билеты», «на выбор» — не событие. Если в тексте страницы названо конкретное событие, возьми его имя в title, а ссылку оставь как место, где читать подробности.
title — короткое имя события, не заголовок поисковой выдачи.
why — два предложения: что это, где и когда. Не пиши «совпадает с интересом» и не называй сайт.
place — площадка из текста или null.
Выкинь выездные матчи, детские старты без взрослой категории и то, что уже прошло.
Оставь до 12 событий. score — целое 0–100.
digest — те же события связным текстом: дата, имя и суть. Не своди тему к одной дате без имени события. Без эмодзи.`;

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
        maxTokens: 2200,
      });
      const parsed = parseRank(completion.content ?? "");
      if (parsed) {
        return {
          digest: clip(parsed.digest, 1800) || fallbackDigest(input.cityLabel, []),
          picks: parsed.picks
            .map((pick) => toScored(pick, tagged, input.today, input.until))
            .filter((pick): pick is ScoredNearbyEvent => pick != null)
            .sort((a, b) => b.score - a.score)
            .slice(0, 12),
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
    return `${key} | ${candidate.source} | ${when}${place} | ${candidate.title} | ${candidate.snippet.slice(0, 420)}`;
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

type RawPick = {
  key?: unknown;
  title?: unknown;
  score?: unknown;
  why?: unknown;
  place?: unknown;
  startsOn?: unknown;
};

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
  const title = clip(typeof pick.title === "string" ? pick.title : "", 140) || found.candidate.title;
  if (!title || isCatalogTitle(title)) return null;
  const why = clip(typeof pick.why === "string" ? pick.why : "", 420);
  if (why.length < 40 || /совпадает с интересом/i.test(why)) return null;
  const modelPlace = typeof pick.place === "string" ? clip(pick.place, 120) : "";
  const modelDate = dateInsideWindow(typeof pick.startsOn === "string" ? pick.startsOn : null, today, until);
  return {
    candidate: found.candidate,
    score: Math.max(0, Math.min(100, Math.round(score))),
    why,
    startsOn: modelDate ?? found.candidate.startsOn,
    title,
    place: modelPlace || found.candidate.place,
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
  return ordered
    .filter(({ candidate }) => !isCatalogTitle(candidate.title) && candidate.snippet.length >= 40)
    .slice(0, 8)
    .map(({ candidate }) => ({
      candidate,
      score: candidate.startsOn ? 60 : 52,
      why: clip(candidate.snippet, 280),
      startsOn: candidate.startsOn,
      title: candidate.title,
      place: candidate.place,
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
