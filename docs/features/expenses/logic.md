# Expenses Tracker — Logic

Словесное описание того, как реально работает код фичи (держать в синхроне с кодом).

## Страница `/expenses`

`src/components/expenses/expenses-page.tsx` — монолитный клиентский компонент. Грузит счета,
категории и транзакции через `fetchExpensesPeriod` (data layer `src/lib/db/expensesData.ts`),
считает KPI (`totals`), donut по верхнеуровневым категориям (`expensesByParentCategory`),
топ мест (`topMerchants`). Календарь месяца, карточка дня с формой ручного добавления
(`insertManualExpenseTransaction`) и soft-delete (`softDeleteExpenseTransaction`), фильтры,
справочник категорий с добавлением своей (`insertExpenseCategory`). Кнопка «Импорт» — ссылка
на `/expenses/import`. Выбор категории везде — `CategoryPicker`.

## Выбор категории — `CategoryPicker`

`src/components/expenses/category-picker.tsx`. Один виджет вместо прежних `<select>` и
`ExpenseCategoryCombobox` (оба удалены). Кнопка-триггер → поповер в React-портале с
fixed-позиционированием (иначе обрезался бы внутри таблицы импорта с `overflow-auto`). Сверху
строка поиска; пустой запрос показывает верхний уровень, клик по группе с детьми — раскрывает
подкатегории (drill-down), есть кнопка «выбрать группу»; ввод текста — плоский поиск по всему
дереву с путём «Родитель / Ребёнок». Клавиатура (стрелки/Enter/Esc). При `onCreate` и вводе
нового имени — создание категории на лету (в текущем drill-родителе, если он открыт).
Фильтруется по `kind` и `parentsOnly`.

## Импорт — `/expenses/import`

`src/components/expenses/import/expenses-import-page.tsx`. Три шага на одной странице.

**Шаг 1. Файл.** Drag-and-drop или выбор `.xlsx`. Парсинг в браузере —
`parseSberXlsxArrayBuffer` (`src/lib/features/expenses/sberXlsxImport.ts`): ищет шапку
эвристикой, тянет дату/сумму/категорию банка/описание. Из «Описания» вида
«…место совершения операции: RU/City/MERCHANT, MCC: 5411» извлекает `merchant` (последний
сегмент после `/`) и `mcc` — `extractMerchantAndMcc`. **Важно:** в хеш `external_id` идёт только
MCC из отдельной колонки, а не выведенный из описания, — иначе повторный импорт того же файла
задвоил бы уже загруженные операции. Строки подвала выписки («Страница 1 из 1», подпись банка)
молча пропускаются (жалуемся только если в строке есть сумма).

**Шаг 2. Автоопределение.** Переключатель «По истории / ИИ» + кнопка «Определить оставшиеся» +
выбор счёта. Операции группируются `groupOperations` (`importGrouping.ts`): ключ — мерчант
(нормализованный) либо, если мерчанта нет, категория банка; одна группа = одно место трат.
Сразу после разбора файла бесплатный движок «по истории» отрабатывает автоматически.

- **По истории** — `suggestCategory` (`categorySuggest.ts`), чистая функция без сети.
  Порядок доверия: правила `expense_category_rules` (merchant → mcc → bank_category →
  подстрока описания) → аналогия из истории размеченных операций (тот же мерчант, «голова»
  названия, MCC, категория банка, слова описания) → справочник MCC (`mccCatalog.ts`,
  резолвится в существующие категории пользователя по имени). Возвращает `{categoryId, source,
  confidence, reason}` — источник и уверенность видны в UI под каждой группой.
- **ИИ** — `POST /api/expenses/suggest-categories`. На вход идут ГРУППЫ (не строки), поэтому
  один дешёвый вызов. Роут берёт дерево категорий пользователя из БД (server-client), показывает
  модели категории и группы под номерами (меньше токенов, нельзя выдумать несуществующий id),
  вызывает `chatCompletion` (`temperature: 0`), парсит JSON-массив `[{group, category,
  confidence}]`, валидирует индексы и совпадение `kind`. Требует `OPENROUTER_API_KEY`.

**Шаг 3. Предпросмотр и запись.** Список групп: чекбокс «импортировать», раскрытие в строки,
`CategoryPicker` на группу и на строку (строка переопределяет группу). Итог «N операций на
сумму, K без категории». Запись — `upsertSberBankOperations`: чанки по 60, upsert с
`onConflict: user_id,source,external_id, ignoreDuplicates`, возвращает `{inserted, skipped}`
(показывается пользователю). После записи `saveLearnedCategoryRules` сохраняет подтверждённые
связки «мерчант/категория-банка → категория» в `expense_category_rules` (origin: manual, если
пользователь правил подсказку; llm/learned — если оставил как есть); следующий импорт того же
мерчанта не требует ручного выбора.

## Данные

- Таблицы `expense_*` — миграция `009` (+`010` фикс unique). Правила — миграция
  `015_expense_category_rules.sql` (`match_type`, `pattern`, `kind`, `category_id`, `priority`,
  `origin`, `hits`; unique `(user_id, match_type, pattern, kind)`; dev-RLS).
- Data layer: `fetchExpenseCategoryRules`, `fetchCategorizedHistory` (обучающая выборка — все
  операции с проставленной категорией; `bank_category` достаётся из `raw`).
- Мутации: `saveLearnedCategoryRules` (upsert + инкремент `hits`), `upsertSberBankOperations`
  (теперь пишет merchant/mcc и возвращает итог).
- Типы: `ExpenseRuleMatchType`, `ExpenseRuleOrigin` и таблица `expense_category_rules` в
  `src/types/database.ts`.

## Не сделано (следующие шаги)

- Агентские write-тулы для трат и `suggest_category` (логика уже вынесена в общий слой —
  `categorySuggest.ts` переиспользуем).
- UI просмотра/редактирования правил `expense_category_rules`.
- Дедуп Money Manager ↔ банк (soft-link по дате и сумме).
- Бюджеты, инсайты.
