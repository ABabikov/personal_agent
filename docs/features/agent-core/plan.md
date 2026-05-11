# Agent Core — план реализации

## Архитектурный обзор

```
src/lib/agent/
├── llm/
│   ├── models.ts         # цепочки моделей, RETRYABLE_STATUSES, max_tokens
│   ├── openrouter.ts     # POST /chat/completions с tool calling + фоллбеки
│   └── embeddings.ts     # POST /embeddings + фоллбек на 3-small
├── tools/
│   ├── types.ts          # тип AgentTool / ToolContext / ToolResult
│   ├── profile.ts        # get_profile, save_profile, compute_bmr_tdee
│   ├── workouts_read.ts  # get_last_*, get_recent, get_workouts_in_range, get_workout_details, get_current_week_stats
│   ├── analytics.ts      # get_period_stats, list_exercises, get_exercise_dynamics, get_tonnage_by_weekday
│   ├── workouts_write.ts # save_gym_workout, save_swim_workout, suggest_next_gym_sets, estimate_gym_calories
│   ├── memory.ts         # remember_fact, list_facts, forget_fact
│   └── index.ts          # AGENT_TOOLS + toolsToSpecs() + runTool()
├── memory/
│   ├── store.ts          # save/load chat_messages, toApiMessages
│   └── recall.ts         # pgvector-поиск (через косинус-фоллбек на клиенте сервера)
├── prompts/
│   └── system.ts         # buildSystemPrompt(recall, now)
└── loop.ts               # runAgent() — ReAct цикл

src/app/api/chat/route.ts # POST handler: парсит body, дёргает runAgent
src/app/(web)/chat/page.tsx # UI: пузыри, trace тулов, новая сессия
```

## Цепочка LLM (порт PD_Questions)

1. **Primary**: `anthropic/claude-sonnet-4` (`OPENROUTER_LLM_MODEL` для оверрайда).
2. **Fallbacks** (по очереди при retryable-статусах 402/404/429/503 / любом исключении / пустом ответе):
   - `google/gemini-2.5-flash`
   - `deepseek/deepseek-chat-v3-0324:free`
   - `meta-llama/llama-4-maverick:free`
3. Падаем (`throw`) только если упали ВСЕ. Полный trace попыток — в `attempts` ответа.

Эмбеддинги: `openai/text-embedding-3-large` (1536 dims) → fallback `openai/text-embedding-3-small`.

## Tool calling

- Формат — OpenAI-style: `tools: [{ type:'function', function:{ name, description, parameters } }]`, `tool_choice: 'auto'`.
- Каждый тул в `AGENT_TOOLS` имеет execute(args, ctx). Парсинг `arguments` (строка JSON) → объект делает `runTool`.
- В loop максимум **6 итераций** ReAct. На каждой:
  - запрашиваем модель,
  - если есть `tool_calls` — кладём `assistant{tool_calls}` + `tool{content}` в messages, идём дальше,
  - если нет — возвращаем `finalAnswer`.

## Память

### Текущий разговор
- `conversation_id` (UUID) генерится на клиенте, лежит в localStorage. Кнопка «Новый чат» создаёт новый.
- На каждое сообщение `runAgent`:
  1. `loadConversation(userId, conversationId)` — все предыдущие сообщения этого разговора в хронологическом порядке.
  2. `saveUserMessage` (с embedding) — сразу, чтобы переписка сохранилась даже при падении LLM.
  3. После каждого витка: `saveAssistantMessage` (с tool_calls если есть) и `saveToolMessage` для каждого result.

### Долговременная память (между разговорами)
- `recallContext(userId, queryText, excludeConversationId)`:
  - эмбеддит запрос,
  - берёт топ-5 наиболее близких сообщений из других разговоров (по косинусу),
  - берёт топ-5 ближайших фактов из `user_context`,
  - всё это вкладывается в system prompt отдельным блоком.
- Реализация — клиентский косинус по последним 300 сообщениям (для личного бота этого хватает).
  Когда упрёмся в перформанс — добавим PG-функцию `match_chat_messages(...)`.

### Явные факты
- Тулы `remember_fact` / `list_facts` / `forget_fact` пишут в `user_context` (upsert по `user_id+key`).
- Embedding фактов считается при записи — чтобы потом семантически находить.

## Безопасность / RLS

- `chat_messages` и `user_context` в dev-режиме имеют политику «всё разрешено» (`for all using true with check true`),
  как и остальные таблицы — миграция 002 уже задала этот dev-режим.
- В Phase 2 (Telegram auth) политика заменится на `user_id = auth.uid()` и сервер пойдёт через service-role key.

## API

`POST /api/chat`

Request:
```json
{
  "userId": "<uuid>",
  "conversationId": "<uuid>",
  "message": "Что было в прошлый раз?"
}
```

Response:
```json
{
  "conversationId": "<uuid>",
  "finalAnswer": "В прошлый раз (2026-05-09) ...",
  "steps": [
    {
      "iteration": 1,
      "modelUsed": "anthropic/claude-sonnet-4",
      "toolCalls": [{ "name": "get_last_gym_workout", "args": "{}", "result": {...} }],
      "assistantText": "",
      "finishReason": "tool_calls",
      "attempts": [{ "model": "anthropic/claude-sonnet-4", "status": 200 }]
    },
    {
      "iteration": 2,
      "modelUsed": "anthropic/claude-sonnet-4",
      "toolCalls": [],
      "assistantText": "В прошлый раз (2026-05-09) ...",
      "finishReason": "stop",
      "attempts": [{ "model": "anthropic/claude-sonnet-4", "status": 200 }]
    }
  ]
}
```

## Конфиг ENV

| Переменная | Значение по умолчанию |
|---|---|
| `OPENROUTER_API_KEY` | (обязательно) |
| `OPENROUTER_LLM_MODEL` | `anthropic/claude-sonnet-4` |
| `OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-large` |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |

## Что не сделано / Phase 2+

- Streaming (SSE).
- Извлечение фактов из переписки авто-агентом (после каждого N-го сообщения суммируем и зовём `remember_fact`).
- PG-функция `match_chat_messages` (SQL RPC) — когда переписка станет большой.
- Авторизация (сейчас userId приходит с клиента, в продакшен-варианте это пойдёт через auth.uid()).
- UI: история разговоров, переключение между ними.
