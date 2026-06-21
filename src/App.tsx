/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// =============================================================================
// App.tsx — Componente raíz
// -----------------------------------------------------------------------------
// Decide qué se renderiza en pantalla completa: Login, Dashboard o ReaderView.
// Verifica sesión activa via /api/me al arrancar.
// =============================================================================

import { useState, useEffect } from 'react';
import { LibraryProvider } from './hooks/useLibrary';
import { Dashboard } from './components/Dashboard';
import { ReaderView } from './components/ReaderView';
import { LoginScreen } from './components/LoginScreen';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  photo: string;
  role?: string;
}

const SPLASH_MIN_VISIBLE_MS = 1000;
const SPLASH_FADE_MS = 400;

export default function App() {
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  // El splash debe verse al menos SPLASH_MIN_VISIBLE_MS aunque /api/me responda
  // antes (si no, en conexiones rápidas el splash parpadearía sin que se note
  // el fade); showSplash controla el montaje, splashFadingOut dispara la
  // transición de opacidad antes de desmontarlo del todo.
  const [showSplash, setShowSplash] = useState(true);
  const [splashFadingOut, setSplashFadingOut] = useState(false);

  // Leer parámetro de error en la URL (ej: ?error=unauthorized)
  const urlError = new URLSearchParams(window.location.search).get("error");

  useEffect(() => {
    // Aplicar tema guardado para que LoginScreen tenga el estilo correcto de inmediato
    const savedTheme = localStorage.getItem('library_theme') || 'blue';
    document.documentElement.dataset.theme = savedTheme;

    // Cargar fuente guardada
    const savedFont = localStorage.getItem('library_font') || 'Inter';
    let fontValue = '"Inter", sans-serif';
    if (savedFont === 'Lora') fontValue = '"Lora", serif';
    if (savedFont === 'Playfair Display') fontValue = '"Playfair Display", serif';
    if (savedFont === 'Poppins') fontValue = '"Poppins", sans-serif';
    if (savedFont === 'Roboto') fontValue = '"Roboto", sans-serif';
    document.documentElement.style.setProperty('--app-font', fontValue);

    const startedAt = Date.now();
    fetch("/api/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setUser(data.user ?? null);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
        setTimeout(() => {
          setSplashFadingOut(true);
          setTimeout(() => setShowSplash(false), SPLASH_FADE_MS);
        }, remaining);
      });
  }, []);

  if (showSplash) {
    return (
      <div
        className="min-h-screen bg-[#e4e7fb] flex items-center justify-center transition-opacity"
        style={{ transitionDuration: `${SPLASH_FADE_MS}ms`, opacity: splashFadingOut ? 0 : 1 }}
      >
        <img src="/splash.jpg" alt="" className="w-full h-full object-cover animate-in fade-in" style={{ animationDuration: `${SPLASH_FADE_MS}ms` }} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen error={urlError || undefined} />;
  }

  return (
    <LibraryProvider>
      {activeBookId ? (
        <ReaderView bookId={activeBookId} onClose={() => setActiveBookId(null)} />
      ) : (
        <Dashboard onOpenBook={setActiveBookId} user={user} />
      )}
    </LibraryProvider>
  );
}
