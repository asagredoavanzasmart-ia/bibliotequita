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
}

export default function App() {
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

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

    fetch("/api/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setUser(data.user ?? null);
        setAuthLoading(false);
      })
      .catch(() => {
        setUser(null);
        setAuthLoading(false);
      });
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
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
