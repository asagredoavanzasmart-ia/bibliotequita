-- 0001_init.sql — Fase 1: usuarios + límites por usuario.
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

create extension if not exists pgcrypto;

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  email         text unique,
  password_hash text not null,
  role          text not null default 'user' check (role in ('admin', 'user')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists users_username_idx on users (lower(username));
create index if not exists users_role_idx on users (role);

create table if not exists user_limits (
  user_id           uuid primary key references users(id) on delete cascade,
  max_uploads       integer not null default 3,
  max_tts_chars     integer not null default 0,
  max_ai_summaries  integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();

drop trigger if exists user_limits_set_updated_at on user_limits;
create trigger user_limits_set_updated_at before update on user_limits
  for each row execute function set_updated_at();
