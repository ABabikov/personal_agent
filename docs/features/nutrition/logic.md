# Как работает дневник

Экран `/nutrition` и тулы агента вызывают `src/lib/db/nutrition.ts`. Формула нормы — `computeDayTarget` в `src/lib/features/nutrition/targets.ts`. КБЖУ блюда — `dishPer100`.

Поиск: `POST /api/nutrition/search` читает свои продукты и карточки magnit.ru. Запись в чате (`log_food`, `log_weight`, `save_dish`, `save_nutrition_settings`, `delete_food_log`) только после явного подтверждения — это правило системного промпта, не отдельный флаг в коде.
