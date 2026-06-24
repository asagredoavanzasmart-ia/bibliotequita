// =============================================================================
// useReadingTime.ts — Registro de tiempo de lectura diario
// -----------------------------------------------------------------------------
// Acumula en localStorage['library_reading_time'] (caché local, instantáneo
// para mostrar en AnalyticsDashboard) Y reporta al servidor con throttling
// (cada ~30s, no en cada tick) para que el admin pueda ver la actividad real
// de las cuentas de prueba desde el panel — antes el tiempo de lectura solo
// existía en el navegador del propio usuario y nunca llegaba al backend.
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

// Reporta segundos pendientes al servidor. Best-effort: si falla, el dato ya
// quedó a salvo en localStorage y simplemente no aparecerá en el panel admin.
function reportToServer(seconds: number) {
  if (seconds <= 0) return;
  const payload = JSON.stringify({ seconds: Math.round(seconds), day: todayKey() });
  // sendBeacon sobrevive a que la pestaña se cierre/navegue fuera justo
  // después de llamarlo (a diferencia de fetch, que puede cancelarse) — se
  // usa siempre que esté disponible, no solo en el cleanup final.
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/activity/reading-time', blob)) return;
    } catch { /* cae al fetch de abajo */ }
  }
  fetch('/api/activity/reading-time', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).catch(() => { /* no crítico */ });
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
  // Segundos acumulados desde el último reporte al servidor — se envían en
  // el intervalo de 30s (ya existente para el flush local) en vez de en cada
  // tick, para no saturar el backend con un POST por segundo.
  const pendingServerSecondsRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const flush = () => {
      if (lastTickRef.current !== null) {
        const elapsed = (Date.now() - lastTickRef.current) / 1000;
        addSeconds(elapsed);
        pendingServerSecondsRef.current += elapsed;
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
        reportToServer(pendingServerSecondsRef.current);
        pendingServerSecondsRef.current = 0;
      }
    };

    resume();
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('blur', handleVisibilityOrFocus);

    // Persistir periódicamente para no perder el tiempo si se cierra la pestaña abruptamente.
    const interval = setInterval(() => {
      flush();
      reportToServer(pendingServerSecondsRef.current);
      pendingServerSecondsRef.current = 0;
      resume();
    }, 30000);

    return () => {
      flush();
      reportToServer(pendingServerSecondsRef.current);
      pendingServerSecondsRef.current = 0;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('blur', handleVisibilityOrFocus);
    };
  }, [active]);
}
