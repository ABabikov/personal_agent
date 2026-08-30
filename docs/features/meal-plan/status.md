# Meal Plan & Shopping — статус

## Current Phase: прототип UI + автозаполнение недели + агент (localStorage)

## Status

- **Требования** — `description.md`, `plan.md` (в т.ч. раздел «Интеграция с чатом»).
- **UI `/meal-plan`:** цели КБЖУ, слоты, дефицит, база, каталог, план порций, недельная сетка, список покупок — `localStorage`.
- **Автозаполнение недели:** алгоритм (веса слотов, порции, анти-повторы) + опционально LLM (`POST /api/meal-plan/generate-week`). Кнопки «Составить неделю» / «Пересобрать всё», чекбокс «Умная модель».
- **Чат:** тулы `get_meal_plan_state`, `generate_meal_week_plan`, `set_meal_plan_state` (в т.ч. `weekPlan`); клиент шлёт `mealPlan` (+ week) в `POST /api/chat`.

## Progress

| Task | Status |
|------|--------|
| `description.md` / `plan.md` / интеграция с агентом в доках | Done |
| Тулы get/set + реестр | Done |
| `mealPlan` в API + `ToolContext` + `loop` | Done |
| Клиент: прикрепление снимка + применение ответа тула | Done |
| План по дням + недельная сетка | Done (прототип) |
| Автозаполнение недели (алгоритм + LLM) | Done |
| Тул `generate_meal_week_plan` | Done |
| Коридор КБЖУ «ниже проги» + баланс с тренировками/часами | Not Started |
| Рецепты из интернета + кеш КБЖУ | Partial (поиск есть, парсинг КБЖУ слабый) |
| Supabase вместо localStorage | Not Started |
| Интеграции магазинов / автозаказ | Not Started |

## Notes

- Модель для рациона: `OPENROUTER_MEAL_PLAN_MODEL` (иначе primary LLM). При сбое LLM — fallback на алгоритм.
- Пока данные питания только в браузере: чат с другого устройства не увидит тот же план.
- `set_meal_plan_state` / запись недели — только после явного согласия в чате.
