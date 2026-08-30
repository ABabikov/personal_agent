-- Корневые категории с одинаковым именем, но разным kind (напр. «Прочее»
-- как расход и как доход) раньше конфликтовали: unique был только по
-- (user_id, parent_id, name). Добавляем kind в ключ.

drop index if exists public.expense_categories_user_parent_name_unique;

create unique index expense_categories_user_parent_name_kind_unique
  on public.expense_categories (
    user_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name,
    kind
  );
