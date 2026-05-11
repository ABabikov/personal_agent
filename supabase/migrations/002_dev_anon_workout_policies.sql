-- Lets the browser anon key insert/read workout rows (no Supabase Auth yet).
-- Replace with policies on auth.uid() before any multi-user or public deployment.

alter table public.users enable row level security;
alter table public.workouts enable row level security;
alter table public.gym_exercises enable row level security;
alter table public.swim_series enable row level security;
alter table public.workout_plans enable row level security;

create policy "users_dev_anon_all" on public.users for all using (true) with check (true);
create policy "workouts_dev_anon_all" on public.workouts for all using (true) with check (true);
create policy "gym_exercises_dev_anon_all" on public.gym_exercises for all using (true) with check (true);
create policy "swim_series_dev_anon_all" on public.swim_series for all using (true) with check (true);
create policy "workout_plans_dev_anon_all" on public.workout_plans for all using (true) with check (true);
