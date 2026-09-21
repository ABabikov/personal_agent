# Kids Schedule — status

- Таблицы: `kids`, `kid_lessons`, `kid_activities`, `kid_homework`, `kid_grades`, `kid_chat_messages`, `kid_chat_attachments` (миграция `017`), `kid_max_session` (миграция `018`).
- UI: `/kids` — Сегодня / Неделя / Чаты, дети «Мальчик» / «Девочка».
- Бот: `@kidsaa_schedule_bot`, webhook `/api/telegram/kids/webhook`.
- Max: вход по телефону/SMS из вкладки Чаты, сессия в `kid_max_session`.
- Синк: при открытии Чаты + GitHub Actions каждые 5 минут (`kids-max-poll.yml`) + суточный cron Vercel.
- Уведы: новые сообщения из двух чатов → `@kidsaa_schedule_bot` (нужны `TELEGRAM_KIDS_BOT_TOKEN` на Vercel и один `/start`).
- Школа НСО: не подключена.
