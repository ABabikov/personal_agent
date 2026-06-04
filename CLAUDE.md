# CLAUDE.md — Personal Agent (Jarvis)

Guidance for Claude Code when working in **this** repository.

> ⚠️ Не путать с `C:\Users\Ababikov\Downloads\CLAUDE.md` — тот файл описывает другой проект
> (protobuf/gRPC монорепо Finam) и к этому репозиторию отношения не имеет. Истина для этого
> проекта — здесь.

## Что это

**Personal Agent («Jarvis»)** — персональный AI-ассистент: здоровье, тренировки (зал/плавание),
питание, расходы, планирование. Доступ к каждой фиче в двух режимах: UI-формы и чат с агентом.

Язык общения с пользователем — **русский**. Документация ведётся по-русски.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** — монолит фронт+бэк.
- **Tailwind v4** + **shadcn/ui** (`@base-ui/react`, `lucide-react`).
- **Supabase** (PostgreSQL + **pgvector**) — БД, память агента, (в перспективе) auth/storage.
- **OpenRouter** (прямой fetch, без Vercel AI SDK) — LLM + embeddings, со своей цепочкой фоллбеков.
- **Capacitor** — Android-обёртка (WebView на прод-URL).
- Деплой: **Vercel + Supabase Cloud** (основной); Docker и self-hosted Supabase — опционально.

## Команды

```bash
npm run dev                     # Next.js dev server
npm run build                   # прод-сборка
npm run lint                    # eslint
npx tsc --noEmit                # typecheck (отдельного npm-скрипта нет)

npm run seed:supabase[:dry]     # офлайн-импорт исторических CSV тренировок
npm run import:huawei-export[:dry]   # импорт из ручного экспорта Huawei Health
npm run seed:expenses[:dry]     # импорт расходов из Money Manager
npm run backup:all[:dry]        # бэкап Supabase → Google Sheets + Excel
npm run debug:huawei-autolink   # отладка автолинковки device-сессий ↔ тренировок
npm run debug:huawei-timezone   # отладка таймзон Huawei

npm run docker:up / docker:down
npm run mobile:add:android / mobile:sync / mobile:open:android
```

## Архитектурный принцип: dual-mode (САМОЕ ВАЖНОЕ)

Каждая фича работает через UI **и** через агента, вызывая **один общий слой бизнес-логики**.
Дублировать логику нельзя.

```
UI:    User → форма → API route → lib/features/* (или lib/db/*) → Supabase
Agent: User → чат → ReAct loop → tool → ТЕ ЖЕ lib/features/* → Supabase
```

При добавлении/изменении логики: пиши её в `lib/features/*` или `lib/db/*`, затем подключай
**и** в UI, **и** как тул агента. Не клади бизнес-логику в компоненты или в тул напрямую.

## Структура

```
src/
  app/
    (web)/        — основной UI: chat, gym, swim, profile, expenses, meal-plan
    (tma)/        — Telegram Mini App layout (заготовка)
    api/
      chat/       — агентский луп (POST /api/chat)
      integrations/huawei/  — OAuth, sync, autolink, import-export
      meal-plan/, workout-user/, auth/, webhooks/
    privacy/, terms/, login/
  components/     — ui/ (shadcn), chat/, calendar/, charts/, workout/, swim/, meal-plan/, ...
  lib/
    agent/
      loop.ts            — ReAct цикл (≤8 итераций), без стриминга
      llm/               — openrouter.ts (фоллбеки), embeddings.ts, models.ts
      tools/             — реестр тулов (index.ts) + реализации по категориям
      memory/            — store.ts (chat_messages), recall.ts (pgvector)
      prompts/system.ts  — system prompt (характер + контекст экрана + факты + recall)
      context/sessionSnapshot.ts — детерминированный снимок профиля/нагрузки
    db/                  — Supabase клиенты + запросы (calendarData, saveWorkout, ...)
    features/            — бизнес-логика: workouts/, swimming/, meal-plan/, expenses/
    integrations/huawei/ — OAuth + парсинг + линковка device-сессий
  types/database.ts      — типы таблиц Supabase (держать в синхроне с миграциями)
supabase/migrations/     — SQL миграции 001..NNN (применять по порядку)
docs/                    — doc-first: architecture.md + features/<name>/{description,plan,status,logic}.md
```

## Doc-first процесс

Проект ведётся документацией вперёд кода. Перед/после работы над фичей сверяйся с
`docs/features/<feature>/`:
- `description.md` — бизнес-описание, `plan.md` — план по фазам, `status.md` — прогресс,
  `logic.md` — словесное описание реальной работы кода.
- Реестр фич и статусы: `docs/features/README.md`. Общая архитектура: `docs/architecture.md`.
- Новая фича: скопировать `docs/features/_template.md`, добавить строку в реестр.

> Примечание: `status.md` бывает устаревшим (например, Huawei числится «Not Started», хотя код
> в значительной части написан). Доверяй коду; при расхождении — обнови `status.md`.

## Агент / чат

- ReAct-луп в `src/lib/agent/loop.ts`. Каждое сообщение сохраняется в `chat_messages` сразу.
- Цепочка моделей при 402/404/429/503/throw:
  `anthropic/claude-sonnet-4 → google/gemini-2.5-flash → deepseek/deepseek-chat-v3-0324:free → meta-llama/llama-4-maverick:free`.
- Память: pgvector similarity по `chat_messages` (другие разговоры) + факты `user_context`.
- ~30 тулов (профиль / чтение тренировок / аналитика / запись / edit+soft-delete / память /
  расходы read / meal-plan / web_search). Все — обёртки над общей логикой `lib/*`.
- **Правило записи:** любые write-тулы (save_*/update_*/delete_*/remember_/forget_) — только после
  явного подтверждения пользователя; сначала показать, что будет записано/изменено.
- System prompt и характер агента: `src/lib/agent/prompts/system.ts`.

## Данные и dev-режим (важно для безопасности)

- **Auth пока нет.** Пользователь определяется через `NEXT_PUBLIC_WORKOUT_USER_ID` / `WORKOUT_USER_ID`
  или авто-создание строки в `users` + кеш в `localStorage`.
- Миграция `002_dev_anon_workout_policies.sql` открывает RLS для `anon` — это **dev-режим**.
  Перед public-деплоем политики надо переписать на `auth.uid()`.
- Huawei-секреты — **только серверные** (не `NEXT_PUBLIC_`). Для OAuth-токенов предпочтителен
  `SUPABASE_SERVICE_ROLE_KEY`.
- Конфигурация — в `.env` (примеры: `.env.example`, `.env.docker.example`).

## Конвенции

- TypeScript строгий; типы таблиц — в `src/types/database.ts`, синхронны с миграциями.
- Новые таблицы — новой миграцией `supabase/migrations/NNN_*.sql` (по порядку), плюс обновить
  `database.ts`.
- Графики — самописный SVG без сторонних чарт-библиотек (см. `components/charts/`).
- Без эмодзи в ответах агента; markdown — да.
- Платформа разработки — Windows/PowerShell; в репозитории смешанные LF/CRLF (git предупреждает).

## Текущий незакоммиченный фронт работ

Большой пласт по **Huawei Health**: OAuth-путь готов, но заблокирован одобрением Huawei, поэтому
добавляется **обходной ручной импорт** из экспорта данных (`lib/integrations/huawei/importExport.ts`,
`parseMotionPath.ts`, `enrichWorkout.ts`, `/api/integrations/huawei/import-export`,
`/api/integrations/huawei/autolink`, `components/workout/device-metrics-strip.tsx`,
`hooks/use-device-workout-enrichment.ts`, миграция `014_workout_duration_minutes.sql`, debug-скрипты).
