export type KidId = "boy" | "girl";

export const KIDS: Record<KidId, { id: KidId; label: string; chatLabel: string }> = {
  boy: { id: "boy", label: "Мальчик", chatLabel: "Чат мальчика" },
  girl: { id: "girl", label: "Девочка", chatLabel: "Чат девочки" },
};

export const WEEKDAYS = [
  { id: 1, short: "Пн", full: "Понедельник" },
  { id: 2, short: "Вт", full: "Вторник" },
  { id: 3, short: "Ср", full: "Среда" },
  { id: 4, short: "Чт", full: "Четверг" },
  { id: 5, short: "Пт", full: "Пятница" },
  { id: 6, short: "Сб", full: "Суббота" },
  { id: 7, short: "Вс", full: "Воскресенье" },
] as const;

export const APP_TZ = "Asia/Novosibirsk";
