-- Huawei Health Kit: OAuth tokens, imported device sessions, links to workouts.

create table integration_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'huawei',
  access_token text,
  refresh_token text not null,
  expires_at timestamptz,
  scope text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, provider)
);

create table device_activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source text not null check (source in ('huawei')),
  external_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  activity_type_raw text,
  activity_type_mapped text check (
    activity_type_mapped is null
    or activity_type_mapped in ('gym', 'swim', 'other')
  ),
  calories_device numeric,
  avg_heart_rate numeric,
  duration_seconds integer,
  payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, source, external_id)
);

create index idx_device_activity_sessions_user_started
  on device_activity_sessions(user_id, started_at desc);

create table workout_device_links (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id) on delete cascade,
  device_session_id uuid not null references device_activity_sessions(id) on delete cascade,
  match_method text not null check (match_method in ('auto', 'manual')),
  confidence numeric(3, 2),
  created_at timestamptz default now(),
  unique (device_session_id),
  unique (workout_id, device_session_id)
);

create index idx_workout_device_links_workout on workout_device_links(workout_id);

alter table public.integration_oauth_tokens enable row level security;
alter table public.device_activity_sessions enable row level security;
alter table public.workout_device_links enable row level security;

create policy "integration_oauth_tokens_dev_anon_all"
  on public.integration_oauth_tokens for all using (true) with check (true);
create policy "device_activity_sessions_dev_anon_all"
  on public.device_activity_sessions for all using (true) with check (true);
create policy "workout_device_links_dev_anon_all"
  on public.workout_device_links for all using (true) with check (true);
