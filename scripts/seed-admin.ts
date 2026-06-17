// scripts/seed-admin.ts — Crea (o actualiza) el usuario administrador en Supabase.
//
// Uso: npx tsx scripts/seed-admin.ts
//
// Lee ADMIN_USERNAME / ADMIN_PASSWORD del .env, hashea la contraseña y hace
// upsert en la tabla `users` con role='admin', además de crear su fila en
// `user_limits` con límites ilimitados (0 = sin límite).

import dotenv from "dotenv";
dotenv.config();

import { supabase } from "../src/server/supabase.ts";
import { hashPassword } from "../src/server/password.ts";

async function main() {
  if (!supabase) {
    console.error("Error: SUPABASE_URL / SUPABASE_ANON_KEY (o SUPABASE_SERVICE_ROLE_KEY) no configurados en .env");
    process.exit(1);
  }

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error("Error: ADMIN_PASSWORD no está configurado en .env");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const { data: user, error: userError } = await supabase
    .from("users")
    .upsert(
      { username, password_hash: passwordHash, role: "admin", is_active: true },
      { onConflict: "username" }
    )
    .select()
    .single();

  if (userError) {
    console.error("Error al crear el usuario admin:", userError.message);
    process.exit(1);
  }

  const { error: limitsError } = await supabase
    .from("user_limits")
    .upsert(
      { user_id: user.id, max_uploads: 0, max_tts_chars: 0, max_ai_summaries: 0 },
      { onConflict: "user_id" }
    );

  if (limitsError) {
    console.error("Error al crear los límites del admin:", limitsError.message);
    process.exit(1);
  }

  console.log(`Usuario admin "${username}" creado/actualizado correctamente (id: ${user.id}).`);
}

main();
