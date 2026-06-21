-- 0008_user_limits_ai_tools.sql — límite de análisis de estudios + toggle de herramientas IA por usuario.
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

alter table user_limits
  add column if not exists max_audit_analyses integer not null default 0,
  add column if not exists audit_analyses_used integer not null default 0,
  add column if not exists ai_tools_enabled boolean not null default true;
