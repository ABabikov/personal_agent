# Huawei Health Kit — интеграция и маппинг без дублей

Сводный документ для реализации **Phase 2** (часть про Huawei). Выполнять **по порядку шагов**; предыдущий шаг считается закрытым, если чекбокс можно честно отметить.

**Практический runbook** (консоль, заявка, env, деплой, политики): [huawei-health-runbook.md](./huawei-health-runbook.md)  
**Деплой на свой сервер** (вместо Vercel): [../../deploy/own-server.md](../../deploy/own-server.md)

Связанные файлы: [`plan.md`](plan.md) (фазы фичи), [`status.md`](status.md) (прогресс), [`../../../architecture.md`](../../../architecture.md) (dual-mode: UI и агент → общий `lib/`).

---

## Цели

1. Подключить аккаунт Huawei (OAuth 2.0), безопасно хранить refresh-токен на сервере.
2. Импортировать активности/тренировки с облака (**Health Kit REST**), как в таблице решений в `plan.md`.
3. **Не дублировать** одну и ту же сессию при повторных синках.
4. **Сопоставлять** импорт с уже существующими записями `workouts` (ручной ввод, CSV seed), не создавая «вторую тренировку» за тот же фактический выход.

---

## Принципы данных

| Слой | Назначение |
|------|------------|
| `workouts` + `gym_exercises` / `swim_series` | Источник правды по объёму работы (упражнения, серии, заметки, MET-калории в `calories_estimated`). |
| Импорт с устройства | Отдельные строки **сессий** с полями длительность, калории с устройства, средний/макс пульс (если доступны в API), сырой ответ опционально в `jsonb`. |
| Связь ручное ↔ устройство | Отдельная таблица линков или nullable FK — **не** сливать две строки `workouts` в одну при автоматике. |

---

## Схема БД (новые объекты)

Имена можно уточнить при миграции; смысл зафиксирован.

### 1. `integration_oauth_tokens` (или `huawei_oauth_tokens`)

Хранение только для интеграции Huawei (позже можно обобщить `provider`).

- `user_id` uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE  
- `provider` text NOT NULL DEFAULT `'huawei'`  
- `access_token` text (короткоживущий; можно не хранить, если всегда рефрешить перед запросом)  
- `refresh_token` text NOT NULL (на сервере; в ответах API наружу не отдавать)  
- `expires_at` timestamptz  
- `scope` text (что реально выдано)  
- `created_at` / `updated_at` timestamptz  
- **UNIQUE** `(user_id, provider)` — один активный коннект на провайдера.

**Безопасность:** refresh только в server-side env / Supabase; не в `localStorage`. При публичном деплое — шифрование at-rest или секрет-хранилище, если появится требование compliance.

### 2. `device_activity_sessions`

Импортированные сессии (не только Huawei в будущем).

- `id` uuid PK  
- `user_id` uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE  
- `source` text NOT NULL CHECK (`source` IN (`'huawei'`)) — расширить enum при новых часах  
- `external_id` text NOT NULL — **стабильный** id из ответа Huawei (поле из официальной доки для данного типа сущности)  
- `started_at` timestamptz NOT NULL  
- `ended_at` timestamptz  
- `activity_type_raw` text — как пришло от Huawei  
- `activity_type_mapped` text NULL — внутренний тег для матчинга: `gym` | `swim` | `other`  
- `calories_device` numeric NULL  
- `avg_heart_rate` numeric NULL (если API отдаёт)  
- `duration_seconds` integer NULL  
- `payload` jsonb NULL — необязательный сырой фрагмент для отладки  
- `created_at` / `updated_at` timestamptz  

**UNIQUE** `(user_id, source, external_id)` — идемпотентный импорт, **нет дублей одной сессии** при повторной синхронизации.

### 3. `workout_device_links`

Связь «эта сессия с устройства относится к этой записи в журнале».

- `id` uuid PK  
- `workout_id` uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE  
- `device_session_id` uuid NOT NULL REFERENCES device_activity_sessions(id) ON DELETE CASCADE  
- `match_method` text NOT NULL CHECK (`match_method` IN (`'auto'`, `'manual'`))  
- `confidence` numeric(3,2) NULL — 0..1 для auto  
- `created_at` timestamptz  

**UNIQUE** `(device_session_id)` — одна импортированная сессия линкуется **к максимум одной** тренировке (если бизнес решит иначе — снять ограничение и пересмотреть UI).  
**UNIQUE** `(workout_id, device_session_id)` — нет дубля связи.

При удалении `workout` каскадом уходит линк; сессия на устройстве может остаться (или CASCADE по политике продукта).

---

## Дедупликация и маппинг (логика)

### A. Повторный импорт (одна сессия Huawei много раз)

Решение: **upsert** по `(user_id, source, external_id)` в `device_activity_sessions`. Новая строка не создаётся.

### B. Журнал `workouts` ↔ новая сессия

**Не** создавать второй `workout` из Huawei, если пользователь уже внёс зал/плав в тот же выход. Цель — **линк** + обогащение метриками.

**Автоматический маппинг (после upsert сессии, если у сессии ещё нет строки в `workout_device_links`):**

1. Кандидаты: `workouts` того же `user_id`, дата **в том же календарном дне**, что и `started_at` сессии (часовой пояс пользователя — зафиксировать: пока можно брать UTC или `Europe/...` из профиля позже).  
2. Фильтр по типу: маппинг `activity_type_raw` / кода Huawei → `gym` | `swim`; искать `workouts.type` совпадающий. Если маппинг → `other`, авто-линк к `workouts` **не** делать (только ручной или отдельная политика).  
3. Среди кандидатов исключить `workout_id`, у которых уже есть линк на **другую** сессию того же дня с тем же типом — по продукту уточнить (MVP: один линк на workout).  
4. Если ровно **один** кандидат — создать `workout_device_links` с `match_method = 'auto'`, `confidence` по эвристике (например 0.9).  
5. Если **ноль** или **несколько** кандидатов — не линковать; сессия попадает в очередь «требует сопоставления» для UI.

**Опционально для уточнения auto (v2):** пересечение по времени, если в `workouts` появятся поля `started_at` / `ended_at`; сейчас в схеме только `date` — маппинг опирается на день + тип.

### Ручное сопоставление (MVP рекомендуется)

Экран или секция в профиле: список неприлинкованных `device_activity_sessions` за период + список `workouts` за тот же день без пары — пользователь выбирает пару → `match_method = 'manual'`, `confidence = null` или 1.

### Отображение и калории

- `workouts.calories_estimated` — MET, как сейчас.  
- `device_activity_sessions.calories_device` — с часов.  
- В UI при наличии линка: показывать оба значения и/или подпись «устройство vs оценка» (как в Phase 2 `plan.md`: кросс-проверка).

---

## OAuth и API (высокий уровень)

1. Зарегистрировать приложение в **Huawei Developer Console**, включить **Health Kit**, указать redirect URI на прод/стейджинг.  
2. Пользователь → `authorize` → callback route Next.js → обмен `code` на токены → сохранение в `integration_oauth_tokens`.  
3. Перед запросами к Health Kit: обновление access при истечении (refresh_token).  
4. Конкретные URL scope и REST paths — **из актуальной документации Huawei** на момент реализации (различаются по региону и версии kit).

**TMA:** OAuth открывать во внешнем браузере / `openLink`, callback на ваш домен, затем возврат в мини-приложение — отдельная проверка на реальном Telegram.

---

## Кодовая раскладка (ориентир)

```
src/lib/integrations/huawei/
  oauth.ts          # authorize URL, token exchange, refresh
  client.ts         # REST вызовы к Health Kit
  mapActivityType.ts # Huawei → gym | swim | other
  importSessions.ts  # диапазон дат → upsert device_activity_sessions
  linkSessions.ts    # авто + вызов из UI для manual
src/app/api/integrations/huawei/
  authorize/route.ts
  callback/route.ts
  disconnect/route.ts
  sync/route.ts      # POST: body { from, to } или последние N дней
```

Бизнес-логика без привязки к HTTP — чтобы позже вызвать из агента (read tool).

---

## Пошаговый чеклист реализации

Отмечайте в этом файле или в `status.md` по мере готовности.

### Шаг 1 — Регистрация и секреты

- [ ] Huawei Developer: приложение, Health Kit, redirect URI, client id/secret  
- [ ] Переменные окружения: `HUAWEI_HEALTH_CLIENT_ID`, `HUAWEI_HEALTH_CLIENT_SECRET`, `HUAWEI_HEALTH_REDIRECT_URI` (и при необходимости региональные base URL)  
- [ ] Запись в `.env.example` без секретов  

### Шаг 2 — Миграции Supabase

- [ ] Таблица `integration_oauth_tokens` (или узкая `huawei_oauth_tokens`)  
- [ ] Таблица `device_activity_sessions` + UNIQUE `(user_id, source, external_id)`  
- [ ] Таблица `workout_device_links` + ограничения уникальности выше  
- [ ] RLS: только `service_role` или политики под будущий `auth.uid()` — согласовать с текущим dev-режимом (`002_dev_anon...`)  

### Шаг 3 — OAuth

- [ ] `GET` authorize route → редирект на Huawei  
- [ ] `GET` callback → code → tokens → upsert в БД → редирект в UI (успех / ошибка)  
- [ ] `POST` disconnect → удаление токенов (и опционально сессий / линков — зафиксировать продуктово)  

### Шаг 4 — Клиент Health Kit и импорт

- [ ] Refresh access token при 401 / по `expires_at`  
- [ ] Загрузка списка активностей за диапазон (конкретный endpoint из доки)  
- [ ] Маппинг полей → `device_activity_sessions` + upsert по `external_id`  

### Шаг 5 — Автолинк + ручной линк

- [ ] `linkSessions.ts`: правила из раздела «B» после каждого импорта (или отдельной кнопки «Сопоставить»)  
- [ ] UI: неприлинкованные сессии + выбор `workout` вручную  
- [ ] Защита: не создавать второй `workout` из Huawei при совпадении с журналом (импорт только в `device_activity_sessions`)  

### Шаг 6 — Продукт

- [ ] Профиль или отдельная страница: Подключить / Отключить / Синхронизировать  
- [ ] Дневной деталь / карточка тренировки: при наличии линка показать калории с устройства и MET рядом  
- [ ] TMA: сквозной OAuth smoke test  

### Шаг 7 — Агент (после стабилизации данных)

- [ ] Tool: список сессий с устройства за период (чтение из БД)  
- [ ] Tool или расширение аналитики: сравнение MET vs `calories_device` для дат/упражнений  

---

## Риски и запасной план

| Риск | Митигация |
|------|-----------|
| Квоты / изменения API | Логирование ошибок, backoff, версия доки в комментарии коду |
| Регион (CN vs global) | Явно выбрать кластер в конфиге |
| Неточный авто-линк | Ручное сопоставление + не линковать при >1 кандидате |
| Альтернатива провайдеру | Как в `plan.md`: агрегаторы вроде Terra (отдельная фича) |

---

## Версия документа

- **2026-05-11** — первый согласованный вариант (REST, схема, дедуп, пошаговый чеклист).
