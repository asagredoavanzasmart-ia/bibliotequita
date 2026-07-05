import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ReactReader, ReactReaderStyle } from 'react-reader';
import type { Rendition, Location as EpubLocation } from 'epubjs';
import { get } from 'idb-keyval';
import { List, ZoomIn, ZoomOut, ChevronDown, BookOpen, AlignJustify, Loader2 } from 'lucide-react';
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
const VIEW_MODE_STORAGE_KEY = 'epub_view_mode';

type EpubViewMode = 'paginated' | 'scroll';

// react-reader monta por defecto dos flechas "‹"/"›" (ver
// node_modules/react-reader/dist/react-reader.es.js, ReactReaderStyle.arrow)
// en gris casi invisible y sin feedback de clic; su acción real (next/prev)
// tampoco corresponde a "página" en flow scrolled-doc. Se ocultan por
// completo: la navegación de modo Páginas vive en el overlay de gestos propio
// (ver renderPageGestureOverlay) y en modo Scroll no hay equivalente útil.
// Importante: hay que partir del objeto de estilos default completo
// (ReactReaderStyle) y solo pisar arrow/arrowHover — reemplazar el objeto
// entero deja sin estilos container/readerArea/reader (los que dan tamaño y
// posición al visor) y el EPUB deja de renderizarse por completo.
const HIDDEN_ARROW_STYLE = { display: 'none' } as const;
const READER_STYLES_NO_ARROWS = {
  ...ReactReaderStyle,
  arrow: { ...ReactReaderStyle.arrow, ...HIDDEN_ARROW_STYLE },
  arrowHover: { ...ReactReaderStyle.arrowHover, ...HIDDEN_ARROW_STYLE },
};

// El layout "paginado" de epubjs reparte el texto en columnas cuyo ancho se
// fija en píxeles según el contenedor en el momento del render; al
// redimensionar el panel (abrir/cerrar Anotaciones) ese ancho queda obsoleto
// y el contenido se desborda o se corta, sin importar cuántas veces se llame
// a spread()/resize() después. Por eso el modo Páginas debe re-disparar
// resize() del rendition cada vez que el contenedor cambia de tamaño (ver
// ResizeObserver más abajo) — en modo Scroll esto no hace falta porque el
// contenido siempre ocupa el 100% del ancho disponible sin columnas fijas.

export function EPUBReader({ url, getRendition, controlsVisible = true, hideOwnBar = false, mergedBarPortalTarget = null, onContentTap }: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(0);
  const [actualUrl, setActualUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [fontSizeIndex, setFontSizeIndex] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [viewMode, setViewMode] = useState<EpubViewMode>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) : null;
    return saved === 'paginated' ? 'paginated' : 'scroll';
  });
  // Progreso mostrado en la franja: página N/M (global, sobre todo el libro,
  // calculado con book.locations) en modo Páginas, % en modo Scroll.
  const [pageProgress, setPageProgress] = useState<{ page: number; total: number } | null>(null);
  const [percentProgress, setPercentProgress] = useState<number | null>(null);
  // true cuando book.locations.generate() terminó de recorrer TODO el libro:
  // habilita el contador global de páginas y apaga la animación de carga.
  const [locationsReady, setLocationsReady] = useState(false);
  const renditionRef = useRef<Rendition | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Espejo en ref para el listener de "relocated" (registrado una sola vez).
  const locationsReadyRef = useRef(false);

  const setViewModePersisted = useCallback((mode: EpubViewMode) => {
    setViewMode(mode);
    setPageProgress(null);
    setPercentProgress(null);
    locationsReadyRef.current = false;
    setLocationsReady(false);
    try { window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch { /* localStorage puede no estar disponible (modo privado) */ }
  }, []);

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

  // --- Gestos del modo Páginas (swipe + tap-zone + slide/peek) ---
  // epub.js no anima la transición de next()/prev(); el efecto de "asomar" la
  // página siguiente se construye aparte: durante el arrastre se traslada
  // visualmente todo el panel con CSS transform (sin tocar el rendition real),
  // y solo al soltar el dedo se dispara next()/prev() una vez confirmado el
  // gesto. Esto evita pedirle a epubjs relayouts a mitad de gesto.
  //
  // Los listeners se adjuntan DENTRO del iframe de epubjs (ver
  // rendition.hooks.content.register más abajo) porque el contenido vive en
  // otro documento y no burbujea touch events hacia el DOM de React. Por eso
  // se usa un ref con los handlers "vivos": el listener del iframe se
  // registra una sola vez por sección cargada, pero debe ejecutar siempre la
  // versión más reciente de la lógica (que sí depende de state).
  const [dragOffset, setDragOffset] = useState(0);
  const [dragAnimating, setDragAnimating] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragWidthRef = useRef(0);
  // ANTES: al confirmar el swipe se animaba el offset hacia afuera y solo
  // 220ms DESPUÉS (a ciegas, sin importar si epubjs ya había terminado) se
  // llamaba a next()/prev() y se quitaba el offset. Si epubjs tardaba más de
  // 220ms en renderizar la sección nueva (página con imágenes, sección
  // pesada), el usuario veía la pantalla en blanco más tiempo del esperado y
  // lo interpretaba como que el gesto "no funcionó" — de ahí "hay que hacer
  // varios slides", "la hoja queda vibrando", "no carga".
  //
  // AHORA: next()/prev() se llama de inmediato (en paralelo con la animación
  // de salida, no después), y el offset solo se quita cuando epubjs confirma
  // vía el evento "relocated" que el contenido nuevo ya está listo — con un
  // timeout de seguridad por si ese evento no llegara. Así el offset nunca
  // queda "esperando a ciegas": refleja el tiempo real de carga.
  const pageChangeInFlightRef = useRef(false);
  const safetyTimeoutRef = useRef<number | null>(null);

  const resolvePageChange = useCallback(() => {
    if (!pageChangeInFlightRef.current) return;
    pageChangeInFlightRef.current = false;
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
    setDragOffset(0);
    setDragAnimating(false);
  }, []);
  // Ref estable para invocar resolvePageChange desde el listener de
  // "relocated" (registrado una vez en handleGetRendition) sin tener que
  // re-registrar el listener cada vez que resolvePageChange cambiara.
  const resolvePageChangeRef = useRef(resolvePageChange);
  useEffect(() => { resolvePageChangeRef.current = resolvePageChange; }, [resolvePageChange]);

  const flushPendingPageChange = useCallback(() => {
    // Si había un gesto en curso cuando empieza uno nuevo, se resuelve de
    // inmediato el anterior (sin esperar a "relocated") para no perder el
    // turno ni dejar offsets/estado a medio camino.
    resolvePageChange();
  }, [resolvePageChange]);

  const handlePageGestureStart = useCallback((e: TouchEvent) => {
    // No interceptar el gesto si el usuario está seleccionando texto: epubjs
    // emite 'selected'/'click' en el iframe interno y la toolbar de citas
    // depende de que esos eventos lleguen sin que este gesto los tape.
    const target = e.target as Node;
    const sel = (target?.getRootNode?.() as Document)?.getSelection?.() ?? (e.view as Window | null)?.getSelection?.();
    if (sel && !sel.isCollapsed) return;
    flushPendingPageChange();
    dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    dragWidthRef.current = containerRef.current?.clientWidth || window.innerWidth;
  }, [flushPendingPageChange]);

  const handlePageGestureMove = useCallback((e: TouchEvent) => {
    if (!dragStartRef.current || viewMode !== 'paginated') return;
    const dx = e.touches[0].clientX - dragStartRef.current.x;
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    // Gesto predominantemente vertical: es scroll/lectura normal, no swipe de página.
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dx) < 15) return;
    // Gesto ya horizontal: cancelar el scroll nativo del iframe para que no
    // secuestre el arrastre (requiere que el listener de touchmove esté
    // registrado con passive: false — con passive: true el navegador se
    // quedaba con el gesto y el swipe de página "no funcionaba").
    if (Math.abs(dx) > 10 && e.cancelable) e.preventDefault();
    setDragOffset(dx);
  }, [viewMode]);

  const handlePageGestureEnd = useCallback((e: TouchEvent) => {
    if (!dragStartRef.current) return;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    const width = dragWidthRef.current || window.innerWidth;
    const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;

    // Modo Scroll: no hay paginación por gesto, solo nos interesa detectar el
    // tap simple para avisar a ReaderView (mostrar/ocultar controles en
    // fullscreen) — un swipe aquí es scroll normal, no se intercepta.
    if (viewMode !== 'paginated') {
      if (isTap) onContentTap?.();
      return;
    }

    if (isTap) {
      // Tap, no swipe: tercio izq/der pasa de página, tercio central alterna
      // la visibilidad de la franja (mismo rol que el tap-to-toggle de PDF).
      setDragOffset(0);
      const tapX = e.changedTouches[0].clientX;
      const third = width / 3;
      if (tapX < third) {
        renditionRef.current?.prev();
      } else if (tapX > third * 2) {
        renditionRef.current?.next();
      } else {
        setManuallyHidden(v => !v);
      }
      onContentTap?.();
      return;
    }

    const threshold = width * 0.3;
    setDragAnimating(true);
    if (dx <= -threshold || dx >= threshold) {
      setDragOffset(dx <= -threshold ? -width : width);
      pageChangeInFlightRef.current = true;
      // next()/prev() se piden YA, en paralelo con la animación de salida —
      // el offset se quita cuando "relocated" confirme que el contenido
      // nuevo está listo (resolvePageChange), no tras un tiempo fijo a ciegas.
      if (dx <= -threshold) renditionRef.current?.next();
      else renditionRef.current?.prev();
      // Salvaguarda: si por lo que sea epubjs nunca emite "relocated" (libro
      // con error, última/primera página sin destino), no se deja la
      // pantalla en blanco indefinidamente.
      safetyTimeoutRef.current = window.setTimeout(resolvePageChange, 1200);
    } else {
      setDragOffset(0);
      window.setTimeout(() => setDragAnimating(false), 220);
    }
  }, [viewMode, onContentTap, resolvePageChange]);

  // Ref estable que el listener del iframe consulta en cada evento, para
  // siempre invocar la versión más reciente de los handlers sin tener que
  // re-registrar el listener cada vez que cambia el estado de React.
  const pageGestureHandlersRef = useRef({
    onStart: (e: Event) => handlePageGestureStart(e as TouchEvent),
    onMove: (e: Event) => handlePageGestureMove(e as TouchEvent),
    onEnd: (e: Event) => handlePageGestureEnd(e as TouchEvent),
  });
  useEffect(() => {
    pageGestureHandlersRef.current = {
      onStart: (e: Event) => handlePageGestureStart(e as TouchEvent),
      onMove: (e: Event) => handlePageGestureMove(e as TouchEvent),
      onEnd: (e: Event) => handlePageGestureEnd(e as TouchEvent),
    };
  }, [handlePageGestureStart, handlePageGestureMove, handlePageGestureEnd]);

  // Si el componente se desmonta con un cambio de página en vuelo, se cancela
  // el timeout de seguridad para no tocar estado tras desmontar.
  useEffect(() => () => {
    if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
  }, []);

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
      setPercentProgress(Math.round(rendition.book.locations.percentageFromCfi(cfi) * 100));
    };

    // book.locations.generate() recorre todo el libro una vez (los EPUB no
    // traen páginas fijas: hay que "paginar" el texto completo). Mientras
    // corre, el visor muestra la animación de carga (ver overlay) y al
    // terminar se habilitan el contador global N/M y el % de progreso.
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
      // El contenido de la nueva sección/página ya está listo: si había un
      // cambio de página en vuelo por gesto de swipe, se resuelve ahora (en
      // vez de esperar un tiempo fijo a ciegas que podía dejar la pantalla en
      // blanco más tiempo del necesario, o menos del real).
      resolvePageChangeRef.current();
    });

    // El contenido de cada sección se renderiza en un <iframe> propio (otro
    // documento, no burbujea hacia el DOM padre de React) por lo que el
    // swipe/tap del modo Páginas se adjunta directamente dentro de cada
    // iframe que epubjs vaya montando — mismo patrón que usa la propia
    // librería react-reader para su listener de "wheel" (pageTurnOnScroll).
    rendition.hooks.content.register((contents: any) => {
      const doc = contents?.window?.document;
      if (!doc) return;
      doc.addEventListener('touchstart', pageGestureHandlersRef.current.onStart, { passive: true });
      // passive: false — el move debe poder llamar a preventDefault() cuando
      // el gesto es horizontal, o el scroll nativo se queda con el arrastre.
      doc.addEventListener('touchmove', pageGestureHandlersRef.current.onMove, { passive: false });
      doc.addEventListener('touchend', pageGestureHandlersRef.current.onEnd, { passive: true });
    });

    getRendition?.(rendition);
  }, [getRendition]);

  const applyFontSize = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    renditionRef.current?.themes.fontSize(`${FONT_SIZES[clamped]}%`);
  }, []);

  // El layout paginado fija el ancho de columna en píxeles al montar; si el
  // contenedor cambia de tamaño después (fullscreen, colapso de la franja
  // integrada, rotación) hay que avisar a epubjs explícitamente o el texto
  // queda recortado u ocupa solo una porción del espacio disponible.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      rendition.resize(el.clientWidth, el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);

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
  // JSX. Una sola línea: [libro/scroll] [página N / M] [zoom − % +].
  // El índice vive únicamente en el botón "≡" de arriba (el integrado de
  // react-reader); el panel de índice propio que se abría desde aquí se
  // eliminó por duplicado.
  const renderBarControls = () => (
    <>
      <button
        onClick={() => setViewModePersisted(viewMode === 'paginated' ? 'scroll' : 'paginated')}
        className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
        title={viewMode === 'paginated' ? "Cambiar a vista de scroll continuo" : "Cambiar a vista de páginas"}
      >
        {viewMode === 'paginated' ? <BookOpen className="w-5 h-5" /> : <AlignJustify className="w-5 h-5" />}
      </button>

      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />

      {viewMode === 'paginated' && (
        <>
          {/* min-w reservado para hasta 4 dígitos por lado ("8888 / 8888"):
              sin esto, libros con cientos/miles de páginas hacían que el
              número empujara y se viera amontonado contra los botones vecinos. */}
          <span className="text-xs font-mono font-semibold tabular-nums text-[var(--text-muted)] px-1 min-w-[78px] text-center shrink-0 inline-flex items-center justify-center" title="Página actual">
            {locationsReady && pageProgress
              ? <>{pageProgress.page} / {pageProgress.total}</>
              : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          </span>
          <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
        </>
      )}
      {viewMode === 'scroll' && percentProgress !== null && (
        <>
          <span className="text-xs font-mono font-semibold tabular-nums text-[var(--text-muted)] px-1" title="Progreso de lectura">
            {percentProgress}%
          </span>
          <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
        </>
      )}

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
                style={{
                  transform: dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined,
                  transition: dragAnimating ? 'transform 220ms ease-out' : undefined,
                }}
                // react-reader monta SIEMPRE su propio SwipeWrapper (react-swipeable)
                // alrededor del visor, con onSwiped→next()/prev() propio — sin
                // ninguna prop para desactivarlo. Cuando el navegador entrega ese
                // gesto también a este wrapper externo (p. ej. el touchend cae
                // sobre el div contenedor en vez de dentro del iframe, algo más
                // probable durante el arrastre porque este div se desplaza con
                // translateX), los DOS sistemas de gestos terminan compitiendo:
                // el propio (registrado dentro del iframe, ver handleGetRendition)
                // ya decidió una dirección/página, y el de la librería dispara
                // next()/prev() por su cuenta con su propio umbral — de ahí el
                // "rebote" que se veía sobre todo yendo hacia la izquierda. Se
                // frena en fase de CAPTURA (antes de llegar al SwipeWrapper) para
                // que solo exista un dueño del gesto de página en modo Páginas.
                onTouchStartCapture={viewMode === 'paginated' ? (e) => e.stopPropagation() : undefined}
                onTouchMoveCapture={viewMode === 'paginated' ? (e) => e.stopPropagation() : undefined}
                onTouchEndCapture={viewMode === 'paginated' ? (e) => e.stopPropagation() : undefined}
              >
                <ReactReader
                  key={viewMode}
                  url={actualUrl}
                  location={location}
                  locationChanged={(epubcfi: string) => setLocation(epubcfi)}
                  getRendition={handleGetRendition}
                  readerStyles={READER_STYLES_NO_ARROWS}
                  epubInitOptions={{
                     openAs: 'epub'
                  }}
                  epubOptions={
                    viewMode === 'paginated'
                      ? { flow: 'paginated', manager: 'default', spread: 'none' }
                      : { flow: 'scrolled-doc', manager: 'continuous' }
                  }
                />
              </div>

              {/* Animación de carga mientras book.locations.generate() recorre
                  todo el libro para la paginación global del modo Páginas. */}
              {viewMode === 'paginated' && !locationsReady && (
                <div className="absolute inset-0 z-20 bg-white/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-9 h-9 animate-spin text-[var(--primary)]" />
                  <p className="text-sm font-medium text-[var(--text-muted)]">Preparando páginas…</p>
                </div>
              )}
            </div>

            {/* Franja integrada: en flujo normal del layout (no flotante),
                igual posición visual (abajo) pero como hermana del visor
                dentro del mismo contenedor flex-col, sin position: absolute. */}
            {!hideOwnBar && (
              <div className={cn(
                "shrink-0 w-full flex flex-col items-center bg-[var(--bg-card)] border-t border-[var(--border-card)] transition-all duration-300 overflow-hidden",
                // Sin el botón de índice ni el salto de línea del zoom, los
                // controles caben en UNA sola fila también en móvil: manija +
                // fila de botones entran en max-h-12.
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

                {/* Una sola línea siempre: [libro/scroll] [página] [zoom]. Si en
                    una pantalla muy angosta no cupiera, scrollea lateralmente
                    en vez de partirse en dos líneas. */}
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
