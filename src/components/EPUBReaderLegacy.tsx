// =============================================================================
// EPUBReader.tsx — Visor EPUB en SCROLL CONTINUO único.
// -----------------------------------------------------------------------------
// Antes existían dos modos (Páginas con swipe propio + Scroll). El modo
// Páginas se eliminó por completo: su sistema de gestos (drag con transform,
// preventDefault sobre el scroll nativo, umbrales, animación de "peek")
// competía con el scroll de columnas de epubjs y con el SwipeWrapper interno
// de react-reader, produciendo la "vibración"/rebote al deslizar y páginas
// que no avanzaban. Lo simple y robusto es UN solo modo: scroll continuo
// nativo (flow scrolled-doc + manager continuous), donde deslizar el dedo es
// scroll del navegador — sin gestos custom que puedan fallar.
//
// Qué se conserva/mejora:
//  - Contador de página GLOBAL "N / M" sobre todo el libro (book.locations),
//    con animación de carga al abrir mientras se calcula.
//  - Re-anclaje por CFI al cambiar el tamaño del contenedor: al abrir el
//    reproductor TTS o el panel de notas, el texto refluye pero se vuelve a
//    mostrar el punto exacto donde se estaba leyendo.
//  - Tap simple dentro del iframe → onContentTap (controles en fullscreen).
//  - Índice: únicamente el botón "≡" integrado de react-reader.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ReactReader, ReactReaderStyle } from 'react-reader';
import type { Rendition, Location as EpubLocation } from 'epubjs';
import { get } from 'idb-keyval';
import { List, ZoomIn, ZoomOut, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface EPUBReaderProps {
  url: string;
  getRendition?: (rendition: Rendition) => void;
  // Controla la visibilidad de la barra (auto-ocultado por inactividad,
  // controlado desde ReaderView). Por defecto siempre visible.
  controlsVisible?: boolean;
  // Oculta la franja integrada propia: se usa cuando el reproductor TTS está
  // abierto y sus mismos controles se portan (createPortal) a la fila del
  // widget TTS para fusionarse junto a los puntos de color de notas.
  hideOwnBar?: boolean;
  // Nodo DOM (gestionado por ReaderView) donde portar índice/zoom cuando
  // hideOwnBar es true. null/undefined → no se porta nada.
  mergedBarPortalTarget?: HTMLElement | null;
  // Tap simple (sin selección activa) dentro del contenido del EPUB. El
  // contenido vive en un <iframe> propio de epub.js que no burbujea eventos
  // al DOM padre de React, así que ReaderView no puede detectar el tap por
  // su propio onClick — este callback es la única forma de avisarle (p. ej.
  // para alternar el header/controles en fullscreen).
  onContentTap?: () => void;
}

const FONT_SIZES = [80, 90, 100, 110, 125, 150, 175, 200];
const DEFAULT_FONT_SIZE_INDEX = 2; // 100%
const MOBILE_DEFAULT_FONT_SIZE_INDEX = 4; // 125%

// react-reader monta por defecto dos flechas "‹"/"›" (ver
// node_modules/react-reader/dist/react-reader.es.js, ReactReaderStyle.arrow)
// en gris casi invisible y sin feedback de clic; su acción real (next/prev)
// tampoco corresponde a nada útil en flow scrolled-doc. Se ocultan por
// completo. Importante: hay que partir del objeto de estilos default completo
// (ReactReaderStyle) y solo pisar arrow/arrowHover — reemplazar el objeto
// entero deja sin estilos container/readerArea/reader (los que dan tamaño y
// posición al visor) y el EPUB deja de renderizarse por completo.
const HIDDEN_ARROW_STYLE = { display: 'none' } as const;
const READER_STYLES_NO_ARROWS = {
  ...ReactReaderStyle,
  arrow: { ...ReactReaderStyle.arrow, ...HIDDEN_ARROW_STYLE },
  arrowHover: { ...ReactReaderStyle.arrowHover, ...HIDDEN_ARROW_STYLE },
};

export function EPUBReader({ url, getRendition, controlsVisible = true, hideOwnBar = false, mergedBarPortalTarget = null, onContentTap }: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(0);
  const [actualUrl, setActualUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [fontSizeIndex, setFontSizeIndex] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  // Página global N/M sobre todo el libro (book.locations).
  const [pageProgress, setPageProgress] = useState<{ page: number; total: number } | null>(null);
  // true cuando book.locations.generate() terminó de recorrer TODO el libro:
  // habilita el contador global de páginas y apaga la animación de carga.
  const [locationsReady, setLocationsReady] = useState(false);
  const renditionRef = useRef<Rendition | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Espejo en ref para el listener de "relocated" (registrado una sola vez).
  const locationsReadyRef = useRef(false);

  // Drag handle de la franja integrada: mismo patrón de threshold (60px) que
  // el swipe-close del sidebar en Dashboard.tsx, adaptado a eje Y.
  const barTouchStartYRef = useRef<number | null>(null);
  const handleBarTouchStart = (e: React.TouchEvent) => {
    barTouchStartYRef.current = e.touches[0].clientY;
  };
  const handleBarTouchMove = (_e: React.TouchEvent) => {
    // Sin preventDefault: la franja no scrollea, no hay nada que bloquear.
  };
  const handleBarTouchEnd = (e: React.TouchEvent) => {
    if (barTouchStartYRef.current === null) return;
    const delta = e.changedTouches[0].clientY - barTouchStartYRef.current;
    barTouchStartYRef.current = null;
    if (delta > 60) setManuallyHidden(true);
    else if (delta < -60) setManuallyHidden(false);
  };

  // Detección de TAP dentro del iframe del contenido (solo tap; el scroll es
  // 100% nativo y no se intercepta nada — listeners pasivos, sin
  // preventDefault, sin transform: aquí estaba el origen de la "vibración").
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  const onContentTapRef = useRef(onContentTap);
  useEffect(() => { onContentTapRef.current = onContentTap; }, [onContentTap]);

  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;
    // En móvil el texto al 100% resulta pequeño; arrancamos con una fuente
    // mayor para que sea legible sin necesidad de ajustar el zoom manualmente.
    const isMobile = window.innerWidth < 768;
    const initialIndex = isMobile ? MOBILE_DEFAULT_FONT_SIZE_INDEX : DEFAULT_FONT_SIZE_INDEX;
    setFontSizeIndex(initialIndex);
    rendition.themes.fontSize(`${FONT_SIZES[initialIndex]}%`);
    // Muchos EPUBs traen su propio padding/margin grande en el body (definido
    // por el editor del libro); sin esto el texto queda con márgenes laterales
    // excesivos sin importar el ancho real del visor. Se fuerza un padding fijo
    // y reducido, consistente en todos los libros.
    rendition.themes.default({
      body: { padding: '0 4px !important', margin: '0 !important' },
      'p, div, section, article': { 'max-width': '100% !important' },
    });

    // Página global (sobre TODO el libro) a partir de book.locations. El
    // displayed.page/total de epubjs es POR CAPÍTULO (en secciones cortas
    // mostraba "1 / 1" como si el libro entero tuviera una página), así que
    // el contador se calcula siempre contra las locations globales.
    const updateGlobalPage = (cfi: string | undefined) => {
      if (!locationsReadyRef.current || !cfi) return;
      const locs = rendition.book.locations as any;
      const totalRaw = typeof locs.length === 'function' ? locs.length() : locs.total;
      const total = Number(totalRaw) || 0;
      const idx = Number(locs.locationFromCfi(cfi));
      if (total > 0 && Number.isFinite(idx) && idx >= 0) {
        setPageProgress({ page: Math.min(idx + 1, total), total });
      }
    };

    // book.locations.generate() recorre todo el libro una vez (los EPUB no
    // traen páginas fijas: hay que "paginar" el texto completo). Mientras
    // corre, el visor muestra la animación de carga (ver overlay) y al
    // terminar se habilita el contador global N/M.
    rendition.book.ready.then(() => rendition.book.locations.generate(1024)).then(() => {
      locationsReadyRef.current = true;
      setLocationsReady(true);
      updateGlobalPage(rendition.location?.start?.cfi);
    }).catch(() => {
      // EPUB sin spine recorrible: sin contador, pero no se deja la
      // animación de carga puesta para siempre.
      locationsReadyRef.current = true;
      setLocationsReady(true);
    });

    rendition.on('relocated', (loc: EpubLocation) => {
      updateGlobalPage(loc?.start?.cfi);
    });

    // El contenido de cada sección se renderiza en un <iframe> propio (otro
    // documento, no burbujea hacia el DOM padre de React); el tap se detecta
    // directamente dentro de cada iframe que epubjs monte. SOLO tap: nada de
    // move/preventDefault — el scroll queda enteramente en manos del navegador.
    rendition.hooks.content.register((contents: any) => {
      const doc = contents?.window?.document;
      if (!doc) return;
      doc.addEventListener('touchstart', (e: TouchEvent) => {
        tapStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }, { passive: true });
      doc.addEventListener('touchend', (e: TouchEvent) => {
        const start = tapStartRef.current;
        tapStartRef.current = null;
        if (!start) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          // No interceptar si el usuario está seleccionando texto: la
          // toolbar de citas depende de los eventos de selección de epubjs.
          const sel = doc.getSelection?.();
          if (sel && !sel.isCollapsed) return;
          onContentTapRef.current?.();
        }
      }, { passive: true });
    });

    getRendition?.(rendition);
  }, [getRendition]);

  const applyFontSize = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    renditionRef.current?.themes.fontSize(`${FONT_SIZES[clamped]}%`);
  }, []);

  // Re-anclaje al redimensionar: cuando el contenedor cambia de tamaño (abrir
  // el reproductor TTS, el panel de notas, rotar el teléfono, colapsar la
  // franja), el texto refluye y el punto de lectura se "corre". Se captura el
  // CFI actual ANTES del primer resize de la ráfaga y, cuando la ráfaga
  // termina (debounce), se vuelve a mostrar ese CFI — el lector queda exacto
  // donde estaba leyendo.
  const pendingRestoreCfiRef = useRef<string | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (!pendingRestoreCfiRef.current) {
        pendingRestoreCfiRef.current = (rendition as any).location?.start?.cfi || null;
      }
      rendition.resize(el.clientWidth, el.clientHeight);
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = setTimeout(() => {
        restoreTimerRef.current = null;
        const cfi = pendingRestoreCfiRef.current;
        pendingRestoreCfiRef.current = null;
        if (cfi) {
          (renditionRef.current as any)?.display?.(cfi)?.catch?.(() => { /* CFI inválido tras reflow: se queda donde está */ });
        }
      }, 300);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isActive = true;

    // Mismo esquema de resolución que PDFReader. Las nuevas URLs son
    // "/api/files/<uuid>.epub" y se cargan directo; mantenemos compatibilidad
    // con "idb://" y "blob:" para items legacy de la maqueta.
    const resolveUrl = async () => {
      setLoadError(false);
      try {
        if (url.startsWith('idb://')) {
          const file = await get(url);
          if (file && isActive) {
            objectUrl = URL.createObjectURL(file as Blob);
            setActualUrl(objectUrl);
          } else if (isActive) {
            setLoadError(true);
          }
        } else if (url.startsWith('blob:')) {
          const res = await fetch(url).catch(() => null);
          if (!res || !res.ok) {
            if (isActive) setLoadError(true);
          } else {
            if (isActive) setActualUrl(url);
          }
        } else {
          // URLs del servidor ("/api/files/...") y URLs públicas: directas.
          if (isActive) setActualUrl(url);
        }
      } catch (err) {
        if (isActive) setLoadError(true);
      }
    };

    resolveUrl();

    return () => {
      isActive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  // Contenido de la franja — extraído para poder renderizarse tanto in-place
  // (franja propia) como vía portal (fusionado en el widget TTS) sin duplicar
  // JSX. Una sola línea: [página N / M] [zoom − % +]. El índice vive
  // únicamente en el botón "≡" de arriba (el integrado de react-reader).
  const renderBarControls = () => (
    <>
      {/* min-w reservado para hasta 4 dígitos por lado ("8888 / 8888"):
          sin esto, libros con cientos/miles de páginas hacían que el
          número empujara y se viera amontonado contra los botones vecinos. */}
      <span className="text-xs font-mono font-semibold tabular-nums text-[var(--text-muted)] px-1 min-w-[78px] text-center shrink-0 inline-flex items-center justify-center" title="Página actual (global del libro)">
        {locationsReady && pageProgress
          ? <>{pageProgress.page} / {pageProgress.total}</>
          : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </span>
      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />

      <div className="flex items-center gap-1">
        <button
          disabled={fontSizeIndex <= 0}
          onClick={() => applyFontSize(fontSizeIndex - 1)}
          className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
          title="Reducir texto"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="text-xs font-mono font-semibold w-9 text-center tabular-nums">{FONT_SIZES[fontSizeIndex]}%</span>
        <button
          disabled={fontSizeIndex >= FONT_SIZES.length - 1}
          onClick={() => applyFontSize(fontSizeIndex + 1)}
          className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
          title="Aumentar texto"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
      </div>
    </>
  );

  return (
    <div className="h-full relative bg-[#f8fafc] flex justify-center">
      <div className="w-full h-full max-w-5xl shadow-xl bg-white border-x border-slate-200 relative flex flex-col">
         {loadError || !actualUrl ? (
            loadError && (
               <div className="w-full max-w-[600px] h-[400px] mx-auto mt-20 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center p-8 text-center text-slate-500 shadow-sm">
                  <div className="w-16 h-16 mb-4 text-slate-300"><List className="w-full h-full"/></div>
                  <p className="font-bold text-slate-700 mb-2">No se pudo cargar el documento EPUB</p>
                  <p className="text-sm">Si este archivo se subió localmente, es posible que el enlace temporal haya expirado. Por favor, vuelve a subir el archivo desde el editor.</p>
               </div>
            )
         ) : (
           <>
            <div ref={containerRef} className="flex-1 min-h-0 relative overflow-hidden">
              <div
                className="absolute inset-0"
                // react-reader monta SIEMPRE su propio SwipeWrapper
                // (react-swipeable) alrededor del visor, con onSwiped →
                // next()/prev() propio y sin ninguna prop para desactivarlo.
                // En scroll continuo un flick ligeramente diagonal podía
                // dispararlo y saltar de sección sin que el usuario lo
                // pidiera. Se frena en fase de CAPTURA para que el único
                // dueño del gesto sea el scroll nativo del iframe.
                onTouchStartCapture={(e) => e.stopPropagation()}
                onTouchMoveCapture={(e) => e.stopPropagation()}
                onTouchEndCapture={(e) => e.stopPropagation()}
              >
                <ReactReader
                  url={actualUrl}
                  location={location}
                  locationChanged={(epubcfi: string) => setLocation(epubcfi)}
                  getRendition={handleGetRendition}
                  readerStyles={READER_STYLES_NO_ARROWS}
                  epubInitOptions={{
                     openAs: 'epub'
                  }}
                  epubOptions={{ flow: 'scrolled-doc', manager: 'continuous' }}
                />
              </div>

              {/* Animación de carga mientras book.locations.generate() recorre
                  todo el libro (prepara el texto y el contador global N/M). */}
              {!locationsReady && (
                <div className="absolute inset-0 z-20 bg-white/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-9 h-9 animate-spin text-[var(--primary)]" />
                  <p className="text-sm font-medium text-[var(--text-muted)]">Preparando el libro…</p>
                </div>
              )}
            </div>

            {/* Franja integrada: en flujo normal del layout (no flotante),
                igual posición visual (abajo) pero como hermana del visor
                dentro del mismo contenedor flex-col, sin position: absolute. */}
            {!hideOwnBar && (
              <div className={cn(
                "shrink-0 w-full flex flex-col items-center bg-[var(--bg-card)] border-t border-[var(--border-card)] transition-all duration-300 overflow-hidden",
                (controlsVisible && !manuallyHidden) ? "max-h-16" : "max-h-[14px]"
              )}>
                {/* Manija: tap reabre si está colapsada; arrastrar hacia abajo
                    colapsa, hacia arriba reabre. */}
                <div
                  className="w-full flex justify-center py-1.5 cursor-grab touch-none shrink-0"
                  onTouchStart={handleBarTouchStart}
                  onTouchMove={handleBarTouchMove}
                  onTouchEnd={handleBarTouchEnd}
                  onClick={() => manuallyHidden && setManuallyHidden(false)}
                >
                  <div className="w-10 h-1 rounded-full bg-[var(--text-muted)]/40" />
                </div>

                {/* Una sola línea siempre: [página] [zoom]. Si en una pantalla
                    muy angosta no cupiera, scrollea lateralmente. */}
                <div className="flex items-center justify-center flex-nowrap gap-1.5 sm:gap-2 px-2 sm:px-4 pb-1.5 w-full text-[var(--text-main)] whitespace-nowrap overflow-x-auto no-scrollbar">
                  {renderBarControls()}
                  <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
                  <button
                    onClick={() => setManuallyHidden(true)}
                    className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
                    title="Ocultar controles"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Controles fusionados con el reproductor TTS: cuando hideOwnBar
                está activo, la franja propia no se monta (arriba) y estos
                mismos controles se portan a la fila del widget TTS. */}
            {hideOwnBar && mergedBarPortalTarget && createPortal(renderBarControls(), mergedBarPortalTarget)}
           </>
         )}
      </div>
    </div>
  );
}
