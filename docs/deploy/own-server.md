# Деплой на свой сервер

Как уйти с бесплатных лимитов Vercel/Supabase Cloud и держать **Personal Agent** на своей машине (VPS/домашний сервер).

Связанные документы:

- [docker-app.md](./docker-app.md) — Docker-образ Next.js
- [supabase-self-hosted.md](./supabase-self-hosted.md) — полный Supabase на том же или отдельном хосте
- [README.md](./README.md) — обзор вариантов

---

## Рекомендуемая схема

```text
                    ┌─────────────────────────────────────┐
  Internet          │  Ваш сервер (VPS)                    │
  ─────────►      │  ┌─────────┐    ┌──────────────────┐ │
  HTTPS :443        │  │ Caddy/  │───►│ Docker: Next.js  │ │
                    │  │ nginx   │    │ (personal-agent) │ │
                    │  └─────────┘    └────────┬─────────┘ │
                    │                          │           │
                    │         ┌────────────────┴───────┐   │
                    │         │ Supabase (вариант B)   │   │
                    │         │ или облако (вариант A) │   │
                    │         └────────────────────────┘   │
                    └─────────────────────────────────────┘
```

| Вариант | Приложение | База | Плюсы |
|---------|------------|------|--------|
| **A. Минимальный** | Docker на сервере | Supabase Cloud (как сейчас) | Быстро; БД не админишь; лимиты Supabase free/pro |
| **B. Полный self-host** | Docker на сервере | [Self-hosted Supabase](./supabase-self-hosted.md) на том же VPS | Нет лимитов облака; нужны RAM (~4 GB+ для стека Supabase) |
| **C. Гибрид** | Сервер | Supabase Cloud **Pro** + бэкапы | Меньше ops, платёж только за БД |

Для одного пользователя часто достаточно **A** (свой сервер только для Next.js) или **B** если VPS ≥ 8 GB RAM.

---

## Шаг 1. Подготовка сервера

- Linux (Debian/Ubuntu), Docker + Docker Compose.
- Домен `agent.example.com` → A-запись на IP сервера.
- HTTPS: **Caddy** (авто Let's Encrypt) или nginx + certbot.

Минимум для одного контейнера Next.js: **512 MB–1 GB** RAM.  
С self-hosted Supabase на той же машине: **от 4–8 GB** RAM реально.

---

## Шаг 2. Сборка приложения

На сервере или в CI:

```bash
git clone <repo> && cd personal_agent
cp .env.docker.example .env.docker
# заполнить .env.docker (см. ниже)
docker compose --env-file .env.docker up -d --build
```

Приложение слушает `localhost:3000` (или `WEB_PORT`). Снаружи не открывать 3000 — только через reverse proxy на 443.

### `.env.docker` (runtime + build)

Скопировать из `.env.example` и `.env.docker.example`:

```env
# Build-time (вшиваются в клиент)
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_WORKOUT_USER_ID=<uuid>

# Runtime (серверные API routes)
SUPABASE_SERVICE_ROLE_KEY=...
WORKOUT_USER_ID=...
SITE_PASSWORD=...
SITE_AUTH_SECRET=...
OPENROUTER_API_KEY=...

# Huawei
HUAWEI_HEALTH_CLIENT_ID=...
HUAWEI_HEALTH_CLIENT_SECRET=...
HUAWEI_HEALTH_REDIRECT_URI=https://agent.example.com/api/integrations/huawei/callback
HUAWEI_HEALTH_SCOPES=https://www.huawei.com/healthkit/activityrecord.read https://www.huawei.com/healthkit/historydata.open.year

WEB_PORT=3000
```

После смены `NEXT_PUBLIC_*` — **пересборка** образа (`docker compose up --build`).

---

## Шаг 3. Reverse proxy (пример Caddy)

`Caddyfile`:

```caddy
agent.example.com {
    reverse_proxy localhost:3000
}
```

Проверка: `https://agent.example.com/privacy` и `/terms` без редиректа на логин (если public paths в middleware).

---

## Шаг 4. Миграции БД

Если новая БД (self-hosted или новый проект Supabase):

1. Выполнить все файлы из `supabase/migrations/` по порядку.
2. Или `supabase link` + `supabase db push`.

Обязательно для Huawei: `012_huawei_health.sql`.

---

## Шаг 5. Huawei и внешние URL

При смене домена с `personal-agent-zeta.vercel.app` на свой:

| Где | Что обновить |
|-----|----------------|
| Huawei Account Kit | Callback URL |
| `.env.docker` | `HUAWEI_HEALTH_REDIRECT_URI` |
| Заявка / политики (если менялся домен) | privacy, terms, app access URL |
| Telegram BotFather (если TMA) | Web App URL |

---

## Шаг 6. Обновления

```bash
git pull
docker compose --env-file .env.docker up -d --build
```

Данные в Postgres (Supabase volume) переживают перезапуск контейнера **web**; при пересборке только приложения БД не трогается.

---

## Vercel vs свой сервер

| | Vercel free | Свой Docker |
|--|-------------|-------------|
| HTTPS | Да | Настраиваешь сам |
| Serverless лимиты | Есть | Нет (лимит — железо) |
| Долгие sync Huawei | Может оборваться по timeout | Увеличить timeout в proxy при необходимости |
| Env secrets | Dashboard | `.env.docker` на сервере |
| Стоимость | $0 / Pro | VPS от ~300–500 ₽/мес |

Supabase Cloud на free: пауза проекта, лимит строк/размер — при росте данных смотреть Pro или self-host.

---

## Бэкапы

Снимок **всех** таблиц приложения (тренировки, чат, расходы, Huawei-токены и сессии):

```bash
# Локально, в корне репо с заполненным .env:
npm run backup:excel          # → backups/excel/supabase-backup-*.xlsx
npm run backup:sheets         # → Google Таблица (нужен GOOGLE_SERVICE_ACCOUNT)
npm run backup:all            # Excel + Sheets
```

Нужны в `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (или anon при dev RLS).

- **Cron на сервере** (раз в сутки): `0 3 * * * cd /path/personal_agent && npm run backup:excel`
- **GitHub Actions**: `.github/workflows/supabase-google-sheets-backup.yml` (если секреты в репо)
- **Self-hosted Postgres**: `pg_dump` в cron — полный дамп БД, не только таблицы приложения

См. также раздел «Сохранность данных» в [huawei-health-runbook.md](../features/workout-tracker/huawei-health-runbook.md#8-сохранность-данных-не-пропало).

---

## Чеклист «переехал на сервер»

- [ ] Docker web поднят, healthcheck `curl localhost:3000`
- [ ] HTTPS, домен открывается
- [ ] `/privacy`, `/terms` публичны
- [ ] Миграции применены, `WORKOUT_USER_ID` задан
- [ ] Huawei callback и env совпадают
- [ ] Профиль → Подключить Huawei → Синхронизировать работает
