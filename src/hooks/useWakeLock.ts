import { useEffect, useRef } from 'react';

/**
 * Mantiene la pantalla encendida mientras `active` sea true, usando la Screen
 * Wake Lock API (https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API).
 *
 * Casos de uso: lectura por voz (TTS) y reproducción de video/audio, para que
 * el móvil no se bloquee solo a mitad de la reproducción.
 *
 * - El navegador libera el lock automáticamente cuando la pestaña pasa a segundo
 *   plano; por eso se re-adquiere en `visibilitychange` al volver a primer plano.
 * - Si la API no está disponible (navegadores antiguos / iOS Safari viejo), el
 *   hook simplemente no hace nada (degradación silenciosa).
 */
export function useWakeLock(active: boolean) {
  const lockRef = useRef<any>(null);

  useEffect(() => {
    const nav: any = navigator;
    if (!('wakeLock' in nav)) return;

    let cancelled = false;

    const request = async () => {
      try {
        if (cancelled || !active) return;
        if (lockRef.current) return;
        lockRef.current = await nav.wakeLock.request('screen');
        lockRef.current.addEventListener?.('release', () => {
          lockRef.current = null;
        });
      } catch {
        // Puede fallar si el documento no está visible o por política del SO;
        // no es crítico, se reintentará en el próximo visibilitychange.
        lockRef.current = null;
      }
    };

    const release = async () => {
      try {
        await lockRef.current?.release?.();
      } catch { /* noop */ }
      lockRef.current = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && active) request();
    };

    if (active) {
      request();
      document.addEventListener('visibilitychange', onVisibility);
    } else {
      release();
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [active]);
}
