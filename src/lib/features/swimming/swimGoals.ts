export type SwimGoalCode =
  | "technique"
  | "speed"
  | "aerobic"
  | "mixed"
  | "recovery";

export const SWIM_GOALS: readonly {
  code: SwimGoalCode;
  name: string;
  description: string;
}[] = [
  {
    code: "mixed",
    name: "Смешанная",
    description: "Баланс объёма, темпа и техники",
  },
  {
    code: "technique",
    name: "Техника",
    description: "Дриллы, положение, чистота гребка",
  },
  {
    code: "aerobic",
    name: "Аэробика",
    description: "База и монотонные объёмы",
  },
  {
    code: "speed",
    name: "Скорость",
    description: "Интервалы и короткие отрезки",
  },
  {
    code: "recovery",
    name: "Восстановление",
    description: "Лёгкая нагрузка и контроль самочувствия",
  },
] as const;

export function phasePercentsForGoal(goal: SwimGoalCode): {
  warmPct: number;
  coolPct: number;
} {
  switch (goal) {
    case "speed":
      return { warmPct: 0.18, coolPct: 0.1 };
    case "technique":
      return { warmPct: 0.2, coolPct: 0.08 };
    case "recovery":
      return { warmPct: 0.22, coolPct: 0.12 };
    case "aerobic":
      return { warmPct: 0.14, coolPct: 0.08 };
    default:
      return { warmPct: 0.14, coolPct: 0.08 };
  }
}

export function swimGoalLabel(code: SwimGoalCode): string {
  const g = SWIM_GOALS.find((x) => x.code === code);
  return g?.name ?? code;
}

/** Одна или две цели без дубликатов, минимум одна запись. */
export function normalizeGoalSelection(codes: SwimGoalCode[]): SwimGoalCode[] {
  const seen = new Set<SwimGoalCode>();
  const out: SwimGoalCode[] = [];
  for (const c of codes) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= 2) break;
  }
  return out.length > 0 ? out : ["mixed"];
}

export function formatGoalsLabel(goals: SwimGoalCode[]): string {
  return goals.map(swimGoalLabel).join(" + ");
}

/** Доли фаз: при двух целях — среднее двух профилей (как компромисс нагрузки). */
export function phasePercentsForGoals(goals: SwimGoalCode[]): {
  warmPct: number;
  coolPct: number;
} {
  const g = normalizeGoalSelection(goals);
  if (g.length === 1) return phasePercentsForGoal(g[0]);
  const parts = g.map(phasePercentsForGoal);
  return {
    warmPct: parts.reduce((s, p) => s + p.warmPct, 0) / parts.length,
    coolPct: parts.reduce((s, p) => s + p.coolPct, 0) / parts.length,
  };
}
