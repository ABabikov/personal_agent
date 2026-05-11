import type { ParsedGymWorkout, ParsedSwimWorkout } from "./csvImport";

export type GymDayKey = "pn" | "sr" | "pt";
export type SwimDayKey = "vt" | "cht" | "sb";

export type WorkoutSeedPayload = {
  generatedAt: string;
  gym: Record<GymDayKey, ParsedGymWorkout[]>;
  swim: Record<SwimDayKey, ParsedSwimWorkout[]>;
};
