# Personal Agent (Jarvis)

AI-powered personal assistant for automating daily routines and boosting productivity.

## Documentation

- [Architecture](docs/architecture.md) — system design, dual-mode (UI ↔ agent), tech stack
- [Feature Catalog](docs/features/README.md) — обзор всех фич + статусы
- [Feature Template](docs/features/_template.md) — структура документации новой фичи

## Features

- **[Workout Tracker](docs/features/workout-tracker/)** — учёт силовых и плавательных тренировок, BMR/TDEE, импорт из Google Sheets, спортивный календарь
  - [Description](docs/features/workout-tracker/description.md) · [Plan](docs/features/workout-tracker/plan.md) · [Status](docs/features/workout-tracker/status.md) · [Logic](docs/features/workout-tracker/logic.md)
- **[Agent Core](docs/features/agent-core/)** — чат с Claude Sonnet 4 (фоллбеки на gemini/deepseek/llama), 20 тулов на все ручки приложения, история чата и долговременная память на pgvector
  - [Description](docs/features/agent-core/description.md) · [Plan](docs/features/agent-core/plan.md) · [Status](docs/features/agent-core/status.md) · [Logic](docs/features/agent-core/logic.md)

## Quick Start

```bash
npm install
cp .env.example .env
# заполни NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
# для чата с агентом: заполни OPENROUTER_API_KEY
# применить миграции из supabase/migrations/*.sql в проект Supabase
#   (003_chat_memory.sql включает CREATE EXTENSION vector — pgvector нужен)

npm run dev                 # Next.js dev server
npm run seed:supabase       # офлайн-импорт исторических CSV в Supabase
npm run seed:supabase:dry   # dry-run без записи в БД
```

Подробности про идентификацию пользователя без auth, dev-RLS-политики и переменные окружения — в [`docs/features/workout-tracker/logic.md`](docs/features/workout-tracker/logic.md) и [`.env.example`](.env.example).
