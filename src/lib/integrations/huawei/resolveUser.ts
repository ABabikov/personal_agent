import { getConfiguredWorkoutUserIdFromEnv } from "@/lib/auth/workout-user-env";

/** Resolves user id for integration API: env first, then explicit query/body. */
export function resolveIntegrationUserId(
  explicit: string | null | undefined
): string | null {
  const fromEnv = getConfiguredWorkoutUserIdFromEnv();
  if (fromEnv) return fromEnv;
  const trimmed = explicit?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
