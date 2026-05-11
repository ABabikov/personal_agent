-- Users
create table users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique,
  weight numeric(5,2),        -- кг
  height numeric(5,1),        -- см
  age integer,
  gender text check (gender in ('male', 'female')),
  activity_level numeric(3,2) default 1.55,  -- TDEE multiplier
  body_fat_pct numeric(4,1),  -- optional, for Katch-McArdle
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Workouts (unified: gym + swim)
create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('gym', 'swim')),
  body_weight numeric(5,2),
  total_tonnage numeric(10,1),   -- auto-sum for gym
  total_distance integer,         -- auto-sum meters for swim
  calories_estimated numeric(7,1),
  notes text,
  created_at timestamptz default now()
);

create index idx_workouts_user_date on workouts(user_id, date);
create index idx_workouts_type on workouts(type);

-- Gym exercises (per workout)
create table gym_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id) on delete cascade,
  exercise_name text not null,
  order_index integer not null default 0,
  sets jsonb not null default '[]',  -- [{weight: number, reps: number}]
  tonnage numeric(8,1) not null default 0
);

create index idx_gym_exercises_workout on gym_exercises(workout_id);
create index idx_gym_exercises_name on gym_exercises(exercise_name);

-- Swim series (per workout)
create table swim_series (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id) on delete cascade,
  order_index integer not null default 0,
  distance integer not null,       -- meters
  description text not null default ''
);

create index idx_swim_series_workout on swim_series(workout_id);

-- Workout plans (templates for pre-filling)
create table workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  day_of_week integer not null check (day_of_week between 0 and 6),  -- 0=Mon, 6=Sun
  exercises jsonb not null default '[]',  -- [{exercise_name, target_sets, target_reps_min, target_reps_max, last_weight}]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_workout_plans_user on workout_plans(user_id);
