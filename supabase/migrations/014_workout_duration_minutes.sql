-- Длительность тренировки в минутах (плавание, опционально силовая).

alter table workouts
  add column if not exists duration_minutes integer;

comment on column workouts.duration_minutes is
  'Длительность сессии в минутах; для плавания — из формы, CSV (строка «время») или Huawei.';
