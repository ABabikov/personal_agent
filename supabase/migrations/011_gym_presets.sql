-- Три именованных пресета силовой (упражнения + подходы) на пользователя.
create table gym_presets (
  user_id uuid not null references users (id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  label text not null default '',
  exercises jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index idx_gym_presets_user on gym_presets (user_id);

comment on table gym_presets is 'Силовые пресеты: слоты 1–3, exercises = [{name, sets:[{weight,reps}]}]';

alter table gym_presets enable row level security;

create policy "gym_presets_dev_anon_all" on public.gym_presets for all using (true)
with
  check (true);
