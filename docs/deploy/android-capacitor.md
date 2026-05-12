# Android APK (Capacitor)

Приложение — это **WebView**, который открывает уже задеплоенный сайт Next.js (тот же URL, что в браузере). Отдельной сборки «React Native» нет.

## Один раз

1. Установлены зависимости (`npm ci`).
2. В корне уже есть `capacitor.config.ts` и папка `www/` (заглушка для Capacitor).

Добавь нативный проект Android (генерирует каталог `android/`):

```bash
npm run mobile:add:android
```

## URL сервера

Перед `cap sync` задай URL, с которого WebView грузит приложение:

```bash
# пример: прод
set CAPACITOR_SERVER_URL=https://your-domain.com
npm run mobile:sync

# эмулятор Android → dev на ПК (localhost хоста)
set CAPACITOR_SERVER_URL=http://10.0.2.2:3000
npm run mobile:sync
```

На Linux/macOS: `export CAPACITOR_SERVER_URL=...`.

## Сборка APK

```bash
npm run mobile:open:android
```

В Android Studio: **Build → Build Bundle(s) / APK(s)**. Для подписи release нужен keystore (стандартный процесс Google).

## Замечания

- `android/` по желанию коммить в git или генерировать в CI (в `.dockerignore` каталог `android` исключён из контекста сборки образа Next).
