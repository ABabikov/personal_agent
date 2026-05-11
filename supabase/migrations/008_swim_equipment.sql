-- Теги снаряжения у шаблонов + инвентарь пользователя (null = не фильтровать каталог).

alter table public.swim_block_template
  add column if not exists equipment_tags text[] not null default '{}';

comment on column public.swim_block_template.equipment_tags is
  'Обязательные предметы для блока; {} = без особого снаряжения. Тег paddles_any = любые лопаты (s/m/l).';

create index if not exists swim_block_template_equipment_tags_gin
  on public.swim_block_template using gin (equipment_tags);

alter table public.users
  add column if not exists swim_equipment text[] null;

comment on column public.users.swim_equipment is
  'Какое снаряжение есть у пользователя; NULL = при сборке не фильтровать по снаряжению';

-- Примеры разметки уже существующих блоков (остальные остаются без требований).
update public.swim_block_template
set equipment_tags = array['kickboard']::text[]
where slug = 'curated_warm_kick_mix_300';

update public.swim_block_template
set equipment_tags = array['kickboard', 'pull_buoy']::text[]
where slug = 'curated_main_kick_pull_combo_600';

update public.swim_block_template
set equipment_tags = array['pull_buoy']::text[]
where slug = 'seed2_main_pull_buoy_steady_500';

update public.swim_block_template
set equipment_tags = array['kickboard']::text[]
where slug = 'seed2_main_sprint_kick_25_320';
