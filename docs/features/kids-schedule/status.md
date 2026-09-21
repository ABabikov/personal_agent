# Kids Schedule — status

- Таблицы: `kids`, `kid_lessons`, `kid_activities`, `kid_homework`, `kid_grades`, `kid_chat_messages`, `kid_chat_attachments` (миграция `017`), `kid_max_session` (миграция `018`).
- UI: `/kids` — Сегодня / Неделя / Чаты, дети «Мальчик» / «Девочка».
- Бот: `@kidsaa_schedule_bot`, webhook `/api/telegram/kids/webhook`.
- Max: вход по телефону/SMS из вкладки Чаты, сессия в `kid_max_session`, история через `GET /api/kids/max-sync` (при открытии Чаты + cron раз в сутки на Hobby). Локальный демон не нужен.
- Школа НСО: не подключена.
