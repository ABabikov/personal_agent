-- Fix: upsert ON CONFLICT (user_id, source, external_id) требует уникальный индекс
-- без предиката WHERE. Частичный индекс из 009 не подходит — PostgREST возвращает
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".

drop index if exists public.expense_tx_source_external_unique;

create unique index expense_tx_source_external_unique
  on public.expense_transactions (user_id, source, external_id);
