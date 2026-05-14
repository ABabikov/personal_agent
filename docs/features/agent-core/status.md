# Agent Core — статус

## Current Phase: Phase 1 (MVP)
## Status: Done — чат работает, тулы подключены, память сохраняется

## Progress

| Task                                                                     | Status      | Date       |
|--------------------------------------------------------------------------|-------------|------------|
| Миграция `003_chat_memory.sql`: chat_messages + user_context + pgvector | Done        | 2026-05-11 |
| Типы Supabase для новых таблиц                                           | Done        | 2026-05-11 |
| LLM-клиент OpenRouter с фоллбеками (claude-sonnet-4 → gemini → deepseek → llama-4-maverick) | Done | 2026-05-11 |
| Embeddings (text-embedding-3-large 1536, фоллбек на 3-small)             | Done        | 2026-05-11 |
| Тулы: профиль (get_profile / save_profile / compute_bmr_tdee)             | Done        | 2026-05-11 |
| Тулы: чтение тренировок (last gym/swim, recent, in-range, details, week) | Done        | 2026-05-11 |
| Тулы: аналитика (period_stats, list_exercises, exercise_dynamics, tonnage_by_weekday) | Done | 2026-05-11 |
| Тулы: запись (save_gym_workout, save_swim_workout, estimate_gym_calories, suggest_next_gym_sets) | Done | 2026-05-11 |
| Тулы: редактирование (update_workout, update_gym_exercises, update_swim_series) | Done        | 2026-05-11 |
| Тулы: безопасное удаление (delete_workout soft + restore_workout + list_deleted_workouts) + миграция 004 | Done | 2026-05-11 |
| Тулы: память (remember_fact, list_facts, forget_fact)                    | Done        | 2026-05-11 |
| Тулы: питание (get_meal_plan_state, set_meal_plan_state) + `mealPlan` в POST /api/chat, применение на клиенте | Done | 2026-05-14 |
| Loop: ReAct-цикл с сохранением каждого сообщения в БД                    | Done        | 2026-05-11 |
| Recall: семантический поиск по чатам и фактам (косинус-фоллбек)          | Done        | 2026-05-11 |
| System prompt с инъекцией фактов и обрывков прошлых разговоров           | Done        | 2026-05-11 |
| `POST /api/chat` handler                                                 | Done        | 2026-05-11 |
| UI `/chat`: пузыри, новая сессия, trace тулов                            | Done        | 2026-05-11 |
| Доки (description / plan / status / logic)                                | Done        | 2026-05-11 |
| Стриминг (SSE)                                                            | Not Started | -          |
| PG-функция `match_chat_messages` (RPC через pgvector index)              | Not Started | -          |
| Авто-извлечение фактов из переписки                                       | Not Started | -          |
| История чатов в UI (переключение между conversation_id)                  | Not Started | -          |

## Известные ограничения

- Сейчас `userId` приходит с клиента (env `NEXT_PUBLIC_WORKOUT_USER_ID` или localStorage). Боевой вариант с auth — Phase 2.
- Семантический поиск — клиентский косинус на сервере по последним 300 сообщениям. На переписке в десятки тысяч сообщений нужен PG-RPC, см. plan.md.
- Тул `save_*` пишет через анонимные политики Supabase. В продакшене перейти на service-role-key + строгий RLS.
