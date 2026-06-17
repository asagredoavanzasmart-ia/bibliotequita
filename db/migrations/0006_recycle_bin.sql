-- 0006_recycle_bin.sql — Añadir soporte para borrado lógico (Papelera de Reciclaje).
-- Ejecutar manualmente en el SQL Editor de Supabase Studio.

ALTER TABLE library_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
