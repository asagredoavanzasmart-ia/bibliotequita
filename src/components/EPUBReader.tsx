import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ReactReader, ReactReaderStyle } from 'react-reader';
import type { Rendition, Location as EpubLocation } from 'epubjs';
import type { NavItem } from 'epubjs';
import { get } from 'idb-keyval';
import { List, ZoomIn, ZoomOut, ChevronLeft, ChevronDown, BookOpen, AlignJustify } from 'lucide-react';
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
  const [toc, setToc] = useState<NavItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [fontSizeIndex, setFontSizeIndex] = useState(DEFAULT_FONT_SIZE_INDEX);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [viewMode, setViewMode] = useState<EpubViewMode>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) : null;
    return saved === 'paginated' ? 'paginated' : 'scroll';
  });
  // Progreso mostrado en la franja: página N/M en modo Páginas, % en modo Scroll.
  const [pageProgress, setPageProgress] = useState<{ page: number; total: number } | null>(null);
  const [percentProgress, setPercentProgress] = useState<number | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const locationsReadyRef = useRef(false);

  const setViewModePersisted = useCallback((mode: EpubViewMode) => {
    setViewMode(mode);
    setPageProgress(null);
    setPercentProgress(null);
    locationsReadyRef.current = false;
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
    rendition.book.loaded.navigation.then((nav) => setToc(nav.toc));

    // book.locations.generate() necesita recorrer todo el libro una vez; se
    // dispara en segundo plano sin bloquear la lectura. Habilita el % de
    // progreso en modo Scroll (página/total real ya viene gratis del propio
    // evento "relocated" en modo Páginas, sin necesitar locations).
    rendition.book.ready.then(() => rendition.book.locations.generate(1024)).then(() => {
      locationsReadyRef.current = true;
      const current = rendition.location?.start?.cfi;
      if (current) {
        setPercentProgress(Math.round(rendition.book.locations.percentageFromCfi(current) * 100));
      }
    }).catch(() => { /* EPUB sin spine recorrible; deja el indicador vacío */ });

    rendition.on('relocated', (loc: EpubLocation) => {
      // Justo al abrir el libro, epubjs puede emitir "relocated" antes de que
      // su paginación interna termine de calcularse: displayed.page/total
      // llegan como valores no numéricos (se ha visto el string "!"), lo que
      // mostraba "1 / !" en el contador. Se descartan valores inválidos en
      // vez de mostrarlos — el contador simplemente espera al próximo evento
      // ya estable, en lugar de enseñar un número incorrecto.
      const displayed = loc?.start?.displayed;
      if (displayed && Number.isFinite(displayed.page) && Number.isFinite(displayed.total) && displayed.total > 0) {
        setPageProgress({ page: displayed.page, total: displayed.total });
      }
      if (locationsReadyRef.current && loc?.start?.cfi) {
        setPercentProgress(Math.round(rendition.book.locations.percentageFromCfi(loc.start.cfi) * 100));
      }
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
      doc.addEventListener('touchmove', pageGestureHandlersRef.current.onMove, { passive: true });
      doc.addEventListener('touchend', pageGestureHandlersRef.current.onEnd, { passive: true });
    });

    getRendition?.(rendition);
  }, [getRendition]);

  const applyFontSize = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    renditionRef.current?.themes.fontSize(`${FONT_SIZES[clamped]}%`);
  }, []);

  const goToTocItem = useCallback((href: string) => {
    renditionRef.current?.display(href);
    setShowToc(false);
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

  // Contenido de índice/zoom de fuente — extraído para poder renderizarse
  // tanto in-place (franja propia) como vía portal (fusionado en el widget
  // TTS) sin duplicar JSX.
  const renderBarControls = () => (
    <>
      <button
        onClick={() => setShowToc(v => !v)}
        className={cn(
          "p-2.5 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all",
          showToc && "text-[var(--primary)] bg-[var(--primary)]/10"
        )}
        title={showToc ? "Cerrar índice" : "Índice"}
      >
        {/* Con el índice abierto, el ícono cambia a una flecha "‹" para
            indicar que volver a tocarlo lo cierra (en vez de mantener el
            mismo ícono de lista, que no comunicaba esa acción). */}
        {showToc ? <ChevronLeft className="w-5 h-5" /> : <List className="w-5 h-5" />}
      </button>

      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />

      <button
        onClick={() => setViewModePersisted(viewMode === 'paginated' ? 'scroll' : 'paginated')}
        className="p-2.5 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
        title={viewMode === 'paginated' ? "Cambiar a vista de scroll continuo" : "Cambiar a vista de páginas"}
      >
        {viewMode === 'paginated' ? <BookOpen className="w-5 h-5" /> : <AlignJustify className="w-5 h-5" />}
      </button>

      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />

      {viewMode === 'paginated' && pageProgress && (
        <>
          {/* min-w reservado para hasta 4 dígitos por lado ("8888 / 8888"):
              sin esto, libros con cientos/miles de páginas hacían que el
              número empujara y se viera amontonado contra los botones vecinos. */}
          <span className="text-xs font-mono font-semibold tabular-nums text-[var(--text-muted)] px-1 min-w-[78px] text-center shrink-0" title="Página actual">
            {pageProgress.page} / {pageProgress.total}
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

      {/* Fuerza el salto a una 2da línea en pantallas angostas (flex-wrap del
          contenedor padre): el grupo de zoom queda siempre en su propia fila
          en vez de comprimirse junto al resto con scroll horizontal. */}
      <div className="w-full h-0 sm:hidden" />

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

  const renderTocItems = (items: NavItem[], depth = 0) => (
    <ul className={cn(depth > 0 && "ml-3 border-l border-slate-200 pl-2")}>
      {items.map((navItem) => (
        <li key={navItem.id}>
          <button
            onClick={() => goToTocItem(navItem.href)}
            className="block w-full text-left text-base md:text-sm text-slate-700 hover:text-[var(--primary)] py-2 md:py-1.5 px-1 rounded hover:bg-[var(--primary)]/5 transition-colors truncate"
            title={navItem.label?.trim()}
          >
            {navItem.label?.trim()}
          </button>
          {navItem.subitems && navItem.subitems.length > 0 && renderTocItems(navItem.subitems, depth + 1)}
        </li>
      ))}
    </ul>
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

              {/* Panel de Índice (TOC): overlay a pantalla completa por encima de
                  cualquier otro contenido (incluido el reproductor TTS y el
                  header del lector) en móvil, panel lateral en tablet/PC —
                  mismo patrón que el outline del PDF. z-[60] (no z-50) para
                  escapar del stacking context del panel del lector y quedar
                  por encima del header (z-30) y la barra TTS (z-40). */}
              {showToc && (
                <div className="fixed inset-0 z-[60] flex">
                  <div className="absolute inset-0 bg-black/30 md:hidden" onClick={() => setShowToc(false)} />
                  {/* bg-white sólido (no bg-card, que es semitransparente por
                      diseño en tarjetas normales): este panel se superpone al
                      texto del documento y debe ser completamente opaco — antes
                      se veía "transparente", con el texto de fondo calándose
                      a través de la lista de capítulos. */}
                  <div className="relative z-10 w-full md:w-72 h-full bg-white dark:bg-slate-900 border-r border-[var(--border-card)] shadow-2xl flex flex-col">
                    <div className="p-4 border-b border-[var(--border-card)] bg-slate-50 dark:bg-slate-800 flex-none flex items-center justify-between">
                      <h3 className="font-bold text-[var(--text-main)] text-sm flex items-center gap-2">
                        <List className="w-4 h-4" /> Índice
                      </h3>
                      <button onClick={() => setShowToc(false)} className="text-[var(--text-muted)] hover:text-[var(--primary)] p-2 transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                      {toc.length > 0 ? renderTocItems(toc) : (
                        <p className="text-sm text-slate-400 text-center mt-4">Este libro no tiene índice.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Franja integrada: en flujo normal del layout (no flotante),
                igual posición visual (abajo) pero como hermana del visor
                dentro del mismo contenedor flex-col, sin position: absolute. */}
            {!hideOwnBar && (
              <div className={cn(
                "shrink-0 w-full flex flex-col items-center bg-[var(--bg-card)] border-t border-[var(--border-card)] transition-all duration-300 overflow-hidden",
                // En móvil los controles pueden partirse en 2 líneas (flex-wrap
                // más abajo) + la manija de arrastre arriba: max-h-24 (96px) no
                // dejaba espacio suficiente y la segunda línea quedaba cortada
                // por el overflow-hidden. max-h-32 (128px) cubre manija + 2
                // líneas de botones con margen. En sm: sigue en una sola fila.
                (controlsVisible && !manuallyHidden) ? "max-h-32 sm:max-h-12" : "max-h-[14px]"
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

                {/* En pantallas angostas (vertical) los controles se parten en
                    2 líneas (flex-wrap) en vez de forzar scroll horizontal —
                    en pantallas anchas (sm:) siguen en una sola fila. */}
                <div className="flex items-center justify-center flex-wrap sm:flex-nowrap gap-2 px-3 sm:px-4 pb-1.5 w-full text-[var(--text-main)] sm:whitespace-nowrap sm:overflow-x-auto no-scrollbar">
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
