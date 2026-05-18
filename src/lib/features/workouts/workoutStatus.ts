export type WorkoutStatus = "active" | "completed";

export const WORKOUT_STATUS_LABEL_RU: Record<WorkoutStatus, string> = {
  active: "Активная",
  completed: "Завершена",
};

export function confirmEditCompletedWorkout(): boolean {
  return confirm(
    "Эта тренировка уже завершена и учтена в календаре.\n\n" +
      "Редактировать завершённую запись? Изменения повлияют на сводки и графики."
  );
}
