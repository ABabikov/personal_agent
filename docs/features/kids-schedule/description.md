# Kids Schedule

Личное расписание двух детей (мальчик / девочка) в Telegram Mini App.

## Goal

Один экран «Сегодня»: школа + кружки + ДЗ + оценки. Два классных чата Max — как есть, без саммари.

## Data Sources

| Source | Type | Access |
|---|---|---|
| Ручной ввод | UI `/kids` | таблицы `kid_*` |
| Max, 2 чата | user-session зеркало | `kid_chat_messages` |
| school.nso.ru | не подключено | — |
