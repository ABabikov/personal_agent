# Workout Tracker — Logic (как это работает на самом деле)

Документ описывает _реальную_ реализацию фичи в репозитории (на 2026-05-11). Бизнес-цели — в [`description.md`](description.md), план фаз — в [`plan.md`](plan.md), статус задач — в [`status.md`](status.md).

---

## 1. Карта кода

```
src/
├── app/
│   ├── layout.tsx                          # корневой layout (шрифты, html lang="ru")
│   ├── (web)/
│   │   ├── layout.tsx                      # Header + контейнер + BottomNav
│   │   ├── page.tsx                        # → WorkoutCalendarHome (главная)
│   │   ├── gym/page.tsx                    # форма силовой
│   │   ├── swim/page.tsx                   # форма плавания
│   │   ├── profile/page.tsx                # параметры + BMR/TDEE (load + upsert в users)
│   │   └── chat/page.tsx                   # заглушка «Скоро»
│   ├── (tma)/layout.tsx                    # пустой каркас под Telegram Mini App
│   ├── api/                                # пока пусто (chat/features/webhooks — будущее)
│   └── globals.css                         # tailwind + цветовые токены (--gym, --swim, --chart-1..5)
├── components/
│   ├── ui/                                 # shadcn-примитивы (Button, Card, Input, Label, Table)
│   ├── navigation/                         # Header / BottomNav (5 пунктов)
│   ├── workout-calendar-home.tsx           # главная: период, календарь, день, статистика, графики
│   ├── workout/                            # exercise-card / swim-series-card / total-card
│   ├── calendar/
│   │   ├── period-switcher.tsx             # «Месяц / Год / Всё»
│   │   ├── month-grid.tsx                  # сетка месяца с маркерами зал/плав + навигация
│   │   ├── day-detail.tsx                  # детали выбранного дня (упражнения, серии, заметки)
│   │   └── exercise-selector.tsx           # чипы для выбора упражнения в графике
│   ├── charts/
│   │   └── line-chart.tsx                  # SVG line-chart с hover-тултипом, поддержка нескольких серий
│   └── dashboard/                          # резервные мини-компоненты
├── lib/
│   ├── utils.ts                            # cn() через tailwind-merge
│   ├── db/
│   │   ├── supabase.ts                     # createClient<Database>(URL, ANON_KEY)
│   │   ├── workoutUserId.ts                # определение user_id (env → ls → insert)
│   │   ├── saveWorkout.ts                  # запись gym/swim в Supabase
│   │   ├── listWorkouts.ts                 # выборка тренировок и недельная агрегация
│   │   ├── fetchLastWorkoutTemplates.ts    # последняя тренировка как «шаблон»
│   │   ├── calendarData.ts                 # workouts + gym_exercises + swim_series за period
│   │   └── profile.ts                      # loadUserProfile / saveUserProfile (upsert)
│   └── features/
│       ├── workouts/
│       │   ├── tonnage.ts                  # exerciseTonnage / totalTonnage
│       │   ├── gymProgression.ts           # +1 повт; ≥18 → +вес, reps=12
│       │   ├── gymFormFromSeed.ts          # ParsedGymWorkout → форма
│       │   ├── swimFormFromSeed.ts         # ParsedSwimWorkout → форма
│       │   ├── csvImport.ts                # парсер CSV вкладок Google Sheets
│       │   ├── calories.ts                 # BMR / TDEE / MET / ACTIVITY_LEVELS
│       │   └── analytics.ts                # агрегации: weekday-серии, exercise dynamics, totals
│       └── swimming/distance.ts            # totalDistance()
├── types/database.ts                       # ручные DB-типы для supabase-js
├── supabase/migrations/                    # 001 + 002 (dev RLS)
└── scripts/seed-workouts-to-supabase.ts    # офлайн-импорт CSV → Supabase
```

UI-фичи лежат в `app/(web)/...`, бизнес-логика — в `lib/features/...` и `lib/db/...`. UI и (в будущем) агент будут вызывать одни и те же функции из `lib/`.

---

## 2. Модель данных (Supabase)

Все таблицы созданы миграцией `001_initial_schema.sql`. RLS включён, но в DEV-режиме открыт всем (`002_dev_anon_workout_policies.sql`).

- **`users`** — телефонный/возраст/вес/рост/пол/`activity_level`/`body_fat_pct`. Telegram_id уникален, но пока не используется. Auth ещё нет.
- **`workouts`** — единая таблица для силовых и плавательных: `type ∈ {gym, swim}`, `date`, `body_weight`, `total_tonnage` (для зала), `total_distance` (для плавания), `calories_estimated`, `notes`, `created_at`. Индексы: `(user_id, date)` и `type`.
- **`gym_exercises`** — деталь силовой: `exercise_name`, `order_index`, `sets jsonb` (массив `{weight, reps}`), `tonnage`. Каскадно удаляется с `workouts`.
- **`swim_series`** — деталь плавания: `order_index`, `distance` (м), `description` (свободный текст). Каскадно удаляется с `workouts`.
- **`workout_plans`** — шаблоны по дню недели (`day_of_week 0..6`), массив `PlanExercise` (`exercise_name`, `target_sets`, `target_reps_min/max`, `last_weight`). DB-объект готов, UI ещё нет.

Типы TS в `src/types/database.ts` написаны вручную и параметризуют `createClient<Database>`.

### Определение `user_id` (`lib/db/workoutUserId.ts`)

Auth ещё не подключён, поэтому каждый клиент должен «знать», под каким `users.id` сохранять. Алгоритм:

1. Если задан `NEXT_PUBLIC_WORKOUT_USER_ID` — используется он (полезно для общего dev-аккаунта).
2. Иначе берём из `localStorage` ключ `personal_agent_workout_user_id`.
3. Если и его нет — вставляем пустую строку `users` через `anon`-ключ и кешируем её id в `localStorage`.

Если шаг 3 валится (например, не открыты RLS-политики), в UI показывается ошибка с подсказкой про политики и переменную окружения.

---

## 3. Записи в БД (`lib/db/saveWorkout.ts`)

### Силовая (`saveGymWorkoutToSupabase`)

1. Резолвится `user_id` (см. выше).
2. Из формы фильтруются пустые подходы (`weight > 0 && reps > 0`), отбрасываются упражнения без названия или подходов.
3. На каждое упражнение считается тоннаж `Σ weight × reps`, на тренировку — сумма тоннажей, округление до 0.1.
4. INSERT в `workouts` (`type='gym'`, `body_weight`, `total_tonnage`, `notes`).
5. INSERT в `gym_exercises` (массивом). Если упало — `workouts` откатывается (`delete().eq("id", workout.id)`).

Ошибки возвращаются как `{ error: string }`, успех — `{ ok: true }`.

### Плавание (`saveSwimWorkoutToSupabase`)

1. Резолвится `user_id`.
2. Фильтруются серии с `distance > 0`, описание тримится.
3. Считается `total_distance = Σ distance`.
4. INSERT в `workouts` (`type='swim'`, `total_distance`, `notes`).
5. INSERT в `swim_series` (массивом). Аналогичный rollback при ошибке.

---

## 4. Чтение и агрегация

### Базовые выборки (`lib/db/listWorkouts.ts`)
- `mondaySundayYYYYMMDD(ref?)` — границы понедельник–воскресенье текущей недели.
- `fetchWorkoutsInDateRange(userId, start, end)` — `SELECT *` из `workouts` за диапазон.
- `fetchRecentWorkouts(userId, limit=50)` — последние N тренировок.
- `aggregateWeekStats(rows)` — суммирует `total_tonnage` (gym) и `total_distance` (swim) + счётчик. Используется наследием/прочими местами.

### Период со всеми деталями (`lib/db/calendarData.ts`)
- `monthBounds(year, monthIdx0)` / `yearBounds(year)` — границы периода (`YYYY-MM-DD`).
- `fetchPeriodData(userId, scope, { year, monthIdx0 })` — одним вызовом:
  1. `workouts` за период (или без фильтра при `scope='all'`).
  2. `gym_exercises` и `swim_series`, отфильтрованные по `workout_id IN (…)`, оба запроса параллельно.
- Возвращает `PeriodData = { workouts, gymExercises, swimSeries }`.
- Используется главной для построения календаря, статистики и всех графиков.

### Аналитика (`lib/features/workouts/analytics.ts`)
- `isoLocalDate(date)` — локальный `YYYY-MM-DD` (без TZ-сдвигов).
- `dateFromIso(iso)` — Date в полдень того же дня.
- `weekdayIdx(iso)` — JS-day (0=вс…6=сб); словари `WEEKDAY_RU_SHORT/LONG`.
- `workoutsByDate(workouts)` — `Map<date, WorkoutRow[]>` для маркеров и деталей дня.
- `gymByWorkout` / `swimByWorkout` — `Map<workout_id, rows>` для деталей.
- `uniqueExerciseNames(rows)` — список упражнений отсортированный по убыванию частоты, потом по алфавиту.
- `periodTotals(data)` — `{ workouts, gymWorkouts, swimWorkouts, totalTonnage, totalDistance }`.
- `tonnageByWeekday(workouts)` — массив `WeekdaySeries[]`: для каждого weekday → хронологический ряд точек `{date, value}` (только gym, только тренировки с `total_tonnage`).
- `workingWeight(sets)` — max веса среди подходов с `reps ≥ 1`.
- `exerciseDynamics(name, exercises, workouts)` → `{ tonnage: SeriesPoint[], weight: SeriesPoint[] }` — динамика тоннажа упражнения и его рабочего веса по тренировкам периода.

---

## 5. Формы тренировок

### `/gym` (`app/(web)/gym/page.tsx`)

При монтировании страницы вызывается `refreshLast()`:
1. Получаем `user_id` (`getWorkoutUserId`).
2. `fetchLastGymWorkoutFromDb(user.userId)` — последняя силовая (`type='gym'`) + её `gym_exercises` (по `order_index`), собирается в `ParsedGymWorkout` (`date`, `bodyWeight`, `exercises[]`, `totalTonnage`).
3. Результат становится «шаблоном» для `GymWorkoutEditor`.

Внутри редактора:
- Начальное состояние — из последней тренировки с прогрессией (`gymWorkoutToExerciseInputs(last, true)`), если её нет — одно пустое упражнение с 4 пустыми подходами.
- Над формой две кнопки:
  - **«С прогрессией (+1 повт)»** — `progressGymSets`: ко всем повторам прибавляется 1; если хотя бы один подход достиг 18+, вес поднимается (`bumpWorkingWeight`) и повторы выставляются в 12.
  - **«Как было»** — копия последних подходов без изменений.
- Поля: дата (по умолчанию сегодня), вес тела (`30..200`, шаг 0.1).
- Каждое упражнение — `ExerciseCard`: название + таблица с подходами (до 6, добавить/удалить — иконки `+`/`−`), снизу плашка тоннажа упражнения (`exerciseTonnage(parsed sets)`).
- Внизу — `TotalCard` с общим тоннажем (`totalTonnage(summaries)`).
- Заметки — textarea.
- Кнопка «Сохранить тренировку» вызывает `saveGymWorkoutToSupabase(...)`. После успеха — статус «Сохранено», через 2 с возврат в `idle`, вызывается `onSaveSuccess` → `refreshLast()` (чтобы следующее открытие сразу подсказывало с прогрессией от нового максимума).

### `/swim` (`app/(web)/swim/page.tsx`)

Симметрично:
1. `fetchLastSwimWorkoutFromDb(user.userId)` — последняя плавательная + `swim_series` по `order_index`.
2. В редакторе одна кнопка **«Подставить последнюю из базы»**.
3. Каждая серия — `SwimSeriesCard`: поле дистанции (м, шаг 25) + строка описания + чипы-подсказки (`кроль`, `брасс`, `ласты`, `лопатки`, `колобашка`, `80%`, `отдых 30"`), клик по чипу аппендит токен к описанию.
4. `TotalCard` со счётчиком метров.
5. Кнопка сохранения вызывает `saveSwimWorkoutToSupabase(...)`.

---

## 6. Главная: календарь, период, статистика, графики (`components/workout-calendar-home.tsx`)

Главная теперь — настоящий tracker-dashboard:

1. **Period switcher** (`Месяц / Год / Всё`) — `components/calendar/period-switcher.tsx`. Меняет `scope`, под капотом перетягивает данные через `fetchPeriodData(userId, scope, { year, monthIdx0 })`.
2. **Навигация по периоду:**
   - `Месяц`: стрелки `‹ Май 2026 ›` внутри `MonthGrid`; стрелка вне диапазона переключает год.
   - `Год`: стрелки `‹ 2026 ›` вверху панели.
   - `Всё`: фильтра нет.
3. **Сводка-плашки** (3 шт.) — `totals.workouts` (с разбивкой `зал/плав`), `totalTonnage`, `totalDistance` за период.
4. **Quick-add** — две большие кнопки «Добавить силовую/плавание» → `/gym`, `/swim` (сохранены из старой версии).
5. **MonthGrid** (`components/calendar/month-grid.tsx`):
   - Понедельник как первый день недели, начинается с предыдущего месяца если 1-е не понедельник.
   - На каждой ячейке — число + точки-маркеры: оранжевая (`--gym`) и/или синяя (`--swim`), если в этот день есть тренировки.
   - Сегодняшний день обведён `ring-primary/60`, выбранный — заполнен `bg-primary`.
   - Клик по любой ячейке (даже из соседнего месяца) — выставляет `selectedDate` в формате `YYYY-MM-DD`.
6. **DayDetail** (`components/calendar/day-detail.tsx`):
   - Заголовок: «12 мая 2026 · понедельник».
   - Для каждой тренировки выбранного дня:
     - **gym**: иконка + «Силовая» + общий тоннаж; вес тела; список упражнений в формате `название · 50×8 · 50×8 · …  → 800 кг`; заметки.
     - **swim**: иконка + «Плавание» + общий метраж; список серий `100 м · описание`; заметки.
   - Если в выбранный день тренировок нет — «В этот день тренировок не было».
7. **Графики** (`components/charts/line-chart.tsx`, простой SVG без сторонних зависимостей):
   - **Тоннаж по дням недели** — `tonnageByWeekday(workouts)` группирует силовые по `weekday` и отдаёт хронологический ряд точек. Каждый weekday — отдельная серия со своим цветом из палитры `--chart-1..5` (для пн/ср/пт обычно достаточно). Один и тот же график показывает «жимовой день» отдельно от «тягового» — то, что просили.
   - **Динамика тоннажа упражнения** — селектор-чипы (`ExerciseSelector`) с уникальными названиями из периода, по умолчанию выбрано самое частое. На клик — `exerciseDynamics(name).tonnage`.
   - **Рабочий вес упражнения** — отдельный селектор и `exerciseDynamics(name).weight` (max-веса по тренировкам).
8. **Пустой период** — если `totals.workouts === 0`, под графиками показывается карточка с UUID профиля и кнопкой «Скопировать», чтобы можно было разнести один UUID между `.env` (для seed-скрипта) и браузером.
9. **«К текущему месяцу/году»** — быстрый возврат при навигации стрелками.

### `LineChart`
- Принимает массив `series: { id, label, color, points: { date, value }[] }`.
- Авто-границы по X (даты) и Y (значения с 10% паддингом).
- Сетка из 4 горизонтальных меток, форматирование чисел через `toLocaleString('ru')`.
- Hover на точке → тултип с датой и значением + вертикальный гайд.
- Если ни в одной серии нет точек — показывает `emptyMessage`.
- Адаптивный SVG `viewBox`, легко вписывается в карточку любой ширины.

---

## 7. Профиль и калькулятор калорий (`/profile`, `lib/features/workouts/calories.ts`, `lib/db/profile.ts`)

Страница теперь полноценно работает с БД:

- `calculateBMR(weight, height, age, gender)` — формула Mifflin-St Jeor:
  - М: `10W + 6.25H − 5A + 5`
  - Ж: `10W + 6.25H − 5A − 161`
- `calculateBMRKatchMcArdle(weight, bodyFatPct)` — `370 + 21.6 × leanMass`, где `leanMass = W·(1 − BF/100)`. Используется опционально, если введён % жира.
- `calculateTDEE(bmr, activityLevel)` — `bmr × коэффициент`.
- `ACTIVITY_LEVELS` — список из 5 пресетов (1.2 / 1.375 / 1.55 / 1.725 / 1.9), отрисовываются как карточки-радиоселекторы.
- `MET_VALUES` — таблица MET для зала (light/moderate/heavy/circuit) и плавания (light/moderate/heavy/breaststroke/butterfly).
- `caloriesPerMinute(met, weightKg) = met × 3.5 × W / 200`.
- `estimateWorkoutCalories(met, weightKg, durationMinutes)` — округлённое число калорий за тренировку.

UI: при монтировании страница тянет профиль из Supabase (`loadUserProfile(userId)` → `SELECT * FROM users WHERE id = …`) и подставляет его в форму. При сохранении вызывается `saveUserProfile(userId, profile)` — это `upsert` по `id`, поэтому работает даже если строка `users` ещё пустая (например, UUID задан в `.env`, а в БД его нет). После успеха кнопка показывает «Сохранено», состояние сбрасывается через 2 с.

Если у пользователя задан `% жира` — приоритет получает формула Katch-McArdle, иначе используется Mifflin-St Jeor; в подвале плашки видно, какая формула применилась.

---

## 8. Методика расчёта калорий за тренировку

Файл: `lib/features/workouts/calories.ts`. Используется во всём приложении: `/gym` показывает прогноз в реальном времени, `saveGymWorkoutToSupabase` пишет результат в `workouts.calories_estimated`, главная и `DayDetail` отображают это число.

### 8.1. Базовая формула — MET (Compendium of Physical Activities, Ainsworth et al. 2011)

```
ккал/мин = MET × 3.5 × вес_кг / 200
ккал     = ккал/мин × длительность_мин
```

MET — Metabolic Equivalent of Task: множитель к покою (1 MET ≈ 3.5 мл O₂/кг/мин ≈ ~1 ккал/кг/час).

В коде это `caloriesPerMinute(met, weightKg)` и `estimateWorkoutCalories(met, weightKg, durationMin)` — общие функции, по которым строятся как зал, так и плавание (когда будет реализовано).

### 8.2. Силовые: `estimateGymCalories(input)`

#### Длительность тренировки
- Если пользователь явно ввёл длительность в поле «Длительность» формы `/gym` — она используется.
- Иначе работает авто-оценка: `длительность ≈ N_подходов × 4.5 мин` (`GYM_MINUTES_PER_SET = 4.5`).
  Калибровано под реальный темп: 30–45 мин на пару упражнений (≈ 8 рабочих подходов) → ~4.5 мин/подход, включая отдых.

#### Категория интенсивности → MET
Считаем «плотность работы» — тоннаж в минуту, нормализованный к 80 кг веса тела:

```
density = (tonnage / durationMin) × (80 / bodyWeightKg)
```

Пороги (`GYM_DENSITY_THRESHOLDS`):

| density (кг·мин⁻¹) | категория        | MET   |
|--------------------|------------------|-------|
| < 80               | light (лёгкая)    | 3.5   |
| 80 – 150           | moderate (гипертрофия) | 5.0 |
| 150 – 250          | heavy (тяжёлая)   | 5.8   |
| > 250              | circuit (круговая)| 7.5   |

MET-значения берутся из `MET_VALUES.gym` и соответствуют записям Compendium’а (#02050–02053).

#### EPOC (afterburn)
Силовая тренировка имеет ощутимый «расход после» (excess post-exercise oxygen consumption — повышенное потребление кислорода в течение 24–48 ч). Поверх MET-формулы накидываем фиксированные **+7%** (`GYM_EPOC_MULTIPLIER = 1.07`). Это нижняя граница диапазона из литературы (6–15%) — консервативно, чтобы не завышать.

#### Перекрёстная валидация по тоннажу
Параллельно считается эмпирическая оценка:

```
kcal_tonnage = 0.09 × tonnage × (вес_кг / 80)
```

Коэффициент 0.09 даёт ~90 ккал на 1000 кг тоннажа для атлета 80 кг — это согласуется со здравым смыслом и многими калькуляторами. Используется только как «вторая цифра рядом» — если она расходится с основной более чем в 2 раза, стоит проверить данные.

#### Итоговая формула

```
kcal_base = (MET × 3.5 × bodyWeightKg / 200) × durationMin
kcal      = round(kcal_base × 1.07)              ← это идёт в БД и UI
```

#### Вес тела для расчёта
1. Поле «Вес тела» в форме `/gym` (самое актуальное на день тренировки).
2. Иначе — `users.weight` из профиля.
3. Если оба пусты — `calories_estimated = null`, в UI выводится подсказка заполнить вес.

### 8.3. Возвращаемые поля `GymCalorieEstimate`

| Поле                    | Что значит                                                    |
|-------------------------|---------------------------------------------------------------|
| `calories`              | Итог в ккал, с EPOC. Это то, что пишется в `workouts.calories_estimated`. |
| `caloriesRaw`           | Без EPOC, для прозрачности (отладки).                          |
| `durationMin`           | Использованная длительность (auto или override).               |
| `durationFromOverride`  | `true`, если пользователь ввёл значение вручную.               |
| `intensity` + `met`     | Автоматическая категория и MET.                                |
| `density`               | Плотность работы (для UI/отладки).                             |
| `tonnageBasedCalories`  | Альтернативная оценка по тоннажу для сверки.                   |
| `tonnage`, `setCount`   | Размер выборки.                                                |

### 8.4. Плавание
Для swim таблица MET (`MET_VALUES.swim`) уже подготовлена (`light 5.8`, `moderate 8.0`, `heavy 9.8`, `breaststroke 10.3`, `butterfly 13.8`), но автоматический расчёт ещё не подключён — на форме `/swim` нет ни длительности, ни авто-оценки от метража. Это следующий шаг (нужна формула «темп → длительность», например `25 м/мин` для умеренного темпа).

### 8.5. Когда подключим Huawei Health (Phase 2)
MET-метод останется только как fallback. Точнее всего — формула **Keytel et al. (2005)** по средней ЧСС:

- М: `kcal/мин = (-55.0969 + 0.6309·HR + 0.1988·W + 0.2017·A) / 4.184`
- Ж: `kcal/мин = (-20.4022 + 0.4472·HR − 0.1263·W + 0.074·A) / 4.184`

`HR` — средняя ЧСС за тренировку, `W` — вес кг, `A` — возраст. Подменим источник `calories_estimated` на это при наличии данных с часов.

### 8.6. Литература (для проверки и обновления коэффициентов)
- Ainsworth et al., «2011 Compendium of Physical Activities» — MET-таблицы.
- Keytel et al., «Prediction of energy expenditure from heart rate monitoring during submaximal exercise» (J. Sports Sci., 2005).
- Børsheim, Bahr, «Effect of exercise intensity, duration and mode on post-exercise oxygen consumption» (Sports Med., 2003) — EPOC 6–15%.

---

## 9. Импорт CSV из Google Sheets (`lib/features/workouts/csvImport.ts` + `scripts/seed-workouts-to-supabase.ts`)

Источник: 6 CSV-экспортов вкладок (`пн`, `вт`, `ср`, `чт`, `пт`, `сб`), сложенных в `docs/features/workout-tracker/current_stat/resources/`.

### Парсер CSV

- `splitCsvLine` — построчный разбор с поддержкой кавычек и экранирования `""`.
- `parseDateCell` — узнаёт два формата: `DD.MM.YYYY` (`parseEuDate`) и `MM/DD/YYYY` (`parseUsDate`), нормализует в ISO `YYYY-MM-DD`.
- `parseFlexibleNumber` — поддерживает запятые как десятичный разделитель, пробелы внутри числа, отбрасывает «—» и «-», если есть «двойное» значение (`28.5/27.1`) — берётся первая часть до `/`.

**Силовой блок (`parseGymCsv`):**
1. Скан по строкам; начало блока — ячейка-дата.
2. Следующая строка — `body_weight` в первой ячейке (+ возможно номера подходов 1..6).
3. Далее пары строк: имя упражнения с весами по подходам / пустая первая ячейка + повторы по подходам.
4. Пропускаются «итог»/«время»/пустые/шумные строки (определяются по `isNoiseOrTotalRow`).
5. Подходы собираются `zipSets` (только валидные пары `weight ≥ 0, reps > 0`), тоннаж считается локально.
6. Тренировка попадает в результат, если в ней ≥ 1 упражнения с валидными подходами; общий тоннаж округляется до 0.1.

**Плавательный блок (`parseSwimCsv`):**
1. Старт блока — дата.
2. Внутри: либо строка `описание, дистанция` (инлайн), либо «описание» в одной строке + следующая строка с метражом во второй ячейке (`pendingDesc`).
3. Строки `итог,N` — игнор (контроль суммы), `время,N` — пишется в `durationMinutes` (округление до минут).
4. Серии собираются с `order_index = 0..N`, `totalDistance = Σ`.

Тренировки сортируются по дате.

### Офлайн-скрипт (`npm run seed:supabase` / `--dry-run`)

1. Грузит `.env` вручную (нет `dotenv`-пакета — простая ручная парсилка `loadEnvFromDotenv`).
2. Читает все 6 CSV из `current_stat/resources/`, парсит силовые и плавательные.
3. Резолвит `user_id`:
   - `WORKOUT_IMPORT_USER_ID` → `NEXT_PUBLIC_WORKOUT_USER_ID` → INSERT новой пустой строки `users` (тогда печатает id, который надо положить в `.env`).
4. `wipePreviousImports(uid)` удаляет только строки `workouts.notes = '__seed:workout-catalog__'` — это маркер именно этого импорта, ручные сохранения с пустым `notes` не трогаются.
5. По одной тренировке вставляет `workouts` + связанные `gym_exercises` / `swim_series`. При ошибке скрипт фейлится с кодом 1.
6. В `--dry-run` Supabase не вызывается, просто печатается «силовых N, плавание M».

Так получается перенести всю историю из Sheets в локальную/прод-Supabase без OAuth.

---

## 10. Навигация и каркас

- **Корневой layout** (`src/app/layout.tsx`) — подключает шрифты Geist Sans/Mono, ставит `lang="ru"`, фон из CSS-токенов (`bg-background`).
- **Web layout** (`(web)/layout.tsx`) — `Header` (sticky, лого «Jarvis») + контейнер `max-w-lg` с паддингами + `BottomNav` (fixed, safe-area-pb).
- **BottomNav** — 5 пунктов: `/` Календарь, `/gym` Зал, `/swim` Плавание, `/chat` Чат, `/profile` Профиль. Активный пункт подсвечивается через `usePathname()`.
- **TMA layout** (`(tma)/layout.tsx`) — пока пустой каркас (`px-3 py-4`), Telegram SDK не подключён.

Цветовые токены `--gym` (тёплый акцент для силовой) и `--swim` (холодный — для плавания) живут в `globals.css` и используются повсюду в плашках/чипсах.

---

## 11. Безопасность и dev-режим

- В Supabase включён RLS на всех таблицах. Миграция `002_dev_anon_workout_policies.sql` добавляет политики `for all using (true) with check (true)` — это **DEV-ONLY**. Перед публичным деплоем их нужно заменить на политики через `auth.uid()` (либо подключить Supabase Auth, либо ходить с service-role с сервера и убрать всё клиентское чтение).
- Анонимный `users.id` фактически идентифицирует «браузерный профиль», а не реального человека. Для общего dev-аккаунта надо договариваться об одном UUID через `.env` (см. `.env.example`).

---

## 12. Что осталось доделать (по приоритету)

1. Калории для плавания: MET-таблица уже есть, нужна оценка длительности по дистанции и темпу.
2. Графики веса тела по времени (данные уже есть в `workouts.body_weight`).
3. Google Sheets OAuth — повторить логику CSV-парсера, но онлайн (без ручного экспорта).
4. Huawei Health OAuth — пульс/калории/длительность → подмешать в `workouts` (Keytel-формула, см. §8.5).
5. UI для `workout_plans` — шаблоны по дню недели.
6. TMA layout — инициализация `@telegram-apps/sdk`, mobile-first навигация.
7. Чат с агентом — `app/api/chat` + tools-обёртки над функциями из `lib/features/...` и `lib/db/...`.

Все они уже подготовлены либо в схеме БД, либо в `lib/features/` — остаётся только UI/интеграция.
