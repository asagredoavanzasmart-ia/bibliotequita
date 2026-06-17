-- 0005_category_hidden.sql — permite ocultar categorías de la barra lateral sin
-- borrarlas (las categorías base como "Estudio" no se eliminan, solo se ocultan).
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

alter table library_categories
  add column if not exists hidden boolean not null default false;
