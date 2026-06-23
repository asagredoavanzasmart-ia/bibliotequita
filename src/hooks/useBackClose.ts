// =============================================================================
// useBackClose.ts — Hace que el botón/gesto "Atrás" del dispositivo cierre una
// capa de la UI (lector, modal, panel lateral) en vez de salir de la app.
// -----------------------------------------------------------------------------
// La app es una SPA de una sola pantalla que nunca toca el historial del
// navegador: hoy, presionar "Atrás" en Android simplemente sale de la app
// (no hay ninguna entrada de historial que deshacer primero).
//
// Este hook engancha cualquier estado "abierto/cerrado" (un modal, el lector,
// el sidebar móvil) al History API:
//   - Al abrirse (isOpen: false -> true), añade una entrada al historial y se
//     registra en una pila global de capas abiertas.
//   - Si el usuario presiona Atrás, el navegador dispara "popstate" — solo la
//     capa que esté en el TOPE de la pila (la última abierta) reacciona y se
//     cierra; las capas más externas (p.ej. el lector, si hay un panel de
//     notas abierto encima) no se enteran de ese popstate. Así, con varias
//     capas anidadas, cada pulsación de Atrás cierra una sola, de adentro
//     hacia afuera, en el orden en que el usuario las abrió.
//   - Si una capa se cierra por otro medio (botón "X" en pantalla, no por
//     Atrás), se consume su entrada de historial con history.back() para no
//     dejar una entrada "fantasma" que obligaría a presionar Atrás de más sin
//     efecto visible la próxima vez.
// =============================================================================

import { useEffect, useRef } from 'react';

let layerStack: symbol[] = [];

export function useBackClose(isOpen: boolean, onClose: () => void) {
  const idRef = useRef<symbol>(Symbol());
  // true mientras este hook es quien generó el popstate actual (para no
  // intentar consumir con history.back() una entrada que el propio gesto
  // de "Atrás" ya consumió).
  const closingFromPopRef = useRef(false);
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      layerStack.push(idRef.current);
      window.history.pushState({ backCloseLayer: true }, '');
    } else if (!isOpen && wasOpenRef.current) {
      layerStack = layerStack.filter(id => id !== idRef.current);
      if (!closingFromPopRef.current) {
        // Se cerró por un medio distinto al botón Atrás: consumimos la
        // entrada que habíamos añadido, para que el historial no acumule
        // capas ya cerradas.
        window.history.back();
      }
    }
    closingFromPopRef.current = false;
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPopState = () => {
      // Solo la capa más reciente (tope de la pila) responde a este Atrás.
      if (layerStack[layerStack.length - 1] !== idRef.current) return;
      closingFromPopRef.current = true;
      layerStack = layerStack.filter(id => id !== idRef.current);
      onClose();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isOpen, onClose]);

  // Si el componente se desmonta de golpe mientras seguía abierto (p.ej. el
  // padre deja de renderizarlo sin pasar primero por isOpen=false — caso del
  // sidebar móvil si se abre un libro sin cerrarlo antes), la entrada de
  // historial que se había añadido queda "huérfana": se consume aquí también,
  // para que no haga falta un Atrás extra sin efecto visible más adelante.
  useEffect(() => () => {
    const wasInStack = layerStack.includes(idRef.current);
    layerStack = layerStack.filter(id => id !== idRef.current);
    if (wasInStack && wasOpenRef.current && !closingFromPopRef.current) {
      window.history.back();
    }
  }, []);
}
