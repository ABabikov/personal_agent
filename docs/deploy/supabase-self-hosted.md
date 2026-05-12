# Self-hosted Supabase (вторая реплика рядом с сервисом)

Полный стек (Postgres **с постоянным томом**, API через Kong, Auth, Studio…) берётся из **официального репозитория** Supabase — его проще поддерживать в актуальном виде, чем дублировать у нас сотни строк compose.

## Шаги

1. Клонируй [supabase/supabase](https://github.com/supabase/supabase) (или только каталог `docker/`).
2. В `docker/` скопируй `.env.example` → `.env`, [сгенерируй секреты](https://supabase.com/docs/guides/self-hosting/docker#configuring-and-securing-supabase) (`./utils/generate-keys.sh` в их репо).
3. `docker compose up -d` в каталоге `docker/` — поднимутся сервисы, **данные Postgres** лежат в Docker volume (не пропадают при перезапуске контейнера `db`).
4. В Kong будет `SUPABASE_PUBLIC_URL` (часто `http://localhost:8000`). Именно его укажи в приложении как `NEXT_PUBLIC_SUPABASE_URL`, в `.env` / `.env.docker` — `ANON_KEY` и `SERVICE_ROLE_KEY` из их `.env`.
5. Применить схему: с локальной машины `supabase link` на self-hosted API + `supabase db push` **или** выполнить SQL из `supabase/migrations/` через `psql` к контейнеру БД (порядок файлов как в репо).

## Облако + self-hosted

- **Облако** — текущий проект и бэкап в Google Таблицу без изменений.
- **Self-hosted** — отдельный URL и ключи; приложение в Docker собирается с env этой реплики, если крутится рядом с ней.
