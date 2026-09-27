-- Дневник питания: норма КБЖУ, продукты, свои блюда, записи приёмов, утренний вес.
-- См. docs/features/nutrition/

create table public.nutrition_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  protein_g_per_kg numeric(4, 2) not null default 2.2,
  carbs_g_per_kg numeric(4, 2) not null default 3.5,
  fat_floor_g_per_kg numeric(4, 2) not null default 0.5,
  deficit_kcal_min integer not null default 200,
  deficit_kcal_max integer not null default 400,
  kcal_override numeric(7, 1),
  protein_g_override numeric(6, 1),
  carbs_g_override numeric(6, 1),
  fat_g_override numeric(6, 1),
  updated_at timestamptz not null default now(),
  check (protein_g_per_kg between 0.8 and 4),
  check (carbs_g_per_kg between 0 and 10),
  check (fat_floor_g_per_kg between 0.2 and 2),
  check (deficit_kcal_min between 0 and 2000),
  check (deficit_kcal_max between 0 and 2000),
  check (deficit_kcal_min <= deficit_kcal_max)
);

create table public.food_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('manual', 'magnit', 'yarche')),
  external_id text,
  name text not null,
  kcal_per_100 numeric(7, 2) not null,
  protein_per_100 numeric(6, 2) not null,
  fat_per_100 numeric(6, 2) not null,
  carbs_per_100 numeric(6, 2) not null,
  package_grams numeric(8, 1),
  url text,
  created_at timestamptz not null default now()
);

create unique index food_products_source_external_unique
  on public.food_products (user_id, source, external_id)
  where external_id is not null;

create index food_products_user_name_idx
  on public.food_products (user_id, name);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  cooked_weight_g numeric(8, 1) not null check (cooked_weight_g > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dishes_user_idx on public.dishes (user_id, name);

create table public.dish_ingredients (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.dishes(id) on delete cascade,
  food_product_id uuid not null references public.food_products(id) on delete restrict,
  grams numeric(8, 1) not null check (grams > 0),
  sort_order integer not null default 0
);

create index dish_ingredients_dish_idx on public.dish_ingredients (dish_id, sort_order);

create table public.food_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  eaten_on date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_product_id uuid references public.food_products(id) on delete set null,
  dish_id uuid references public.dishes(id) on delete set null,
  label text not null,
  grams numeric(8, 1),
  kcal numeric(7, 1) not null,
  protein_g numeric(6, 1) not null default 0,
  fat_g numeric(6, 1) not null default 0,
  carbs_g numeric(6, 1) not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index food_log_user_day_idx
  on public.food_log_entries (user_id, eaten_on desc)
  where deleted_at is null;

create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  weighed_on date not null,
  kg numeric(5, 2) not null check (kg > 0 and kg < 400),
  created_at timestamptz not null default now(),
  unique (user_id, weighed_on)
);

alter table public.nutrition_settings enable row level security;
alter table public.food_products enable row level security;
alter table public.dishes enable row level security;
alter table public.dish_ingredients enable row level security;
alter table public.food_log_entries enable row level security;
alter table public.weight_logs enable row level security;

create policy "nutrition_settings_dev_anon_all" on public.nutrition_settings
  for all using (true) with check (true);
create policy "food_products_dev_anon_all" on public.food_products
  for all using (true) with check (true);
create policy "dishes_dev_anon_all" on public.dishes
  for all using (true) with check (true);
create policy "dish_ingredients_dev_anon_all" on public.dish_ingredients
  for all using (true) with check (true);
create policy "food_log_entries_dev_anon_all" on public.food_log_entries
  for all using (true) with check (true);
create policy "weight_logs_dev_anon_all" on public.weight_logs
  for all using (true) with check (true);
