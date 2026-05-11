# Agent Core — как это работает

> Словесное описание реальной работы кода. Файлы и функции в обратных кавычках — кликабельны в IDE.

## 1. Карта кода

| Слой       | Файл                                            | Назначение |
|------------|-------------------------------------------------|------------|
| LLM        | `src/lib/agent/llm/models.ts`                    | Цепочки моделей, env-оверрайды, RETRYABLE_STATUSES |
| LLM        | `src/lib/agent/llm/openrouter.ts`                | `chatCompletion()` — единый вызов с фоллбеками + tool calling |
| LLM        | `src/lib/agent/llm/embeddings.ts`                | `embedText()` — embedding с фоллбеком |
| Tools      | `src/lib/agent/tools/types.ts`                   | `AgentTool`, `ToolContext`, `ToolResult` |
| Tools      | `src/lib/agent/tools/profile.ts`                 | профиль (get/save/compute) |
| Tools      | `src/lib/agent/tools/workouts_read.ts`           | чтение тренировок |
| Tools      | `src/lib/agent/tools/analytics.ts`               | период/динамика/дни недели |
| Tools      | `src/lib/agent/tools/workouts_write.ts`          | save_gym/swim, прогрессия, оценка калорий |
| Tools      | `src/lib/agent/tools/memory.ts`                  | remember/list/forget fact |
| Tools      | `src/lib/agent/tools/index.ts`                   | `AGENT_TOOLS`, `toolsToSpecs()`, `runTool()` |
| Memory     | `src/lib/agent/memory/store.ts`                  | save/load chat_messages, конвертация в API-формат |
| Memory     | `src/lib/agent/memory/recall.ts`                 | `recallContext()` — pgvector-поиск (косинус-фоллбек) |
| Prompt     | `src/lib/agent/prompts/system.ts`                | `buildSystemPrompt(recall, now)` |
| Loop       | `src/lib/agent/loop.ts`                          | `runAgent()` — ReAct-цикл |
| API        | `src/app/api/chat/route.ts`                      | POST handler |
| UI         | `src/app/(web)/chat/page.tsx`                    | пузыри, ввод, trace тулов |

## 2. Жизненный цикл одного запроса

1. **Клиент** (`/chat`) шлёт `POST /api/chat` с `{ userId, conversationId, message }`.
   - `conversationId` лежит в localStorage. Кнопка «Новый чат» создаёт новый UUID.
2. **Route handler** валидирует тело и зовёт `runAgent`.
3. **runAgent** (`src/lib/agent/loop.ts`):
   1. `loadConversation(userId, conversationId)` — все предыдущие сообщения этого разговора в хронологическом порядке (`chat_messages` отфильтрованы по `user_id` и `conversation_id`, отсортированы по `created_at`).
   2. `recallContext(userId, message, excludeConversationId=conversationId)` — эмбеддит сообщение и достаёт топ-5 близких сообщений из ДРУГИХ разговоров + топ-5 близких фактов из `user_context`. Сравнение — клиентский косинус по последним 300 строкам (быстро для личного бота).
   3. `saveUserMessage` — сразу пишем user-сообщение в БД (с embedding). Делаем это ДО вызова LLM, чтобы переписка не потерялась при падении.
   4. Собираем `messages` для модели:
      ```
      [system(prompt + факты + обрывки прошлого), ...вся история этого разговора, user(message)]
      ```
   5. **ReAct-цикл** (до 6 итераций):
      - `chatCompletion({ messages, tools, toolChoice:'auto', temperature:0.3, maxTokens:2048 })` →
        - либо текстовый `content` (финал — выходим),
        - либо `tool_calls[]` — добавляем `assistant{tool_calls}` в messages, исполняем каждый тул через `runTool`, добавляем `tool{content}` в messages, идём на следующую итерацию.
      - На каждом шаге пишем сообщение в БД (`saveAssistantMessage` / `saveToolMessage`).
   6. Возвращаем `{ finalAnswer, steps }`. `steps` — trace для UI: какая модель ответила, что за тулы дёрнула, что в них пришло/вернулось.

## 3. LLM-фоллбеки (порт PD_Questions)

`chatCompletion` (`src/lib/agent/llm/openrouter.ts`):

- Цепочка: `[OPENROUTER_LLM_MODEL ?? 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'deepseek/...-free', 'meta-llama/llama-4-maverick:free']`.
- Для каждой модели: один HTTP-POST на `${OPENROUTER_BASE_URL}/chat/completions`.
- **Retryable**: HTTP 402, 404, 429, 503 → переходим к следующей модели и записываем попытку в `attempts`.
- Любой `throw` (timeout, network) → тоже к следующей.
- Если модель вернула HTTP 200, но `choices[0].message` пустой и без `tool_calls` → считаем некорректным, идём дальше.
- Падаем (`throw`) только если упали ВСЕ.
- В `result.attempts` всегда есть полный список — это спасает при отладке.
- `max_tokens` подрезается до 4096 (`pickMaxTokens`) — на случай очень бюджетных моделей.

Эмбеддинги — та же логика, но цепочка короче: `text-embedding-3-large` → `text-embedding-3-small`. Если оба упали — `recallContext` возвращает пустые массивы (агент работает без памяти, но не падает).

## 4. Tools — что есть и зачем

Каждый тул в файле под своей категорией. Все собираются в `AGENT_TOOLS` (`src/lib/agent/tools/index.ts`).

### Профиль (`profile.ts`)
- `get_profile` — текущие weight/height/age/gender/activity_level/body_fat_pct + посчитанные bmr и tdee.
- `save_profile` — частичный upsert. Сначала тянет текущий профиль, поверх накатывает только переданные поля.
- `compute_bmr_tdee` — what-if калькулятор без БД (Katch-McArdle если задан жир, иначе Mifflin-St Jeor).

### Чтение тренировок (`workouts_read.ts`)
- `get_last_gym_workout` — последняя силовая (с подходами).
- `get_last_swim_workout` — последний бассейн (с сериями).
- `get_last_gym_workout_for_weekday(weekday)` — последняя силовая в указанный день недели (0..6). Ключевой тул для сценария «сгенерируй мне понедельник/среду».
- `get_recent_workouts(limit?)` — список из N последних.
- `get_workouts_in_range(start, end)` — диапазон по дате.
- `get_current_week_stats` — итоги Пн–Вс этой недели.
- `get_workout_details(id)` — полная карточка по id (для gym — упражнения, для swim — серии).

### Аналитика (`analytics.ts`)
- `get_period_stats(scope, year?, month?)` — числа за месяц/год/всё (тренировок, тоннаж, метраж, ккал).
- `list_exercises(scope?)` — уникальные имена упражнений, отсортированные по частоте.
- `get_exercise_dynamics(exercise_name, scope?)` — серия точек {date, value} для тоннажа и max-веса упражнения.
- `get_tonnage_by_weekday(scope?)` — серии по дням недели (для сравнения "пн / ср / пт").

### Запись и оценка (`workouts_write.ts`)
- `save_gym_workout` — пишет силовую (внутри считает калории, MET + EPOC). Тул всегда требует подтверждения пользователя.
- `save_swim_workout` — пишет плавание (серии).
- `suggest_next_gym_sets(sets)` — целевые подходы для следующей тренировки (+1 повт; вес апается при 18 повт.).
- `estimate_gym_calories(exercises, body_weight?, duration_min?)` — what-if оценка калорий без записи (если вес не задан — тянет из профиля).

### Редактирование и безопасное удаление (`workouts_edit.ts`)
- `update_workout(id, ...)` — частичный апдейт самой workout: дата, заметки, body_weight, calories_estimated. При смене body_weight на силовой — автопересчёт калорий.
- `update_gym_exercises(workout_id, exercises[])` — ПОЛНАЯ замена упражнений. Старые `gym_exercises` удаляются (HARD), вставляются новые, пересчитываются `total_tonnage` и `calories_estimated`. Агент обязан перед этим показать diff.
- `update_swim_series(workout_id, series[])` — то же для плавания. Пересчитывает `total_distance`.
- `delete_workout(id, reason?)` — SOFT-DELETE: ставит `deleted_at = now()` и опциональный `deleted_reason`. Тренировка пропадает из всех read-запросов, но остаётся в БД.
- `restore_workout(id)` — сбрасывает `deleted_at`.
- `list_deleted_workouts(limit?)` — список soft-deleted (для восстановления).

**Read-фильтр**: все запросы (`fetchPeriodData`, `fetchRecentWorkouts`, `fetchWorkoutsInDateRange`, `fetchLastGymWorkoutFromDb`, `fetchLastSwimWorkoutFromDb`, `getWorkoutDetailsTool`, `getLastGymWorkoutForWeekdayTool`) фильтруют `deleted_at IS NULL`. Soft-deleted строки видны ТОЛЬКО через `list_deleted_workouts`.

### Долговременная память (`memory.ts`)
- `remember_fact(key, value)` — upsert в `user_context` (snake_case key). Сохраняет embedding, чтобы потом находить семантически.
- `list_facts` — все сохранённые факты.
- `forget_fact(key)` — удалить.

Все тулы возвращают `{ ok: true, data }` или `{ ok: false, error }`; loop сериализует это в `content` tool-сообщения, чтобы модель видела результат.

## 5. Память: схема БД

`supabase/migrations/003_chat_memory.sql`:

```sql
create table chat_messages (
  id uuid pk,
  user_id uuid → users.id,
  conversation_id uuid,
  role text ∈ {system, user, assistant, tool},
  content text,
  tool_calls jsonb,       -- для assistant
  tool_call_id text,      -- для tool
  tool_name text,
  embedding vector(1536), -- только для user/assistant
  created_at timestamptz
);

create table user_context (
  id uuid pk,
  user_id uuid → users.id,
  key text,
  value text,
  source text,
  embedding vector(1536),
  created_at, updated_at,
  unique (user_id, key)
);
```

Индексы: `(user_id, created_at desc)`, `(conversation_id, created_at)`, HNSW по embedding (cosine ops). HNSW поддерживается pgvector ≥ 0.5; если у проекта старее — заменить на `ivfflat (lists=100)`.

RLS: `for all using true with check true` для anon в dev-режиме (соответствует политике остальных таблиц из миграции 002).

## 6. Recall (семантический поиск)

`src/lib/agent/memory/recall.ts`:

- `recallContext({ userId, queryText, excludeConversationId })`:
  1. `embedText(queryText)` → 1536-вектор.
  2. **Messages**: SELECT последние 300 сообщений user/assistant с embedding (опционально исключая текущий разговор), затем клиентский cosine, top-5.
  3. **Facts**: SELECT все факты этого user_id с embedding, клиентский cosine, top-5.
- Зачем такой "ленивый" подход: для личного бота переписка — это десятки сообщений в день; 300 строк цепляются за один запрос, косинус считается за <1 мс. Когда вырастет — добавим PG-функцию `match_chat_messages` с `<=>` и HNSW-индексом.

## 7. System prompt

`src/lib/agent/prompts/system.ts → buildSystemPrompt(recall, now)`:

- Базовая часть: характер агента, правила работы с тулами (особенно про подтверждение перед записью), формат ответа.
- Блок "ЧТО ТЫ ЗНАЕШЬ ПРО ПОЛЬЗОВАТЕЛЯ" — если есть `recall.facts`, выводит `- key: value`.
- Блок "РЕЛЕВАНТНЫЕ ОБРЫВКИ ИЗ ПРОШЛЫХ РАЗГОВОРОВ" — если есть `recall.messages`, выводит до 5 фрагментов (обрезанных до 280 символов) с датой и ролью.
- Текущая дата/время — тоже инжектится (модель сама не знает; нужно для "сегодня = ?").

## 8. UI `/chat`

`src/app/(web)/chat/page.tsx`:

- На маунте: получает `userId` через `getWorkoutUserId()` и `conversationId` из localStorage (создаёт UUID, если пусто).
- Пузыри: user → справа, assistant → слева, error → красный слева.
- Каждый ответ ассистента содержит свёрнутый блок «Tool calls: N» — там видно, что было вызвано, с какими аргументами и что вернулось. Помогает дебажить «откуда модель взяла эту цифру».
- Кнопка «Новый чат» — сбрасывает conversation_id и пузыри. История остаётся в БД, просто следующий чат с новым id.

## 9. Что важно знать про запись в БД

- `save_gym_workout` / `save_swim_workout` через `saveGymWorkoutToSupabase` / `saveSwimWorkoutToSupabase`, а они зовут `getWorkoutUserId()`. На сервере эта функция работает через env `NEXT_PUBLIC_WORKOUT_USER_ID` — она должна быть установлена (см. `.env.example`).
- Калории при записи силовой считаются автоматически: если пользователь не передал `body_weight`, тул берёт `users.weight` из профиля. Если нет ни там, ни там — `calories_estimated = null`.
- Перед каждой записью агент обязан спросить подтверждение у пользователя — это прописано в system prompt. Если внезапно начнёт писать без подтверждения, проблема в промпте, а не в коде.

## 10. Куда расширять

- **Стриминг**: в `chatCompletion` добавить SSE-парсинг (`stream: true`), в route — `text/event-stream`.
- **PG-RPC для поиска**: создать `match_chat_messages(p_user_id uuid, p_embedding vector(1536), p_limit int, p_exclude_conversation uuid)` и заменить fallback в `recall.ts`.
- **Авто-факты**: после каждого 10-го сообщения вызывать вторую LLM с просьбой «вытащить устойчивые факты», результат `remember_fact`.
- **Голос**: на UI добавить запись → ASR (whisper через OpenRouter) → текст в `message`.
