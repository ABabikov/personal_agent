# Kids Schedule

Личное расписание двух детей (мальчик / девочка) в Telegram Mini App.

## Goal

Один экран «Сегодня»: школа + кружки + ДЗ + оценки. Два классных чата Max — как есть, без саммари.

## Data Sources

| Source | Type | Access |
|---|---|---|
| Ручной ввод | UI `/kids` | таблицы `kid_*` |
| Max, 2 чата | user-session на Vercel: вход по телефону/SMS в Mini App, poll + cron | `kid_chat_messages`, `kid_max_session` |
| school.nso.ru | не подключено | — |
