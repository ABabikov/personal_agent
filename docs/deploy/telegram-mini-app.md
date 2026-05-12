# Telegram Mini App

## Уже в коде

- В корневом layout подключается скрипт `https://telegram.org/js/telegram-web-app.js`.
- После загрузки вызываются `WebApp.ready()`, `expand()`, `disableVerticalSwipes()` — чтобы мини-приложение занимало экран нормально.

Утилиты: `src/lib/telegram/twa.ts` (`getTelegramWebApp()`, `isTelegramMiniApp()`).

## Что сделать вручную

1. **HTTPS** — Mini App открывается только с защищённого URL (прод-домен или туннель для разработки).
2. **BotFather** — создать бота, задать домен, привязать Web App URL (документация Telegram).
3. При необходимости **проверка `initData` на сервере** и связка с `users.telegram_id` — отдельная задача (сейчас вход по паролю сайта и env `WORKOUT_USER_ID` как раньше).

## Локальная отладка

Часто используют [ngrok](https://ngrok.com/) или аналог, чтобы выдать HTTPS на `localhost:3000`, и подставляют этот URL в BotFather.
