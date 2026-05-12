# Personal Agent (Jarvis) — Architecture

## Vision

Персональный AI-ассистент, автоматизирующий ежедневную рутину и повышающий эффективность. Единое приложение с чат-интерфейсом и детерминистскими UI-формами.

## Core Principles

1. **Модульность** — каждая фича изолирована и может работать независимо
2. **Data-first** — данные хранятся структурированно, аналитика строится поверх
3. **Dual-mode** — каждая фича доступна и через UI, и через чат с агентом
4. **Shared logic** — бизнес-логика общая для UI и агента, дублирования нет

## Tech Stack

| Component       | Technology                    | Rationale                                      |
|-----------------|-------------------------------|-------------------------------------------------|
| Framework       | Next.js (App Router)          | Монолит фронт + бэк, нативный деплой на Vercel |
| Language        | TypeScript                    | Один язык на весь проект                        |
| UI              | React + Tailwind + shadcn/ui  | Быстрая разработка, адаптивность                |
| TMA             | Telegram `WebApp` + скрипт tg.org/js            | Mini App в том же приложении; при необходимости позже `@telegram-apps/sdk` |
| LLM             | OpenRouter (прямой fetch)     | Свой клиент с цепочкой фоллбеков (`anthropic/claude-sonnet-4` → gemini → deepseek → llama). Vercel AI SDK не нужен — лишний слой. |
| Embeddings      | OpenRouter                    | `openai/text-embedding-3-large` (1536d) → `-3-small` фоллбек     |
| DB              | Supabase (PostgreSQL + pgvector) | Реляционка + векторный поиск в одной базе    |
| Auth            | Supabase Auth                 | Готово для multi-user в будущем                  |
| Storage         | Supabase Storage (S3)         | Файлы, изображения при необходимости            |
| Deploy          | Vercel                        | Фронт + API + Serverless Functions              |

## Project Structure

```
personal_agent/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (web)/                  # Основной UI (браузер + тот же бандл в TG WebView)
│   │   ├── api/
│   │   │   ├── chat/               # Эндпоинт агентского лупа
│   │   │   ├── features/           # REST для детерминистских операций
│   │   │   └── webhooks/           # Telegram webhook
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                     # shadcn/ui base
│   │   ├── chat/                   # Чат-интерфейс
│   │   └── features/               # UI по фичам
│   ├── lib/
│   │   ├── agent/
│   │   │   ├── llm/                # openrouter + embeddings c фоллбеками
│   │   │   ├── tools/              # 20 тулов на все ручки (read + write)
│   │   │   ├── memory/             # store (chat_messages) + recall (pgvector)
│   │   │   ├── prompts/            # System prompts (с инъекцией фактов/обрывков)
│   │   │   └── loop.ts             # ReAct цикл, своя реализация
│   │   ├── db/                     # Supabase client, queries
│   │   ├── features/               # Бизнес-логика по фичам
│   │   │   ├── workouts/
│   │   │   ├── nutrition/
│   │   │   └── ...
│   │   └── telegram/               # TMA utilities
│   └── types/                      # TypeScript types
├── supabase/
│   └── migrations/                 # SQL миграции
├── docs/                           # Документация по фичам
└── public/
```

## Two Modes per Feature

Каждая фича работает в двух режимах:

### Детерминистский (UI-driven)
```
User → UI Form → API Route → lib/features/* → DB → Response
```
Прямое взаимодействие через формы. Без LLM. Пример: заполнить результаты тренировки, сохранить.

### Агентский (Chat-driven)
```
User → Chat → Agent Loop → Tool Call → lib/features/* → DB → Agent Response
```
Через чат. LLM выбирает нужный tool, вызывает ту же бизнес-логику. Пример: "проанализируй мой прогресс по жиму за месяц".

**Ключевое:** `lib/features/*` — единый слой. UI и агент вызывают одни и те же функции.

## Agent Loop

Реализован, см. фичу [`docs/features/agent-core/`](features/agent-core/logic.md). Текущая схема:

```
POST /api/chat { userId, conversationId, message }
    ↓
loadConversation(...)            — вся история этого разговора из chat_messages
recallContext(message, exclude=conversationId)
    └─ embed → top-5 близких сообщений из ДРУГИХ разговоров + top-5 фактов из user_context
saveUserMessage(...)              — пишем СРАЗУ, ещё до LLM, чтобы не потерять
    ↓
build system prompt: характер + факты + обрывки прошлых разговоров + текущая дата
    ↓
ReAct loop (≤6 итераций):
  chatCompletion(...) ── OpenRouter с цепочкой фоллбеков
        │
        ├── tool_calls? ── для каждого → runTool() → пишем tool-сообщение, идём дальше
        └── content       → saveAssistantMessage, выходим
    ↓
return { finalAnswer, steps }     — steps содержит trace всех тулов для UI
```

Цепочка моделей при ошибках 402/404/429/503 или throw: `anthropic/claude-sonnet-4 → google/gemini-2.5-flash → deepseek/deepseek-chat-v3-0324:free → meta-llama/llama-4-maverick:free`. Полный список попыток сохраняется в `result.attempts`.

Tools — 20 штук, разбиты по категориям (профиль / чтение тренировок / аналитика / запись / память). Каждый — обёртка над функциями из `lib/db/` и `lib/features/`. Все вызывают одну и ту же бизнес-логику, что и UI-формы.

## Data Model (Supabase PostgreSQL + pgvector)

### Core Tables

```sql
-- Пользователи
users
  id              uuid PK
  telegram_id     bigint UNIQUE
  profile         jsonb           -- имя, настройки, предпочтения
  created_at      timestamptz

-- История чата
chat_messages
  id              uuid PK
  user_id         uuid FK → users
  role            text            -- user / assistant / tool
  content         text
  embedding       vector(1536)    -- для pgvector similarity search
  created_at      timestamptz

-- Персистентная память агента (извлечённые факты)
user_context
  id              uuid PK
  user_id         uuid FK → users
  key             text            -- "goal", "injury", "preference"
  value           text
  embedding       vector(1536)
  created_at      timestamptz
```

### Feature Tables (пример: workouts)

```sql
workout_plans
  id              uuid PK
  user_id         uuid FK → users
  name            text
  goal            text
  schedule        jsonb           -- [{day, exercises}]

workouts
  id              uuid PK
  user_id         uuid FK → users
  plan_id         uuid FK → workout_plans (nullable)
  date            date
  notes           text

workout_exercises
  id              uuid PK
  workout_id      uuid FK → workouts
  exercise_name   text
  sets            jsonb           -- [{weight, reps}]
```

Каждая фича добавляет свои таблицы по тому же принципу.

## Context & Vector Search

При каждом сообщении в чат:
1. Embedding входящего сообщения через OpenRouter
2. pgvector similarity search по `chat_messages` + `user_context`
3. Top-N релевантных записей добавляются в system prompt
4. Агент отвечает с полным контекстом

## Frontend: браузер + Telegram WebView

Одно React-приложение (`(web)/` и корневой layout). Для Telegram Mini App подключается официальный `telegram-web-app.js`, вызываются `ready` / `expand` (см. `TelegramWebAppRoot`, `src/lib/telegram/twa.ts`). Отдельная route group `(tma)/` при появлении отличающегося UI.

## Deploy и клиенты

Подробно: **[docs/deploy/README.md](./deploy/README.md)** — Docker-образ приложения, официальный self-hosted Supabase (отдельный compose, тома Postgres), Telegram Mini App, Android через Capacitor.

Кратко:

- **Vercel + Supabase Cloud** — основной режим без изменений.
- **Docker** — `Dockerfile` + `docker-compose.yml` только для Next; URL/ключи Supabase задаются в `.env.docker`.
- **Вторая реплика Postgres** — штатный [docker Supabase](https://github.com/supabase/supabase/tree/master/docker), не дублируется в этом репозитории.
- **Android** — Capacitor WebView на прод-URL (`npm run mobile:add:android`, `CAPACITOR_SERVER_URL`, `npm run mobile:sync`).

## Infrastructure

```
Vercel (или Docker: Next standalone)
  ├── Next.js (SSR + API Routes)
  └── Serverless / контейнер (agent loop)

Supabase (Cloud и/или self-hosted)
  ├── PostgreSQL + pgvector
  └── Auth / Storage — по конфигурации проекта

OpenRouter
  └── LLM API + Embeddings
```
