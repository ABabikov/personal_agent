# Huawei Health — практический runbook

Операционная инструкция: консоль Huawei, заявка, env, деплой, проверка.  
Техническая спецификация (схема БД, дедуп, код): [huawei-health-integration.md](./huawei-health-integration.md).

---

## 1. Что уже есть в коде

| Компонент | Путь |
|-----------|------|
| OAuth + импорт + линк | `src/lib/integrations/huawei/` |
| API | `/api/integrations/huawei/*` |
| UI | Профиль → карточка **Huawei Health** |
| Миграция БД | `supabase/migrations/012_huawei_health.sql` |
| Excel для заявки | `docs/huawei/Application-Material-Individual-PersonalAgent-filled.xlsx` |

---

## 2. Huawei Developer / AppGallery Connect

### 2.1. Тип приложения

- Web-приложение `agent` в AGC **не попадает** в заявку Health Kit как HarmonyOS/Android.
- Нужно приложение с **package name** (HarmonyOS или Android) в том же проекте **или** выбрать **HarmonyOS App** / **Android App** в форме заявки.
- **Server-to-server** в форме — другой продукт; для сценария «Профиль → Подключить → OAuth» не подходит.

### 2.2. Заявка Health Service Kit

1. [Developer Console](https://developer.huawei.com/consumer/en/console) → карточка **Health Service Kit** → Apply.
2. Product type: **HarmonyOS App** или **Android App** (не Server-to-server).
3. Загрузить Excel: `docs/huawei/Application-Material-Individual-PersonalAgent-filled.xlsx`.
4. Права (минимум):
   - Activity record — **read**
   - Activity — **read**
   - Heart rate — **read** (опционально, есть в Excel)
   - **Historical data (1 year)** — отдельно в форме или на экране OAuth
5. Не запрашивать: Stress, Sleep, Location, write-поля — если не нужны.

### 2.3. Account Kit — callback URL

**Сборка → Account Kit** → Authorization callback URL (точное совпадение):

```text
https://<ваш-домен>/api/integrations/huawei/callback
```

Пример для Vercel: `https://personal-agent-zeta.vercel.app/api/integrations/huawei/callback`  
При переезде на свой сервер — **обновить** в Huawei и в env.

### 2.4. Политики (обязательные URL)

| Поле Huawei | URL |
|-------------|-----|
| Privacy policy | `https://<домен>/privacy` |
| User agreement | `https://<домен>/terms` |

Страницы в репо: `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`.  
Должны открываться **без пароля** (в `middleware.ts` — public paths).

---

## 3. Переменные окружения (сервер)

```env
# Huawei (из AGC → приложение с одобренным Health Kit)
HUAWEI_HEALTH_CLIENT_ID=
HUAWEI_HEALTH_CLIENT_SECRET=
HUAWEI_HEALTH_REDIRECT_URI=https://<домен>/api/integrations/huawei/callback

# Scope — только одобленные в консоли (через пробел)
HUAWEI_HEALTH_SCOPES=https://www.huawei.com/healthkit/activityrecord.read https://www.huawei.com/healthkit/historydata.open.year

# Подпись OAuth state (или SITE_AUTH_SECRET)
SITE_AUTH_SECRET=

# Supabase — для OAuth-токенов надёжнее service role
SUPABASE_SERVICE_ROLE_KEY=

# Пользователь (один инстанс)
WORKOUT_USER_ID=
```

`NEXT_PUBLIC_*` — для клиента Supabase; Huawei-секреты **только серверные**, не в `NEXT_PUBLIC_`.

---

## 4. База данных

Применить миграцию `012_huawei_health.sql` (Supabase SQL Editor или `supabase db push`).

Таблицы: `integration_oauth_tokens`, `device_activity_sessions`, `workout_device_links`.

---

## 5. Проверка после одобрения

1. Env на сервере → redeploy.
2. Профиль → **Подключить** → согласие Huawei (включая **историю**, если запрашивали).
3. **Синхронизировать** — по умолчанию 30 дней; для года:

```http
POST /api/integrations/huawei/sync
Content-Type: application/json

{
  "userId": "<WORKOUT_USER_ID>",
  "from": "2020-01-01",
  "to": "2026-12-31"
}
```

4. Supabase: строки в `device_activity_sessions`, при совпадении — `workout_device_links`.

### Типичные проблемы

| Симптом | Причина |
|---------|---------|
| Пустой импорт | Не одобрен activity record; другой Huawei ID; Health Service выключен в приложении Huawei Health |
| Нет старых тренировок | Нет scope истории / не отмечена галочка при OAuth |
| `redirect_uri mismatch` | Callback ≠ Account Kit и ≠ `HUAWEI_HEALTH_REDIRECT_URI` |
| `/privacy` показывает логин | Не задеплоен middleware с public paths |

---

## 6. Документы в репозитории

| Файл | Назначение |
|------|------------|
| `docs/huawei/Application-Material-Individual-PersonalAgent-filled.xlsx` | Заявка (individual) |
| `scripts/fill-huawei-application-xlsx.py` | Перегенерация Excel |

Перегенерация:

```bash
python scripts/fill-huawei-application-xlsx.py
```

---

## 7. Смена домена (Vercel → свой сервер)

1. DNS + HTTPS на сервере.
2. Обновить: `HUAWEI_HEALTH_REDIRECT_URI`, Account Kit callback, privacy/terms URL в заявке Huawei (если домен сменился).
3. Пересобрать Docker-образ, если менялся только backend URL — `NEXT_PUBLIC_SUPABASE_*` не зависят от домена приложения.

Подробнее: [../../deploy/own-server.md](../../deploy/own-server.md).
