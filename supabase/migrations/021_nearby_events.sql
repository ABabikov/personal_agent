-- Лента событий рядом: город, интересы, отобранные события.
-- См. docs/features/nearby/

create table public.nearby_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  city_slug text,
  city_label text,
  horizon_days integer not null default 21 check (horizon_days between 7 and 60),
  last_digest text,
  refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.nearby_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 2 and 48),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index nearby_interests_user_label_idx
  on public.nearby_interests (user_id, lower(label));

create table public.nearby_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  external_key text not null,
  source text not null check (source in ('kudago', 'web')),
  title text not null,
  url text not null,
  starts_on date,
  place text,
  snippet text,
  why text,
  score numeric(5, 1) not null default 0 check (score >= 0 and score <= 100),
  interest_label text,
  hidden boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique (user_id, external_key)
);

create index nearby_events_user_visible_idx
  on public.nearby_events (user_id, starts_on)
  where hidden = false;

alter table public.nearby_settings enable row level security;
alter table public.nearby_interests enable row level security;
alter table public.nearby_events enable row level security;

create policy "nearby_settings_dev_anon_all" on public.nearby_settings
  for all using (true) with check (true);
create policy "nearby_interests_dev_anon_all" on public.nearby_interests
  for all using (true) with check (true);
create policy "nearby_events_dev_anon_all" on public.nearby_events
  for all using (true) with check (true);
