-- Куда слать уведы из классных чатов и курсор последней рассылки.

alter table public.kid_max_session
  add column if not exists telegram_chat_id text,
  add column if not exists last_notified_at timestamptz;
