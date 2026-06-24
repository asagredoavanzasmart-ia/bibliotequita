-- 0010_ai_usage_counters.sql — contadores de uso reales para TTS y resúmenes
-- IA (hasta ahora solo existía el límite máximo, sin registrar consumo, a
-- diferencia de audit_analyses_used añadido en 0008). Ejecutar manualmente
-- vía psql o en el SQL Editor de Supabase Studio.

alter table user_limits
  add column if not exists tts_chars_used integer not null default 0,
  add column if not exists ai_summaries_used integer not null default 0;
