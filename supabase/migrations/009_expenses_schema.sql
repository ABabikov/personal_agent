-- Expenses tracker: счета, категории, операции, журнал импортов.
-- См. docs/features/expenses/{description,plan,status}.md
--
-- Состояние:
--   - Categorization: единое дерево (parent_id), эмодзи в schema не храним.
--   - Currency: на старте всё в RUB; поле currency оставлено для будущей мультивалютности.
--   - Soft delete: deleted_at (по аналогии с workouts).
--   - Дедуп: внутри одного source — uniq(user_id, source, external_id).
--     Между источниками (Money Manager ↔ банк) дедуп не делаем — обеспечивается
--     непересекающимися периодами.

-- ============================================================================
-- accounts
-- ============================================================================

create table public.expense_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  currency text not null default 'RUB',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index expense_accounts_user_id_idx on public.expense_accounts (user_id);

-- ============================================================================
-- categories (2-level tree: parent + child)
-- ============================================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  parent_id uuid references public.expense_categories(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('expense', 'income', 'withdrawal', 'transfer')),
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- (user_id, parent_id, name) уникальны, но null в parent_id ломает обычный uniq;
-- используем coalesce-индекс с фиксированным uuid-плейсхолдером для корней.
create unique index expense_categories_user_parent_name_unique
  on public.expense_categories (
    user_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name
  );

create index expense_categories_user_id_idx on public.expense_categories (user_id);
create index expense_categories_parent_id_idx on public.expense_categories (parent_id);

-- ============================================================================
-- transactions
-- ============================================================================

create table public.expense_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  occurred_at timestamptz not null,
  posted_at timestamptz,
  account_id uuid not null references public.expense_accounts(id) on delete restrict,
  category_id uuid references public.expense_categories(id) on delete set null,
  kind text not null check (kind in ('expense', 'income', 'withdrawal', 'transfer')),
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'RUB',
  description text,
  merchant text,
  mcc text,
  source text not null check (
    source in ('manual', 'money_manager', 'bank_sber', 'agent')
  ),
  external_id text,
  linked_transaction_id uuid references public.expense_transactions(id) on delete set null,
  raw jsonb,
  pending boolean not null default false,
  deleted_at timestamptz,
  deleted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expense_tx_user_occurred_idx
  on public.expense_transactions (user_id, occurred_at desc);
create index expense_tx_user_occurred_active_idx
  on public.expense_transactions (user_id, occurred_at desc)
  where deleted_at is null;
create index expense_tx_user_category_idx
  on public.expense_transactions (user_id, category_id)
  where deleted_at is null;
create index expense_tx_user_account_idx
  on public.expense_transactions (user_id, account_id)
  where deleted_at is null;

-- Идемпотентность импорта: upsert ON CONFLICT (user_id, source, external_id).
-- Полный unique index (без WHERE): частичный индекс не подходит как arbiter для ON CONFLICT в PostgREST/Supabase.
-- В PostgreSQL несколько строк с external_id = NULL допустимы (NULL не считается равным NULL).
create unique index expense_tx_source_external_unique
  on public.expense_transactions (user_id, source, external_id);

-- ============================================================================
-- import journal
-- ============================================================================

create table public.expense_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null,
  file_name text,
  period_from date,
  period_to date,
  rows_total integer not null default 0,
  rows_inserted integer not null default 0,
  rows_skipped integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index expense_imports_user_idx on public.expense_imports (user_id, created_at desc);

-- ============================================================================
-- RLS — dev-режим (по аналогии с 002_dev_anon_workout_policies.sql).
-- В проде заменить using/with check на (user_id = auth.uid()).
-- ============================================================================

alter table public.expense_accounts enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expense_transactions enable row level security;
alter table public.expense_imports enable row level security;

create policy "expense_accounts_dev_anon_all" on public.expense_accounts
  for all using (true) with check (true);

create policy "expense_categories_dev_anon_all" on public.expense_categories
  for all using (true) with check (true);

create policy "expense_transactions_dev_anon_all" on public.expense_transactions
  for all using (true) with check (true);

create policy "expense_imports_dev_anon_all" on public.expense_imports
  for all using (true) with check (true);

-- ============================================================================
-- updated_at trigger для transactions
-- ============================================================================

create or replace function public.expense_tx_set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger expense_tx_updated_at
  before update on public.expense_transactions
  for each row execute function public.expense_tx_set_updated_at();
