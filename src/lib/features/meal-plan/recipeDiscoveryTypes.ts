/** Источники рецептов в сети, предпочтения поиска и история открытий — для анти-повторов. */

export type RecipeSource = {
  id: string;
  /** Короткое имя в UI */
  label: string;
  /** Только hostname, без пути (eda.ru) */
  host: string;
  enabled: boolean;
};

export type RecipeSearchPreferences = {
  /** Свободный текст: диеты, любимое/нелюбимое, острота и т.д. */
  notes: string;
  /** 0 — стабильнее формулировки, 1 — сильнее «размешивать» запрос (меньше зацикливания в выдаче) */
  novelty: number;
  /** Сколько последних записей истории исключать при следующем поиске (по URL) */
  excludeRecent: number;
};

export type RecipeHistoryEntry = {
  id: string;
  url: string;
  title: string;
  host: string;
  at: string;
  /** Попадание в выдачу поиска или отметка пользователя */
  kind: "search_hit" | "user_marked";
};

export type RecipeDiscoveryState = {
  sources: RecipeSource[];
  preferences: RecipeSearchPreferences;
  history: RecipeHistoryEntry[];
};

/** Уходит в POST /api/chat и в тулы — без полной истории. */
export type RecipeDiscoveryForAgent = {
  sources: RecipeSource[];
  preferences: RecipeSearchPreferences;
  historyRecent: { url: string; title: string; at: string; host: string }[];
};

export const STORAGE_RECIPE_SOURCES = "meal-plan:recipe-sources";
export const STORAGE_RECIPE_PREFS = "meal-plan:recipe-search-prefs";
export const STORAGE_RECIPE_HISTORY = "meal-plan:recipe-search-history";

export const MAX_RECIPE_SOURCES = 24;
export const MAX_HISTORY_ENTRIES = 200;
export const HISTORY_TAIL_AGENT = 25;

export const DEFAULT_RECIPE_SEARCH_PREFERENCES: RecipeSearchPreferences = {
  notes: "",
  novelty: 0.45,
  excludeRecent: 24,
};

/** Стартовые источники (hostname); пользователь может выключить, удалить, добавить свои. */
export const DEFAULT_RECIPE_SOURCES: RecipeSource[] = [
  { id: "eda", label: "Еда.ру", host: "eda.ru", enabled: true },
  { id: "food", label: "Food.ru", host: "food.ru", enabled: true },
  { id: "povarenok", label: "Поварёнок", host: "povarenok.ru", enabled: true },
  { id: "gastronom", label: "Гастроном", host: "gastronom.ru", enabled: true },
  { id: "say7", label: "Сайт 7", host: "say7.info", enabled: true },
  { id: "russianfood", label: "RussianFood.com", host: "russianfood.com", enabled: false },
];
