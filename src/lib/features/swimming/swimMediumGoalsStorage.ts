/** Локальные среднесрочные цели по плаванию (как в карточке на странице). */

export const SWIM_MEDIUM_GOALS_STORAGE_KEY =
  "personal_agent_swim_medium_goals_v1";

export type SwimMediumGoals = {
  weeklyTargetM: number;
  horizonWeeks: number;
  goalNote: string;
};

export const DEFAULT_SWIM_MEDIUM_GOALS: SwimMediumGoals = {
  weeklyTargetM: 4000,
  horizonWeeks: 8,
  goalNote: "",
};

export function loadSwimMediumGoals(): SwimMediumGoals {
  if (typeof window === "undefined") return DEFAULT_SWIM_MEDIUM_GOALS;
  try {
    const raw = window.localStorage.getItem(SWIM_MEDIUM_GOALS_STORAGE_KEY);
    if (!raw) return DEFAULT_SWIM_MEDIUM_GOALS;
    const p = JSON.parse(raw) as Partial<SwimMediumGoals>;
    return {
      weeklyTargetM:
        typeof p.weeklyTargetM === "number" && p.weeklyTargetM > 0
          ? Math.round(p.weeklyTargetM)
          : DEFAULT_SWIM_MEDIUM_GOALS.weeklyTargetM,
      horizonWeeks:
        typeof p.horizonWeeks === "number" && p.horizonWeeks >= 1
          ? Math.min(52, Math.round(p.horizonWeeks))
          : DEFAULT_SWIM_MEDIUM_GOALS.horizonWeeks,
      goalNote: typeof p.goalNote === "string" ? p.goalNote : "",
    };
  } catch {
    return DEFAULT_SWIM_MEDIUM_GOALS;
  }
}

export function persistSwimMediumGoals(goals: SwimMediumGoals): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SWIM_MEDIUM_GOALS_STORAGE_KEY,
    JSON.stringify(goals)
  );
}
