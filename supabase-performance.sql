-- RUSTOCK: необязательное обновление производительности для уже созданной базы.
-- Запустите один раз в Supabase → SQL Editor → New query → Run.
-- Все команды безопасны для повторного запуска.
create index if not exists products_created_at_id_idx
  on public.products (created_at desc, id);

create index if not exists products_available_idx
  on public.products (available);

create index if not exists products_available_created_at_idx
  on public.products (available, created_at desc, id);

create index if not exists products_price_idx
  on public.products (price);

create index if not exists products_name_idx
  on public.products (name);
