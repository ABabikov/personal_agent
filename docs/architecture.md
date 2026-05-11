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
| TMA             | @telegram-apps/sdk            | Telegram Mini App как основной мобильный вход    |
| LLM             | Vercel AI SDK + OpenRouter    | Агрегатор моделей, гибкость выбора              |
| Embeddings      | OpenRouter                    | Качество поиска, единый провайдер               |
| DB              | Supabase (PostgreSQL + pgvector) | Реляционка + векторный поиск в одной базе    |
| Auth            | Supabase Auth                 | Готово для multi-user в будущем                  |
| Storage         | Supabase Storage (S3)         | Файлы, изображения при необходимости            |
| Deploy          | Vercel                        | Фронт + API + Serverless Functions              |

## Project Structure

```
personal_agent/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (web)/                  # Десктопные страницы (браузер)
│   │   ├── (tma)/                  # Telegram Mini App страницы
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
│   │   │   ├── loop.ts             # ReAct loop (Vercel AI SDK)
│   │   │   ├── tools/              # Tool definitions
│   │   │   ├── prompts/            # System prompts
│   │   │   └── context.ts          # Сборка контекста (pgvector search)
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

```
User Message
    ↓
Context Assembly:
  - system prompt
  - pgvector search по chat_messages и user_context (top-N релевантных)
  - user profile из БД
    ↓
LLM (OpenRouter → Claude / другая модель)
    ↓
Tool Call? ──yes──→ Execute tool (lib/features/*) → result → back to LLM → repeat
    │
    no
    ↓
Final Response → User
```

Tools = обёртки над функциями из `lib/features/`. Агент не ходит в БД напрямую.

Потенциально: переход от ReAct к ручным пайплайнам для критичных сценариев, где нужен предсказуемый результат.

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

## Frontend: TMA + Web

Одно React-приложение, два layout через Next.js route groups:

- `(tma)/` — Telegram Mini App: инициализация через `@telegram-apps/sdk`, compact mobile UI
- `(web)/` — браузер: стандартная навигация, Supabase Auth (на будущее для multi-user)

Общие компоненты переиспользуются. Разница — layout, навигация, инициализация.

## Infrastructure (MVP)

```
Vercel
  ├── Next.js (SSR + API Routes)
  └── Serverless Functions (agent loop, webhooks)

Supabase (hosted)
  ├── PostgreSQL + pgvector
  ├── Auth
  └── Storage (S3)

OpenRouter
  └── LLM API + Embeddings
```

Далее: Docker + Supabase self-hosted при необходимости.
