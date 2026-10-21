-- RUSTOCK: запускать целиком в Supabase → SQL Editor → New query → Run.
-- Этот файл создаёт каталог, правила доступа и публичное хранилище фотографий.
-- В браузере используется только anon/public key. Никогда не публикуйте service_role key.

create extension if not exists pgcrypto;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  brand text not null default '',
  price numeric(12, 2) not null default 0 check (price >= 0),
  category text not null default '',
  short_description text not null default '',
  description text not null default '',
  characteristics jsonb not null default '{}'::jsonb,
  images text[] not null default '{}',
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Индексы для постраничной выдачи и сортировки каталога.
create index if not exists products_created_at_idx on public.products (created_at desc);
create index if not exists products_created_at_id_idx on public.products (created_at desc, id);
create index if not exists products_available_idx on public.products (available);
create index if not exists products_available_created_at_idx on public.products (available, created_at desc, id);
create index if not exists products_price_idx on public.products (price);
create index if not exists products_name_idx on public.products (name);

alter table public.admins enable row level security;
alter table public.products enable row level security;

drop policy if exists "Admins can read their own admin record" on public.admins;
create policy "Admins can read their own admin record"
  on public.admins for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Anyone can view products" on public.products;
create policy "Anyone can view products"
  on public.products for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
  on public.products for insert
  to authenticated
  with check (
    exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  );

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products for update
  to authenticated
  using (
    exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  );

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
  on public.products for delete
  to authenticated
  using (
    exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  );

-- Создаём публичный bucket для просмотра фотографий в каталоге.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists "Anyone can view product images" on storage.objects;
create policy "Anyone can view product images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  );

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  );

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.admins where admins.user_id = (select auth.uid()))
  );
