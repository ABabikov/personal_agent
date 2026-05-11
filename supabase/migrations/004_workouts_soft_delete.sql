-- Soft delete для workouts: вместо физического удаления ставим deleted_at.
-- Все read-запросы фильтруют deleted_at IS NULL; восстановление = очистить deleted_at.

alter table workouts add column if not exists deleted_at timestamptz;
alter table workouts add column if not exists deleted_reason text;

create index if not exists idx_workouts_deleted_at on workouts(deleted_at);
-- Частичный индекс для активных тренировок — пользуется большинством запросов.
create index if not exists idx_workouts_user_date_active
  on workouts(user_id, date)
  where deleted_at is null;
