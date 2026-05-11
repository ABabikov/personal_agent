-- Каталог шаблонов серий плавания (см. docs/features/swim-catalog/TZ.md).
-- Пример одной записи (для документации):
-- {"slug":"main_pyramid_400","phase":"main","goal_tags":["mixed","aerobic"],"nominal_distance_m":400,"min_m":300,"max_m":600,"body_text":"..."}

create type swim_block_phase as enum ('warmup', 'main', 'cooldown');

create table public.swim_block_template (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  slug text not null,
  goal_tags text[] not null default '{}',
  phase swim_block_phase not null,
  nominal_distance_m integer not null,
  min_m integer not null,
  max_m integer not null,
  scale_mode text not null default 'stretch_tail',
  body_text text not null,
  source text not null check (source in ('own', 'curated', 'generator_seed')),
  source_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_m <= max_m),
  check (nominal_distance_m > 0),
  check (min_m > 0)
);

comment on table public.swim_block_template is 'Переиспользуемые блоки тренировки плавания; user_id null = системные заготовки';

create unique index swim_block_template_system_slug_unique
  on public.swim_block_template (slug)
  where user_id is null;

create unique index swim_block_template_user_slug_unique
  on public.swim_block_template (user_id, slug)
  where user_id is not null;

create index swim_block_template_phase_idx on public.swim_block_template (phase);
create index swim_block_template_goal_tags_gin on public.swim_block_template using gin (goal_tags);
create index swim_block_template_user_id_idx on public.swim_block_template (user_id)
  where user_id is not null;

alter table public.swim_block_template enable row level security;

-- Dev / anon: как у workouts — полный доступ (заменить на auth.uid() при проде).
create policy "swim_block_template_dev_anon_all"
  on public.swim_block_template
  for all
  using (true)
  with check (true);

-- Системные блоки (generator_seed): тексты из generatePlan.ts / типовые серии
insert into public.swim_block_template
  (user_id, slug, goal_tags, phase, nominal_distance_m, min_m, max_m, scale_mode, body_text, source, source_note, active)
values
  (
    null,
    'swim_warmup_standard',
    array['technique','speed','aerobic','mixed','recovery']::text[],
    'warmup',
    400, 100, 750, 'stretch_tail',
    $w1$100 вс закуп
100 бр легко
100 сп легко
далее 100 вс наращивание темпа до запланированного метража блока$w1$,
    'generator_seed',
    'разминка как в generatePlan buildWarmupLines',
    true
  ),
  (
    null,
    'swim_warmup_speed_bias',
    array['speed','mixed']::text[],
    'warmup',
    450, 200, 700, 'stretch_tail',
    $w2$150 вс очень спокойно
150 сп / бр смешанно
150 вс наращивание
остаток метража — вс с контролем старта и поворота$w2$,
    'generator_seed',
    'расширенная разминка перед скоростной основой',
    true
  ),
  (
    null,
    'swim_warmup_drills_bias',
    array['technique','mixed','recovery']::text[],
    'warmup',
    350, 100, 600, 'stretch_tail',
    $w3$100 вс + 100 сп легко
короткие 25–50 м: ладони, скольжение, положение тела
остаток — очень спокойный вс с тем же контролем$w3$,
    'generator_seed',
    'уклон в технику / восстановление',
    true
  ),
  (
    null,
    'main_pyramid_400',
    array['technique','mixed','aerobic','recovery']::text[],
    'main',
    400, 300, 600, 'stretch_tail',
    $m1$Горка 25–50–75–100–75–50–25 вс
через 25 м в дорожке (или старт по готовности — как у вас принято)$m1$,
    'generator_seed',
    'generatePlan PYRAMID_400',
    true
  ),
  (
    null,
    'main_4x300_1200',
    array['technique','mixed','aerobic']::text[],
    'main',
    1200, 1000, 1600, 'stretch_tail',
    $m2$4×300 вс
каждые 100 м можно чередовать стили: бр → сп → бр → вс на последнем отрезке$m2$,
    'generator_seed',
    'generatePlan FOUR_300',
    true
  ),
  (
    null,
    'main_6x100_600',
    array['mixed','speed','aerobic']::text[],
    'main',
    600, 500, 800, 'stretch_tail',
    $m3$6×100 вс средним темпом
отдых 1:30–2:00 между отрезками$m3$,
    'generator_seed',
    'generatePlan SIX_100',
    true
  ),
  (
    null,
    'main_5x100_variant_a',
    array['mixed','aerobic']::text[],
    'main',
    500, 400, 700, 'stretch_tail',
    $m4$5×100 вс рабочий темп
отдых 2:00 между сотнями$m4$,
    'generator_seed',
    'VARIANT_500[0]',
    true
  ),
  (
    null,
    'main_5x100_variant_b',
    array['mixed','speed']::text[],
    'main',
    500, 400, 700, 'stretch_tail',
    $m5$10×50 вс: нечётные отрезки спокойнее, чётные чуть острее
отдых ~45″–1:00$m5$,
    'generator_seed',
    'VARIANT_500 вариант интервалов',
    true
  ),
  (
    null,
    'main_3x100_300',
    array['technique','mixed','recovery']::text[],
    'main',
    300, 250, 500, 'stretch_tail',
    $m6$3×100 вс
спокойно, разворот и выход с контролем$m6$,
    'generator_seed',
    'THREE_100_COMP',
    true
  ),
  (
    null,
    'main_tech_300',
    array['technique','mixed']::text[],
    'main',
    300, 250, 450, 'stretch_tail',
    $m7$Короткие 25–50 м: ладони, скольжение, положение тела
остаток блока — спокойный вс с тем же контролем$m7$,
    'generator_seed',
    'TECH_300_VARIANTS',
    true
  ),
  (
    null,
    'main_sprint_300',
    array['speed','mixed']::text[],
    'main',
    300, 250, 500, 'stretch_tail',
    $m8$6×50 вс быстро
отдых 1:00–1:15 между отрезками$m8$,
    'generator_seed',
    'SPRINT_300',
    true
  ),
  (
    null,
    'main_800_endurance',
    array['aerobic','mixed','recovery']::text[],
    'main',
    800, 600, 1200, 'stretch_tail',
    $m9$800 вс стабильным крейсером
контроль дыхания и положения на воде$m9$,
    'generator_seed',
    'ENDURANCE_800',
    true
  ),
  (
    null,
    'main_cruise_fill',
    array['technique','speed','aerobic','mixed','recovery']::text[],
    'main',
    400, 100, 1400, 'merge_remainder_into_previous',
    $m10$Спокойный крейсерный отрезок по запланированному метражу (вс/сп по ощущениям), без лишних остановок на стенке$m10$,
    'generator_seed',
    'хвост основы из generatePlan allocateMixedMain',
    true
  ),
  (
    null,
    'cooldown_standard',
    array['technique','speed','aerobic','mixed','recovery']::text[],
    'cooldown',
    200, 50, 450, 'stretch_tail',
    $c1$100 вс откуп
оставшийся метраж — сп/вс очень легко$c1$,
    'generator_seed',
    'generatePlan buildCooldownLines (укороченно)',
    true
  ),
  (
    null,
    'cooldown_easy_long',
    array['aerobic','mixed','recovery']::text[],
    'cooldown',
    300, 75, 600, 'stretch_tail',
    $c2$150 сп легко
150 вс совсем спокойно
при большем метраже — добавляйте 50 м сп/вс чередованием до конца блока$c2$,
    'generator_seed',
    'заминка для объёмных сессий',
    true
  );
