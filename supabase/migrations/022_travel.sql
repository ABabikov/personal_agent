-- Планы поездок и брони (билеты, отели, туры).
-- Поиск живых цен — в lib/features/travel/search.ts, ключи в .env.
-- Dev-RLS как у остальных таблиц: перед публичным деплоем сузить до auth.uid().

create table public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  destination text not null,
  start_date date,
  end_date date,
  budget_rub integer,
  travelers_count integer not null default 1 check (travelers_count between 1 and 20),
  plan_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trip_plans_user_idx on public.trip_plans (user_id, start_date desc);

create table public.travel_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  trip_plan_id uuid references public.trip_plans(id) on delete set null,
  kind text not null check (kind in ('flight', 'hotel', 'tour', 'cruise', 'other')),
  title text not null,
  provider text,
  external_ref text,
  status text not null default 'draft' check (status in ('draft', 'held', 'booked', 'cancelled')),
  price_rub numeric(14, 2),
  currency text not null default 'RUB',
  starts_at timestamptz,
  ends_at timestamptz,
  url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index travel_bookings_user_idx on public.travel_bookings (user_id, starts_at);
create index travel_bookings_plan_idx on public.travel_bookings (trip_plan_id);

alter table public.trip_plans enable row level security;
alter table public.travel_bookings enable row level security;

create policy "trip_plans_dev_anon_all" on public.trip_plans
  for all using (true) with check (true);
create policy "travel_bookings_dev_anon_all" on public.travel_bookings
  for all using (true) with check (true);
