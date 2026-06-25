-- 0011_tags.sql — etiquetas con identidad propia (id + nombre + color), para
-- poder renombrar sin perder la asignación en los libros y filtrar por
-- etiqueta en el Sidebar. Mismo patrón que library_playlists (0002).
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

create table if not exists library_tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists library_tags_user_idx on library_tags (user_id);

drop trigger if exists library_tags_set_updated_at on library_tags;
create trigger library_tags_set_updated_at before update on library_tags
  for each row execute function set_updated_at();
