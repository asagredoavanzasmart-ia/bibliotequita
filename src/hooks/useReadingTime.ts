// =============================================================================
// useReadingTime.ts — Registro de tiempo de lectura diario
// -----------------------------------------------------------------------------
// Acumula en localStorage['library_reading_time'] los segundos que el usuario
// pasa con un libro abierto en ReaderView, agrupados por día (YYYY-MM-DD).
// Solo cuenta tiempo mientras la pestaña está visible/enfocada, para no sumar
// minutos "fantasma" si el usuario deja la app abierta en otra pestaña.
// =============================================================================

import { useEffect, useRef } from 'react';

const STORAGE_KEY = 'library_reading_time';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addSeconds(seconds: number) {
  if (seconds <= 0) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data: Record<string, number> = raw ? JSON.parse(raw) : {};
    const key = todayKey();
    data[key] = (data[key] || 0) + seconds;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* localStorage no disponible */ }
}

// Lee el registro completo de tiempo de lectura por día.
export function getReadingTimeLog(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Monta este hook mientras un libro está abierto en el lector.
export function useReadingTimeTracker(active: boolean) {
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const flush = () => {
      if (lastTickRef.current !== null) {
        const elapsed = (Date.now() - lastTickRef.current) / 1000;
        addSeconds(elapsed);
        lastTickRef.current = null;
      }
    };

    const resume = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        lastTickRef.current = Date.now();
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        resume();
      } else {
        flush();
      }
    };

    resume();
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('blur', flush);

    // Persistir periódicamente para no perder el tiempo si se cierra la pestaña abruptamente.
    const interval = setInterval(() => {
      flush();
      resume();
    }, 30000);

    return () => {
      flush();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('blur', flush);
    };
  }, [active]);
}
