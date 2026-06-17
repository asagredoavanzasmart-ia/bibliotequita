-- 0003_document_data.sql — Fase B: datos por documento (notas, citas,
-- marcadores, paleta de colores, resúmenes IA), migrados desde localStorage.
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

create table if not exists document_notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  document_id   text not null,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists document_notes_lookup_idx on document_notes (user_id, document_id);

create table if not exists document_settings (
  user_id          uuid not null references users(id) on delete cascade,
  document_id      text not null,
  color_palette    jsonb,
  group_by_color   boolean not null default false,
  summary_gen      text,
  summary_edit     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, document_id)
);

drop trigger if exists document_notes_set_updated_at on document_notes;
create trigger document_notes_set_updated_at before update on document_notes
  for each row execute function set_updated_at();

drop trigger if exists document_settings_set_updated_at on document_settings;
create trigger document_settings_set_updated_at before update on document_settings
  for each row execute function set_updated_at();
