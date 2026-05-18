-- Статус тренировки: active (черновик в процессе) | completed (в журнале).
-- Существующие записи — completed (default).

alter table workouts
  add column if not exists status text not null default 'completed'
  check (status in ('active', 'completed'));

comment on column workouts.status is
  'active = черновик (не в календаре); completed = завершена и видна в журнале';

-- Не больше одной активной тренировки на пользователя и тип.
create unique index if not exists idx_workouts_one_active_per_user_type
  on workouts (user_id, type)
  where status = 'active' and deleted_at is null;

create index if not exists idx_workouts_user_status
  on workouts (user_id, status)
  where deleted_at is null;
