/** UUID из env (сервер + fallback NEXT_PUBLIC), один источник для login и /api/workout-user. */
export function getConfiguredWorkoutUserIdFromEnv(): string | null {
  const id =
    process.env.WORKOUT_USER_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORKOUT_USER_ID?.trim() ||
    "";
  return id.length > 0 ? id : null;
}
