# Docker: только приложение

В репозитории **нет** полного стека Supabase (Kong, GoTrue, Studio…) — он тяжёлый и [официально поддерживается отдельным compose](https://supabase.com/docs/guides/self-hosting/docker). Здесь собирается **Next.js** в режиме `standalone`.

## Быстрый старт

1. Скопируй `.env.docker.example` → `.env.docker`, заполни `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` и остальное (как в основном `.env`: OpenRouter, опционально `SITE_PASSWORD` / `WORKOUT_USER_ID`).
2. Сборка и запуск (подстановка переменных для **build-args** идёт из этого файла):

```bash
docker compose --env-file .env.docker up -d --build
```

Приложение: `http://localhost:3000` (или `WEB_PORT` из `.env.docker`).

## Важно про `NEXT_PUBLIC_*`

Они **вшиваются на этапе сборки** образа. Сменил URL Supabase — пересобери образ (`docker compose up --build`).

## Связка с двумя репликами Supabase

- **Облако** — в `.env.docker` облачный `NEXT_PUBLIC_SUPABASE_URL`, образ для прод-сервера.
- **Self-hosted** — другой `.env.docker` на машине/в CI или тот же compose с другим `--env-file`; бэкап в Google Sheets по-прежнему: тот же `npm run backup:sheets`, но с env нужной реплики (см. корневой `.env.example`).
