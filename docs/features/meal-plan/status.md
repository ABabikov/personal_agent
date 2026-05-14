# Meal Plan & Shopping — статус

## Current Phase: прототип UI + агент (localStorage)

## Status

- **Требования** — `description.md`, `plan.md` (в т.ч. раздел «Интеграция с чатом»).
- **UI `/meal-plan`:** цели КБЖУ, **настраиваемые слоты приёмов**, коридор дефицита ккал, база продуктов, каталог сидов, план порций, список покупок — `localStorage`.
- **Чат:** тулы `get_meal_plan_state`, `set_meal_plan_state`; клиент шлёт `mealPlan` в `POST /api/chat`; после `set_*` успех — автозапись в `localStorage` и событие обновления страницы питания.

## Progress

| Task | Status |
|------|--------|
| `description.md` / `plan.md` / интеграция с агентом в доках | Done |
| Тулы `get_meal_plan_state`, `set_meal_plan_state` + реестр | Done |
| `mealPlan` в API + `ToolContext` + `loop` | Done |
| Клиент: прикрепление снимка + применение ответа тула | Done |
| План по дням + календарь | Not Started |
| Коридор КБЖУ «ниже проги» (формула) + баланс с тренировками/часами | Not Started |
| Рецепты из интернета + кеш | Not Started |
| Supabase вместо localStorage | Not Started |
| Интеграции магазинов / автозаказ | Not Started |

## Notes

- Пока данные питания только в браузере: чат с другого устройства не увидит тот же план, пока не будет синхронизация через БД.
- `set_meal_plan_state` не заменяет явное согласие в переписке — правило задано в system prompt (как для `save_*` в БД).
