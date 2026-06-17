-- 0004_audit_result.sql — persiste el resultado de la Auditoría Científica
-- (Gemini) por documento, para que no se pierda al cerrar el panel.
-- Ejecutar manualmente vía psql o en el SQL Editor de Supabase Studio.

alter table document_settings
  add column if not exists audit_result jsonb;
