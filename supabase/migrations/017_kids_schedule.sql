-- Расписание детей (мальчик / девочка): уроки, кружки, ДЗ, оценки, зеркало двух чатов Max.
-- Личный контур на той же БД, отдельные таблицы.

create table public.kids (
  id text primary key check (id in ('boy', 'girl')),
  label text not null,
  max_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.kids (id, label) values
  ('boy', 'Мальчик'),
  ('girl', 'Девочка');

create table public.kid_lessons (
  id uuid primary key default gen_random_uuid(),
  child_id text not null references public.kids(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  subject text not null,
  room text,
  created_at timestamptz not null default now()
);

create index kid_lessons_child_weekday_idx
  on public.kid_lessons (child_id, weekday, start_time);

create table public.kid_activities (
  id uuid primary key default gen_random_uuid(),
  child_id text not null references public.kids(id) on delete cascade,
  weekday smallint check (weekday between 1 and 7),
  on_date date,
  start_time time not null,
  end_time time not null,
  title text not null,
  place text,
  created_at timestamptz not null default now(),
  check (weekday is not null or on_date is not null)
);

create index kid_activities_child_idx
  on public.kid_activities (child_id, weekday, on_date);

create table public.kid_homework (
  id uuid primary key default gen_random_uuid(),
  child_id text not null references public.kids(id) on delete cascade,
  subject text not null,
  title text not null,
  due_date date not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index kid_homework_child_due_idx
  on public.kid_homework (child_id, due_date, done);

create table public.kid_grades (
  id uuid primary key default gen_random_uuid(),
  child_id text not null references public.kids(id) on delete cascade,
  subject text not null,
  value text not null,
  graded_on date not null,
  comment text,
  created_at timestamptz not null default now()
);

create index kid_grades_child_date_idx
  on public.kid_grades (child_id, graded_on desc);

create table public.kid_chat_messages (
  id uuid primary key default gen_random_uuid(),
  child_id text not null references public.kids(id) on delete cascade,
  max_chat_id text not null,
  message_id text not null,
  from_id text,
  from_name text not null default '',
  body text not null default '',
  sent_at timestamptz not null,
  status text check (status is null or status in ('edited', 'removed')),
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (max_chat_id, message_id)
);

create index kid_chat_messages_child_sent_idx
  on public.kid_chat_messages (child_id, sent_at desc);

create table public.kid_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.kid_chat_messages(id) on delete cascade,
  kind text not null check (kind in ('photo', 'file', 'other')),
  name text not null,
  storage_path text,
  created_at timestamptz not null default now()
);

create index kid_chat_attachments_message_idx
  on public.kid_chat_attachments (message_id);

alter table public.kids enable row level security;
alter table public.kid_lessons enable row level security;
alter table public.kid_activities enable row level security;
alter table public.kid_homework enable row level security;
alter table public.kid_grades enable row level security;
alter table public.kid_chat_messages enable row level security;
alter table public.kid_chat_attachments enable row level security;

create policy "kids_dev_anon_all" on public.kids for all using (true) with check (true);
create policy "kid_lessons_dev_anon_all" on public.kid_lessons for all using (true) with check (true);
create policy "kid_activities_dev_anon_all" on public.kid_activities for all using (true) with check (true);
create policy "kid_homework_dev_anon_all" on public.kid_homework for all using (true) with check (true);
create policy "kid_grades_dev_anon_all" on public.kid_grades for all using (true) with check (true);
create policy "kid_chat_messages_dev_anon_all" on public.kid_chat_messages for all using (true) with check (true);
create policy "kid_chat_attachments_dev_anon_all" on public.kid_chat_attachments for all using (true) with check (true);
