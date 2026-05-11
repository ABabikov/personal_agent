/** Метки маршрутов для чата и глобального оверлея. */
export const CHAT_ROUTE_LABELS: Record<string, string> = {
  "/": "Календарь тренировок",
  "/gym": "Силовые тренировки",
  "/swim": "Плавание",
  "/chat": "Чат с Jarvis",
  "/profile": "Профиль и параметры",
};

export function buildPageContextPayload(
  pathname: string,
  pageTitle: string,
  pageSummary: string
): string {
  const routeName = CHAT_ROUTE_LABELS[pathname] ?? pathname;
  const lines = [
    `Экран: ${pageTitle || routeName}`,
    `Маршрут: ${pathname}`,
  ];
  if (pageSummary.trim()) {
    lines.push("Содержимое / данные на экране:", pageSummary.trim());
  }
  return lines.join("\n");
}
