-- Сессия личного Max-аккаунта для синка двух классных чатов на Vercel.
-- Одна строка (id=1). Токены пишет Mini App после QR/SMS, читает cron /api/kids/max-sync.

create table public.kid_max_session (
  id smallint primary key default 1 check (id = 1),
  device_id text,
  login_token text,
  mobile_device_id text,
  mt_instance_id text,
  mobile_login_token text,
  sms_token text,
  owner_name text,
  updated_at timestamptz not null default now()
);

insert into public.kid_max_session (id) values (1);

alter table public.kid_max_session enable row level security;

create policy "kid_max_session_dev_anon_all"
  on public.kid_max_session for all using (true) with check (true);
