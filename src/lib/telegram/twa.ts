/** Тип WebApp без зависимости от @types/telegram-web-app (минимум полей). */
export type TelegramWebAppApi = {
  initData?: string;
  initDataUnsafe?: unknown;
  ready: () => void;
  expand: () => void;
  close: () => void;
  version?: string;
};

/**
 * Безопасный доступ к Telegram.WebApp (только в клиенте, вне TMA — undefined).
 */
export function getTelegramWebApp(): TelegramWebAppApi | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    Telegram?: { WebApp?: TelegramWebAppApi };
  };
  return w.Telegram?.WebApp;
}

export function isTelegramMiniApp(): boolean {
  return Boolean(getTelegramWebApp());
}
