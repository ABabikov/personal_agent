# Expenses Tracker — Implementation Plan

## Phases

### Phase 1: MVP (ручной ввод + импорт Money Manager + базовая аналитика)

Цель: положить 2-летнюю историю в БД и сделать страницу `/expenses` с фильтрами, таблицей и пай-чартом, плюс минимум для ручной правки/добавления.

- [ ] Миграция `009_expenses_schema.sql`: таблицы `expense_accounts`, `expense_categories`, `expense_transactions`, `expense_imports` + RLS dev-политики (по аналогии с `002_dev_anon_workout_policies.sql`).
- [ ] Скрипт парсинга Money Manager `.xls` (HTML → DOM-парсинг через `node-html-parser` или regex, как в `tmp/inspect_expenses.py`, но на TS).
- [ ] Скрипт `npm run seed:expenses` (`scripts/seed-expenses-from-money-manager.ts`): создаёт счета, категории, подкатегории, льёт операции в БД, помечает `source = 'money_manager'`. Идемпотентность через `external_id = sha1(date|account|category|sub|notes|amount|kind)` + uniq-индекс. По аналогии с `seed-workouts-to-supabase.ts`.
- [ ] Страница `/expenses`:
  - фильтры: период (месяц / квартал / год / произвольно), счёт, категория, тип (доход/расход), поиск по описанию;
  - таблица операций с пагинацией;
  - сводка: сумма доходов / расходов / разница;
  - **pie chart по категориям** (inline SVG, как графики тренировок);
  - помесячная динамика (bar chart).
- [ ] Форма `/expenses/new` — ручное добавление операции (дата, счёт, категория, подкатегория, сумма, заметка).
- [ ] Кнопка «удалить / редактировать» в строке таблицы.
- [ ] Линк из главной (Header / BottomNav) на `/expenses`.

### Phase 2: импорт банковской выписки + автокатегоризация

- [ ] UI `/expenses/import` — drag-and-drop `.xlsx`, превью операций перед записью, ручная правка категории.
- [ ] Парсер Сбер-выписки `parseSberStatementXlsx(buffer)`: пропускает шапку до строки заголовков, читает операции, нормализует сумму (`-260` → расход 260, `+78000` → доход 78000), отделяет статус `HOLD` (не пишет в основную таблицу или пишет с флагом `pending = true`).
- [ ] Таблица `expense_category_rules`: правила «если описание содержит regex / MCC = X → категория Y, подкатегория Z, приоритет N». Seed правил по топ-MCC из текущей выписки (5411→Продукты, 5814→Питание обеды, 5541→Транспортные/АЗС, 5912→Аптеки и т. п.).
- [ ] Алгоритм автокатегоризации при импорте: пройтись по правилам в порядке приоритета, проставить `category_id` если матч; иначе оставить `null` + сохранить `raw_bank_category` (из колонки «Категория» выписки) как подсказку.
- [ ] Журнал импортов в `expense_imports` (источник, файл, период, кол-во новых / пропущенных).

> **Дедуп между Money Manager и банком не делаем.** Пользователь сам обеспечивает непересекающиеся периоды: историческая часть приходит из MM, новые периоды — только из банковской выписки. Внутри одного источника по-прежнему уникальный `(user_id, source, external_id)`.

### Phase 3: агент + инсайты + бюджеты

- [ ] Тулы агента в `src/lib/agent/tools/expenses.ts`:
  - `add_expense_transaction(date, account, category, amount, kind, note?)`
  - `update_expense_transaction(id, …)` / `delete_expense_transaction(id)`
  - `get_recent_expenses(limit, account?, category?)`
  - `get_period_spending(from, to, group_by: 'category'|'subcategory'|'account'|'merchant')`
  - `get_top_categories(period, limit, kind)`
  - `compare_periods(period_a, period_b, group_by)`
  - `find_transactions(query)` — по описанию, категории, диапазону сумм
  - `suggest_category(description, mcc?)` — подсказка категории по правилам
- [ ] Регистрация тулов в `src/lib/agent/tools/index.ts`.
- [ ] Доп. блок в system prompt: краткая сводка трат за текущий месяц (как сейчас для тренировок).
- [ ] Бюджеты `expense_budgets(category_id, period_kind, amount_limit, alert_threshold)`; виджет «израсходовано X из Y».
- [ ] Инсайты на странице `/expenses`: топ-3 категории с самым большим ростом vs прошлый месяц, разовые крупные траты (>2σ от среднего), категории без операций > N дней.

### Phase 4 (опционально)

- [ ] Импорт ещё одного-двух банков (Альфа, Т-банк) по их формату выписок.
- [ ] Переводы между счетами (двойная запись, чтобы не учитывались как расход + доход одновременно).
- [ ] Мульти-валютность (сейчас всё `RUB`; задел в `currency` колонке уже есть).
- [ ] Экспорт в `.csv` / Google Sheets через существующий `backup-supabase-to-google-sheets.ts`.

## Data Model

### `expense_accounts`

| Поле          | Тип            | Назначение                                       |
|---------------|----------------|--------------------------------------------------|
| `id`          | uuid           | PK                                               |
| `user_id`     | uuid           | FK на `users`                                    |
| `name`        | text           | Карта / Кошелёк / Алипей / Банк / ...            |
| `currency`    | text           | `RUB` по умолчанию                                |
| `is_archived` | boolean        | Мягкое отключение                                 |
| `created_at`  | timestamptz    | —                                                |

### `expense_categories`

| Поле          | Тип            | Назначение                                              |
|---------------|----------------|---------------------------------------------------------|
| `id`          | uuid           | PK                                                      |
| `user_id`     | uuid           | FK                                                      |
| `parent_id`   | uuid (null)    | Самоссылка для подкатегорий                              |
| `name`        | text           | Унифицированное название без эмодзи (`Еда`, `Транспорт`) |
| `kind`        | text           | `expense` / `income` / `withdrawal` / `transfer`         |
| `is_archived` | boolean        | Мягкое отключение                                        |
| `created_at`  | timestamptz    | —                                                       |

`(user_id, parent_id, name)` — unique. Эмодзи специально **не** храним: при унификации они уходят, а в UI можно подмешать дефолтный значок по category-kind или name.

### `expense_transactions`

| Поле                  | Тип             | Назначение                                                    |
|-----------------------|-----------------|--------------------------------------------------------------|
| `id`                  | uuid            | PK                                                            |
| `user_id`             | uuid            | FK                                                            |
| `occurred_at`         | timestamptz     | Когда операция реально произошла                              |
| `posted_at`           | timestamptz     | Дата проводки (только для банка, иначе null)                  |
| `account_id`          | uuid            | FK на `expense_accounts`                                      |
| `category_id`         | uuid (null)     | FK на `expense_categories` (null = неотнесённая)              |
| `kind`                | text            | `expense` / `income` / `withdrawal` / `transfer`              |
| `amount`              | numeric(14,2)   | Положительная сумма (тип хранится в `kind`)                   |
| `currency`            | text            | `RUB`                                                         |
| `description`         | text            | Заметка пользователя или описание из банка                    |
| `merchant`            | text (null)     | Извлечённое место (для банка из `Описание`, без MCC)          |
| `mcc`                 | text (null)     | MCC-код (только для банка)                                    |
| `source`              | text            | `manual` / `money_manager` / `bank_sber` / `agent`            |
| `external_id`         | text (null)     | Стабильный ID/хэш в источнике для дедупа                       |
| `linked_transaction_id` | uuid (null)   | Для переводов / возможных дублей между источниками            |
| `raw`                 | jsonb (null)    | Исходная строка импорта (для отладки)                          |
| `pending`             | boolean         | `true` для `HOLD` из выписки                                  |
| `deleted_at`          | timestamptz     | Soft delete (как у workouts)                                  |
| `created_at` / `updated_at` | timestamptz | Аудит                                                        |

Индексы: `(user_id, occurred_at desc)`, `(user_id, category_id)`, `(user_id, account_id)`, unique `(user_id, source, external_id)` (полный индекс без `WHERE` — иначе PostgREST upsert не находит arbiter).

### `expense_category_rules` (Phase 2)

| Поле           | Тип       | Назначение                                                      |
|----------------|-----------|-----------------------------------------------------------------|
| `id`           | uuid      | PK                                                              |
| `user_id`      | uuid      | FK                                                              |
| `priority`     | int       | Меньше — раньше; первая совпавшая выигрывает                    |
| `mcc`          | text      | Если задан — матч по MCC                                        |
| `match_regex`  | text      | Регэксп по `description` (или `merchant`)                       |
| `category_id`  | uuid      | Куда отнести                                                    |
| `note`         | text      | Комментарий, зачем правило                                      |
| `is_active`    | boolean   | —                                                               |

### `expense_imports`

| Поле              | Тип             | Назначение                                                |
|-------------------|-----------------|----------------------------------------------------------|
| `id`              | uuid            | PK                                                        |
| `user_id`         | uuid            | FK                                                        |
| `source`          | text            | `money_manager` / `bank_sber` / `manual` / ...           |
| `file_name`       | text            | Исходный файл                                             |
| `period_from`     | date            | —                                                         |
| `period_to`       | date            | —                                                         |
| `rows_total`      | int             | Сколько строк было в файле                               |
| `rows_inserted`   | int             | Новых записей                                            |
| `rows_skipped`    | int             | Дублей пропущено                                         |
| `rows_suspicious` | int             | Возможные дубли между источниками                         |
| `created_at`      | timestamptz     | —                                                         |

### `expense_budgets` (Phase 3)

| Поле              | Тип             | Назначение                                                |
|-------------------|-----------------|-----------------------------------------------------------|
| `id`              | uuid            | PK                                                        |
| `user_id`         | uuid            | FK                                                        |
| `category_id`     | uuid (null)     | null = бюджет на всё                                       |
| `period_kind`     | text            | `monthly` / `weekly` / `yearly`                            |
| `amount_limit`    | numeric(14,2)   | —                                                         |
| `alert_threshold` | numeric (0..1)  | Например 0.8 → дёргать инсайт при 80% от лимита            |
| `active`          | boolean         | —                                                         |

## Money Manager Import — Details

1. Прочитать файл как UTF-8 HTML, найти единственную `<table>`, разобрать `<tr>` → массив ячеек.
2. Первая строка — заголовки; остальные — операции.
3. Для каждой строки:
   - распарсить дату `DD/MM/YYYY HH:MM:SS` → `occurred_at`;
   - очистить `Категория` от ведущих эмодзи / непечатных символов → `mmCategoryName` (например, `🍜 Питание обеды` → `Питание обеды`);
   - применить **категориальный маппинг** `scripts/expenses/categoryMap.ts`: `(mmCategoryName, mmSub) → { targetCategory, targetSub, kindOverride? }`; если пары нет в маппинге — кидаем ошибку в `dry-run` (пользователь должен заполнить), а в обычном прогоне без `--allow-unmapped` — фейлим импорт целиком;
   - найти/создать `account` по имени;
   - найти/создать `category` (parent — `targetCategory`, child — `targetSub` если есть);
   - `kind`: `Расход → expense`, `Доход → income`, `Снятие → withdrawal` (или `kindOverride` из маппинга);
   - сумма из колонки RUB (всё уже в RUB);
   - сформировать `external_id = sha1(date_iso + '|' + account + '|' + raw_category + '|' + raw_sub + '|' + notes + '|' + amount + '|' + kind)` — на основе **исходных** значений MM, чтобы повторный запуск был стабилен даже если маппинг поменяется;
   - INSERT с `on conflict (user_id, source, external_id) do nothing`.
4. В конце записать строку в `expense_imports` со сводкой.

Workflow:

1. `npm run seed:expenses:dry -- --print-unmapped` → выводит все распарсенные пары `(категория, подкатегория)` из MM, которых ещё нет в маппинге, в формате готового TS-фрагмента.
2. Пользователь копирует фрагмент в `scripts/expenses/categoryMap.ts`, правит таргет-категории.
3. `npm run seed:expenses:dry` → парсит весь файл, применяет маппинг, печатает сводку (по итоговым категориям, числу операций), но **не пишет в БД**.
4. `npm run seed:expenses` → пишет в БД.

## Sber Statement Import — Details

1. `xlsx` → `ws[0]` (`Sheet1`).
2. Найти строку, где первая колонка = `Дата операции` — это шапка таблицы (~строка 20 в текущем образце, но искать по содержимому, не по индексу).
3. Дальше идут операции. Парсим:
   - `occurred_at` = `Дата операции` (DD.MM.YYYY);
   - `posted_at` = `Дата проводки` (`HOLD` → null, `pending = true`);
   - `amount` = abs(`Сумма в валюте счёта`); если оригинальное значение `< 0` → `kind = expense`, иначе `income`;
   - `description` = колонка «Описание»;
   - `mcc` = регэкспом `MCC:\s*(\d{3,4})` из описания;
   - `merchant` = из описания между `место совершения операции:` и `, MCC:`, опционально нормализовать (`RU/Novosibirsk/SOLNECHNYJ DEN` → `SOLNECHNYJ DEN`);
   - `external_id` = код операции из колонки `Код` (`CRD_4W52FC`, `A012904260047788`); если код пустой — sha1 от строки.
4. Прогнать `expense_category_rules` для автокатегоризации.
5. После основного импорта — поискать в БД возможные совпадения с операциями из `money_manager` за `±2 дня` и той же `abs(amount)`; если нашли — записать `linked_transaction_id` и поставить `rows_suspicious`.

## Charts

Без сторонних библиотек на старте — продолжаем стиль `workout-tracker` (inline SVG):

- **Pie / donut** по категориям за период.
- **Bar** — помесячный итог расходов / доходов.
- **Line** — динамика выбранной категории по месяцам.

Когда упрёмся в сложность (стэкнутые столбцы, легенды, hover) — подключим `recharts`, который уже стоит в плане трекера.

## Agent Tools

Минимальный набор (Phase 3) — см. список в фазах выше. Каждый тул:

- читает через service-role / dev-RLS как остальные тулы (`src/lib/agent/tools/*`),
- возвращает компактный JSON, годный для использования в ответе модели (без лишних raw-полей).

Пример `get_period_spending` возвращает `{ from, to, total_expense, total_income, by_category: [{ name, emoji, amount, share }] }` — этого достаточно, чтобы агент сразу сформулировал ответ.

## Technical Decisions

| Decision                | Choice                                  | Rationale                                                                 |
|-------------------------|-----------------------------------------|---------------------------------------------------------------------------|
| Storage                 | Supabase (PostgreSQL)                   | Уже стоит, тот же стек, единое RLS-поведение                              |
| Currency                | `RUB` сейчас, поле `currency` в схеме    | На старте без конвертации; задел на будущее                                |
| Дедуп при импорте       | `external_id` + uniq-индекс             | `on conflict do nothing` — идемпотентно, дёшево                            |
| Дедуп между источниками | Не делаем                                | Пользователь гарантирует непересекающиеся периоды MM ↔ банк                |
| Категории               | Унифицированные, в коде маппинг MM→target | Сразу чистая аналитика без эмодзи в названиях                              |
| Автокатегоризация       | Таблица правил (MCC + regex), приоритет | Прозрачнее ML, можно править руками; ML — позже                            |
| Парсер `.xls` (MM)      | Регэксп / `node-html-parser`            | Это HTML, а не реальный xls — нет смысла тянуть xlrd                       |
| Парсер `.xlsx` (Сбер)   | `xlsx` (SheetJS) или `exceljs`          | Нужен readonly, обе библиотеки умеют                                       |
| Графики                 | Inline SVG (на старте)                  | Так же, как для тренировок; без новых зависимостей                          |
| Удаление операций       | Soft delete (`deleted_at`)              | По аналогии с миграцией `004_workouts_soft_delete.sql`                     |

## Dependencies

- **External:** ни одного нового API. SheetJS (`xlsx`) или `exceljs` ставится разово.
- **Internal:**
  - `users` (для `user_id`) — есть.
  - Тот же паттерн RLS-dev-политик, как у workouts.
  - Agent loop из `agent-core` — Phase 3.

## Risks

| Risk                                                      | Impact                                       | Mitigation                                                                 |
|-----------------------------------------------------------|----------------------------------------------|-----------------------------------------------------------------------------|
| Money Manager сменит формат экспорта                       | Парсер ломается на следующем апдейте          | Версионирование парсера + хранение `raw` jsonb для отладки                  |
| Дубли между MM и банком при наложении периодов             | Двойной счёт расходов в аналитике             | `external_id` + мягкий матч `(±2 дня, abs(amount))` + ручное подтверждение  |
| MCC-категоризация ошибается на нестандартных мерчантах     | Часть операций без категории / в чужой       | Правила правятся руками; «неотнесённые» отдельным фильтром в UI             |
| Большой объём данных тормозит на клиенте                   | UX страдает                                   | Серверная агрегация (SQL `group by`) для чартов, на клиенте только готовое  |
| Чувствительность данных                                    | Утечка финансовой истории                     | Boevoy режим: service-role + строгий RLS по `auth.uid()`, как в трекере     |
| Heuristic «снятие» vs «расход»                             | Кэш ATM считается расходом                    | Отдельный `kind = 'withdrawal'` + по умолчанию исключать из «расходов» в чартах |
