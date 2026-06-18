-- 0007_resources.sql — Recursos complementarios por libro (videos, audios,
-- textos, imágenes) para la pestaña "Recursos".
-- Ejecutar manualmente en el SQL Editor de Supabase Studio.

create table if not exists resources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  book_id     uuid not null references library_items(id) on delete cascade,
  data        jsonb not null,            -- ResourceItem serializado
  list_index  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists resources_book_idx on resources (user_id, book_id);

drop trigger if exists resources_set_updated_at on resources;
create trigger resources_set_updated_at before update on resources
  for each row execute function set_updated_at();
