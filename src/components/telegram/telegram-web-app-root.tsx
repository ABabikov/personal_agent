"use client";

import Script from "next/script";
import { useEffect, type ReactNode } from "react";

/**
 * В Telegram Mini App подключается telegram-web-app.js; вызываем ready/expand, чтобы интерфейс не «прыгал».
 * В обычном браузере ничего не делает.
 */
export function TelegramWebAppRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const w = window as unknown as {
      Telegram?: { WebApp?: { ready?: () => void; expand?: () => void; disableVerticalSwipes?: () => void } };
    };
    const tg = w.Telegram?.WebApp;
    if (!tg) return;
    try {
      tg.ready?.();
      tg.expand?.();
      tg.disableVerticalSwipes?.();
    } catch {
      // ignore
    }
  }, []);

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
      />
      {children}
    </>
  );
}
