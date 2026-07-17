-- Правила автокатегоризации импорта операций.
-- См. docs/features/expenses/{plan,logic}.md
--
-- Смысл: импорт выписки не должен каждый раз начинаться с нуля. Когда пользователь
-- подтверждает категорию для группы операций, связка «признак → категория» сохраняется
-- здесь, и следующий импорт того же мерчанта/MCC подставляет категорию сам.
--
--   match_type = merchant       — по нормализованному названию места (самый сильный признак:
--                                 в выписке Сбера категория банка почти всегда «Прочие операции»)
--   match_type = mcc            — по коду категории мерчанта (4 цифры)
--   match_type = bank_category  — по категории из файла выписки
--   match_type = description    — по подстроке описания (для операций без мерчанта и MCC)
--
--   origin = manual  — пользователь выбрал категорию руками
--   origin = llm     — категорию предложила модель, пользователь не стал менять
--   origin = learned — вывелось из истории операций

create table public.expense_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  match_type text not null check (
    match_type in ('merchant', 'mcc', 'bank_category', 'description')
  ),
  -- нормализованный образец (регистр/пробелы приведены на стороне приложения)
  pattern text not null,
  kind text not null check (kind in ('expense', 'income', 'withdrawal', 'transfer')),
  category_id uuid not null references public.expense_categories(id) on delete cascade,
  -- меньше число — выше приоритет при совпадении нескольких правил
  priority integer not null default 100,
  origin text not null default 'learned' check (origin in ('manual', 'llm', 'learned')),
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Арбитр для upsert при сохранении правил после импорта.
create unique index expense_category_rules_unique
  on public.expense_category_rules (user_id, match_type, pattern, kind);

create index expense_category_rules_user_idx on public.expense_category_rules (user_id);

alter table public.expense_category_rules enable row level security;

-- dev-режим, как в 009_expenses_schema.sql. В проде заменить на (user_id = auth.uid()).
create policy "expense_category_rules_dev_anon_all" on public.expense_category_rules
  for all using (true) with check (true);

create trigger expense_category_rules_updated_at
  before update on public.expense_category_rules
  for each row execute function public.expense_tx_set_updated_at();
