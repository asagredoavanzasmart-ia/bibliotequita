-- 0009_user_activity.sql — registro de actividad de usuario (tiempo de
-- lectura diario y última conexión), para que el admin pueda auditar el uso
-- de cuentas de prueba. Ejecutar manualmente vía psql o en el SQL Editor de
-- Supabase Studio.

create table if not exists reading_time_log (
  user_id     uuid not null references users(id) on delete cascade,
  day         date not null,
  seconds     integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists reading_time_log_user_idx on reading_time_log (user_id, day desc);

drop trigger if exists reading_time_log_set_updated_at on reading_time_log;
create trigger reading_time_log_set_updated_at before update on reading_time_log
  for each row execute function set_updated_at();

alter table users
  add column if not exists last_login_at timestamptz;
