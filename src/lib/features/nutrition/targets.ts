import {
  calculateBMR,
  calculateBMRKatchMcArdle,
  calculateTDEE,
} from "@/lib/features/workouts/calories";

export const DEFAULT_PROTEIN_G_PER_KG = 2.2;
export const DEFAULT_CARBS_G_PER_KG = 3.5;
export const DEFAULT_FAT_FLOOR_G_PER_KG = 0.5;
export const DEFAULT_DEFICIT_KCAL_MIN = 200;
export const DEFAULT_DEFICIT_KCAL_MAX = 400;

export type NutritionSettings = {
  proteinGPerKg: number;
  carbsGPerKg: number;
  fatFloorGPerKg: number;
  deficitKcalMin: number;
  deficitKcalMax: number;
  kcalOverride: number | null;
  proteinGOverride: number | null;
  carbsGOverride: number | null;
  fatGOverride: number | null;
};

export const DEFAULT_NUTRITION_SETTINGS: NutritionSettings = {
  proteinGPerKg: DEFAULT_PROTEIN_G_PER_KG,
  carbsGPerKg: DEFAULT_CARBS_G_PER_KG,
  fatFloorGPerKg: DEFAULT_FAT_FLOOR_G_PER_KG,
  deficitKcalMin: DEFAULT_DEFICIT_KCAL_MIN,
  deficitKcalMax: DEFAULT_DEFICIT_KCAL_MAX,
  kcalOverride: null,
  proteinGOverride: null,
  carbsGOverride: null,
  fatGOverride: null,
};

export type MacroTotals = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type DayTarget = MacroTotals & {
  fatAtFloor: boolean;
  carbsTrimmed: boolean;
  proteinExceedsKcal: boolean;
};

export type ProfileForTdee = {
  weight: number | null;
  height: number | null;
  age: number | null;
  gender: "male" | "female" | null;
  activityLevel: number;
  bodyFatPct: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function bmrFromProfile(profile: ProfileForTdee): number | null {
  if (profile.bodyFatPct != null && profile.bodyFatPct > 0 && profile.weight != null && profile.weight > 0) {
    return calculateBMRKatchMcArdle(profile.weight, profile.bodyFatPct);
  }
  if (
    profile.weight != null &&
    profile.weight > 0 &&
    profile.height != null &&
    profile.age != null &&
    profile.gender
  ) {
    return calculateBMR(profile.weight, profile.height, profile.age, profile.gender);
  }
  return null;
}

export function tdeeFromProfile(profile: ProfileForTdee): number | null {
  const bmr = bmrFromProfile(profile);
  if (bmr == null) return null;
  return calculateTDEE(bmr, profile.activityLevel);
}

/**
 * Ккал = TDEE − середина коридора дефицита, если ккал не зафиксированы.
 * Белок и углеводы — г/кг, если не зафиксированы.
 * Жир = остаток калорий. Ниже пола (г/кг) не опускается: тогда режутся углеводы.
 */
export function computeDayTarget(input: {
  weightKg: number | null;
  tdee: number | null;
  settings: NutritionSettings;
}): { ok: true; target: DayTarget } | { ok: false; error: string } {
  const s = input.settings;
  const deficitMid = (s.deficitKcalMin + s.deficitKcalMax) / 2;
  const kcal =
    s.kcalOverride != null
      ? Math.round(s.kcalOverride)
      : input.tdee != null
        ? Math.round(input.tdee - deficitMid)
        : null;
  const proteinG =
    s.proteinGOverride != null
      ? round1(s.proteinGOverride)
      : input.weightKg != null && input.weightKg > 0
        ? round1(s.proteinGPerKg * input.weightKg)
        : null;

  if (kcal == null) {
    return { ok: false, error: "Нет цели по ккал: заполни профиль или зафиксируй ккал." };
  }
  if (proteinG == null) {
    return { ok: false, error: "Нет цели по белку: укажи вес в профиле или зафиксируй белок." };
  }

  const floor =
    input.weightKg != null && input.weightKg > 0 ? round1(s.fatFloorGPerKg * input.weightKg) : 0;
  const carbsFrozen = s.carbsGOverride != null;
  const fatFrozen = s.fatGOverride != null;

  if (carbsFrozen && fatFrozen) {
    const fatG = round1(s.fatGOverride!);
    return {
      ok: true,
      target: {
        kcal,
        proteinG,
        fatG,
        carbsG: round1(s.carbsGOverride!),
        fatAtFloor: fatG <= floor + 0.05,
        carbsTrimmed: false,
        proteinExceedsKcal: proteinG * 4 > kcal,
      },
    };
  }

  if (carbsFrozen) {
    const carbsG = round1(s.carbsGOverride!);
    let fatG = round1((kcal - proteinG * 4 - carbsG * 4) / 9);
    if (fatG < 0) fatG = 0;
    return {
      ok: true,
      target: {
        kcal,
        proteinG,
        fatG,
        carbsG,
        fatAtFloor: fatG <= floor + 0.05,
        carbsTrimmed: false,
        proteinExceedsKcal: proteinG * 4 > kcal,
      },
    };
  }

  if (fatFrozen) {
    const fatG = round1(s.fatGOverride!);
    let carbsG = round1((kcal - proteinG * 4 - fatG * 9) / 4);
    if (carbsG < 0) carbsG = 0;
    return {
      ok: true,
      target: {
        kcal,
        proteinG,
        fatG,
        carbsG,
        fatAtFloor: fatG <= floor + 0.05,
        carbsTrimmed: false,
        proteinExceedsKcal: proteinG * 4 > kcal,
      },
    };
  }

  let carbsG =
    input.weightKg != null && input.weightKg > 0 ? round1(s.carbsGPerKg * input.weightKg) : 0;
  let fatG = round1((kcal - proteinG * 4 - carbsG * 4) / 9);
  let carbsTrimmed = false;
  if (fatG < floor) {
    fatG = floor;
    carbsG = round1((kcal - proteinG * 4 - fatG * 9) / 4);
    carbsTrimmed = true;
  }
  if (carbsG < 0) {
    carbsG = 0;
    fatG = round1((kcal - proteinG * 4) / 9);
    carbsTrimmed = true;
  }
  let proteinExceedsKcal = false;
  if (fatG < 0) {
    fatG = 0;
    proteinExceedsKcal = true;
  }

  return {
    ok: true,
    target: {
      kcal,
      proteinG,
      fatG,
      carbsG,
      fatAtFloor: fatG <= floor + 0.05,
      carbsTrimmed,
      proteinExceedsKcal,
    },
  };
}

export function subtractMacros(target: MacroTotals, eaten: MacroTotals): MacroTotals {
  return {
    kcal: Math.round(target.kcal - eaten.kcal),
    proteinG: round1(target.proteinG - eaten.proteinG),
    fatG: round1(target.fatG - eaten.fatG),
    carbsG: round1(target.carbsG - eaten.carbsG),
  };
}

export function emptyMacros(): MacroTotals {
  return { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
}

export function addMacros(a: MacroTotals, b: MacroTotals): MacroTotals {
  return {
    kcal: Math.round((a.kcal + b.kcal) * 10) / 10,
    proteinG: round1(a.proteinG + b.proteinG),
    fatG: round1(a.fatG + b.fatG),
    carbsG: round1(a.carbsG + b.carbsG),
  };
}
