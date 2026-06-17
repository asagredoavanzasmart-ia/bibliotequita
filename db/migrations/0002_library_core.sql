-- 0002_library_core.sql — Fase A: núcleo de la biblioteca (items, playlists,
-- categorías y ajustes de UI), migrados desde localStorage.
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

create table if not exists library_settings (
  user_id           uuid primary key references users(id) on delete cascade,
  theme             text not null default 'blue',
  font_family       text not null default 'Inter',
  view_mode         text not null default 'grid',
  sort_by           text not null default 'manual',
  card_settings     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists library_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  sort_index  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists library_playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists library_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  data          jsonb not null,
  list_index    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists library_items_user_idx on library_items (user_id);
create index if not exists library_playlists_user_idx on library_playlists (user_id);
create index if not exists library_categories_user_idx on library_categories (user_id);

drop trigger if exists library_settings_set_updated_at on library_settings;
create trigger library_settings_set_updated_at before update on library_settings
  for each row execute function set_updated_at();

drop trigger if exists library_items_set_updated_at on library_items;
create trigger library_items_set_updated_at before update on library_items
  for each row execute function set_updated_at();

drop trigger if exists library_playlists_set_updated_at on library_playlists;
create trigger library_playlists_set_updated_at before update on library_playlists
  for each row execute function set_updated_at();

drop trigger if exists library_categories_set_updated_at on library_categories;
create trigger library_categories_set_updated_at before update on library_categories
  for each row execute function set_updated_at();
