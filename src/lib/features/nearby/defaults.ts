export const DEFAULT_INTEREST_LABELS = [
  "плавание",
  "гонка героев",
  "уличное кино",
  "фестивали",
] as const;

/** Всегда ищем городскую афишу, не только личные хобби. */
export const AFISHA_LANES = [
  { label: "спектакли", phrase: "афиша спектакли театр" },
  { label: "хоккей", phrase: "хоккей расписание домашние матчи" },
  { label: "волейбол", phrase: "волейбол расписание домашние матчи" },
  { label: "выставки", phrase: "выставки музеи афиша" },
  { label: "концерты", phrase: "концерты фестивали афиша" },
  { label: "экстрим", phrase: "роупджампинг прыжки с веревки аэротруба веревочный парк" },
] as const;

const SEARCH_PHRASE: Record<string, string> = {
  плавание: "соревнования по плаванию",
  "гонка героев": "гонка героев",
  "уличное кино": "фестиваль уличного кино",
  фестивали: "городской фестиваль",
};

const EXTRA_TERMS: Record<string, string[]> = {
  плавание: ["плаван", "заплыв"],
  "гонка героев": ["гонка героев", "препятств"],
  "уличное кино": ["уличн", "кинопоказ"],
  фестивали: ["фестивал"],
};

export const INTEREST_HINTS: Record<string, string> = {
  плавание: "старты, соревнования, открытая вода, занятие в бассейне. Не океанариум и не спектакль про море.",
  "гонка героев": "забег, гонка, полоса препятствий. Не компьютерные игры и не киберспорт.",
  "уличное кино": "кинопоказ на улице или фестиваль уличного кино.",
  фестивали: "городской фестиваль, на который можно прийти в эти даты.",
};

export function normalizeInterestLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchPhrase(label: string): string {
  const key = normalizeInterestLabel(label);
  return SEARCH_PHRASE[key] ?? key;
}

export function interestTerms(label: string): string[] {
  const key = normalizeInterestLabel(label);
  const words = key.split(/\s+/).filter((word) => word.length >= 4);
  return [...new Set([...(EXTRA_TERMS[key] ?? []), ...words, key])];
}

export function interestHint(label: string): string {
  const key = normalizeInterestLabel(label);
  return INTEREST_HINTS[key] ?? `конкретные события по теме «${key}».`;
}
