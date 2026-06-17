// src/server/supabase.ts — Cliente de Supabase (vía API REST/Kong autoalojado).
//
// Fase 1: solo provee el cliente y un chequeo de salud. La app NO depende de
// Supabase para arrancar — si SUPABASE_URL/SUPABASE_ANON_KEY no están
// configurados, checkDbConnection() reporta el error sin lanzar excepciones.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import WebSocket from "ws";

// Polyfill para WebSocket en entornos Node.js < 22 (necesario para el cliente de Supabase / Realtime)
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket as any;
}

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    : null;

if (!supabase) {
  console.log("[DB] Sin SUPABASE_URL/SUPABASE_ANON_KEY configurados — la base de datos no está disponible.");
}

export async function checkDbConnection(): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!supabase) {
    return { ok: false, error: "SUPABASE_URL/SUPABASE_ANON_KEY no configurados" };
  }
  try {
    const { error, count } = await supabase.from("users").select("*", { count: "exact", head: true });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, count: count ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
