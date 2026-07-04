// =============================================================================
// PDFReader.tsx — Lector PDF
// -----------------------------------------------------------------------------
// Wrapper sobre react-pdf con:
//   - Scroll continuo de TODAS las páginas (no paginación tradicional).
//   - IntersectionObserver detecta la página más visible y actualiza pageNumber.
//   - Soporte de 3 esquemas de URL para `url`:
//       · idb://<key>   → blob persistido en IndexedDB (idb-keyval).
//       · blob:...      → ObjectURL temporal (se pierde tras recargar).
//       · http(s)://... → URL pública.
//   - Pinch-to-zoom (touch) + zoom con botones.
//   - `targetPage` permite saltar a una página desde fuera (citas, bookmark).
// =============================================================================

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, Outline, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ZoomIn, ZoomOut, List, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { get } from 'idb-keyval';

// Set up the worker for react-pdf
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Virtualización del visor: si es `true`, solo se montan (dibujan) las páginas
// dentro del rango visible (± OVERSCAN); el resto son placeholders con la altura
// reservada. Esto evita tener cientos de <canvas> vivos a la vez (causa del
// freeze). Poner en `false` para revertir EXACTAMENTE al comportamiento anterior
// (todas las páginas montadas).
const VIRTUALIZE = true;
// Páginas extra a montar antes/después de la página visible (margen para que el
// scroll no muestre huecos en blanco antes de que se dibuje la siguiente).
const OVERSCAN = 2;

interface PDFReaderProps {
  url: string;
  hideControls?: boolean;
  onPageChange?: (page: number) => void;
  targetPage?: { page: number, t: number };
  // Controla la visibilidad de la barra (auto-ocultado por inactividad,
  // controlado desde ReaderView). Por defecto siempre visible.
  controlsVisible?: boolean;
  // Permite controlar el panel de índice desde fuera (móvil horizontal: el
  // botón vive en la barra del reproductor TTS, no en la propia toolbar del PDF).
  outlineOpen?: boolean;
  onToggleOutline?: () => void;
  // Índice generado con IA ya persistido (null = se intentó generar y no se
  // encontró tabla de contenidos; undefined = nunca se intentó).
  generatedToc?: { title: string; page: number }[] | null;
  // Llamado cuando el usuario genera el índice con IA; el padre (ReaderView)
  // hace el fetch a Gemini y persiste el resultado en el BookItem.
  onGenerateToc?: (firstPagesText: string) => void;
  generatingToc?: boolean;
  // Oculta la franja integrada propia: se usa cuando el reproductor TTS está
  // abierto y sus mismos controles se portan (createPortal) a la fila del
  // widget TTS para fusionarse junto a los puntos de color de notas.
  hideOwnBar?: boolean;
  // Nodo DOM (gestionado por ReaderView) donde portar índice/paginación/zoom
  // cuando hideOwnBar es true. null/undefined → no se porta nada.
  mergedBarPortalTarget?: HTMLElement | null;
  // Notifica cada cambio de escala (botones, rueda+ctrl o pinch). ReaderView
  // lo usa para repintar los resaltados de citas, que son rects en píxeles
  // absolutos y quedan corridos cuando la capa de texto se re-renderiza.
  onScaleChange?: (scale: number) => void;
}

function PDFReaderComponent({ url, hideControls = false, onPageChange, targetPage, controlsVisible = true, outlineOpen, onToggleOutline, generatedToc, onGenerateToc, generatingToc = false, hideOwnBar = false, mergedBarPortalTarget = null, onScaleChange }: PDFReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  // Móvil en horizontal (no tablet/desktop): mismo criterio que ReaderView.
  // En este modo la página se ajusta SIEMPRE al ancho disponible (en vez de
  // al alto) y los controles de zoom pasan a una columna vertical a la derecha.
  const [isMobileLandscape, setIsMobileLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight && window.innerHeight <= 500 && window.innerWidth <= 950 : false
  );
  useEffect(() => {
    const handleOrientation = () => {
      setIsMobileLandscape(window.innerWidth > window.innerHeight && window.innerHeight <= 500 && window.innerWidth <= 950);
    };
    window.addEventListener('resize', handleOrientation);
    return () => window.removeEventListener('resize', handleOrientation);
  }, []);
  
  const [scrollingPage, setScrollingPage] = useState<boolean>(false);
  const visiblePagesHeight = useRef<Record<number, number>>({});

  // Un solo efecto sobre `scale` cubre todas las vías de zoom a la vez
  // (botones, rueda+ctrl y pinch), sin instrumentar cada handler.
  const onScaleChangeRef = useRef(onScaleChange);
  useEffect(() => { onScaleChangeRef.current = onScaleChange; }, [onScaleChange]);
  useEffect(() => {
    onScaleChangeRef.current?.(scale);
  }, [scale]);

  // Rango de páginas a montar realmente (1-based, inclusivo) cuando VIRTUALIZE.
  const [renderRange, setRenderRange] = useState<{ start: number; end: number }>({ start: 1, end: 1 + OVERSCAN });
  
  const handlePageChange = useCallback((newPage: number) => {
    if (newPage < 1 || newPage > (numPages || 1)) return;
    setScrollingPage(true);
    setPageNumber(newPage);
    // setPageNumber dispara el efecto que amplía renderRange para incluir newPage,
    // de modo que su <Page> real se monte. El placeholder ya tiene el mismo id y
    // altura, así que el scroll inicial aterriza en la posición correcta; tras el
    // montaje re-scrolleamos una vez para corregir cualquier ajuste de altura.
    const scrollToPage = (smooth: boolean) => {
      const pageEl = document.getElementById(`pdf-page-${newPage}`);
      if (pageEl) pageEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    };
    scrollToPage(true);
    const t1 = setTimeout(() => scrollToPage(false), 350);
    const t2 = setTimeout(() => setScrollingPage(false), 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [numPages]);

  useEffect(() => {
    if (targetPage && targetPage.page >= 1 && targetPage.page <= (numPages || 9999)) {
       handlePageChange(Number(targetPage.page));
    }
  }, [targetPage, numPages, handlePageChange]);

  useEffect(() => {
    // Sync page change up
    if (onPageChange) onPageChange(pageNumber);
  }, [pageNumber, onPageChange]);

  // Mantener el rango virtualizado centrado en la página visible. Solo se amplía
  // (nunca se reduce por debajo de lo ya montado en este "vecindario") para
  // evitar parpadeos al hacer micro-scroll; React desmonta lo que queda fuera.
  useEffect(() => {
    if (numPages === null) return;
    const start = Math.max(1, pageNumber - OVERSCAN);
    const end = Math.min(numPages, pageNumber + OVERSCAN);
    setRenderRange(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [pageNumber, numPages]);

  useEffect(() => {
    if (numPages === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        entries.forEach((entry) => {
          const pageIndex = Number(entry.target.getAttribute('data-page-number'));
          if (pageIndex) {
            if (entry.isIntersecting) {
              visiblePagesHeight.current[pageIndex] = entry.intersectionRect.height;
            } else {
              visiblePagesHeight.current[pageIndex] = 0;
            }
            changed = true;
          }
        });

        if (changed && !scrollingPage) {
          // Find the most visible page (with maximum visible height in the viewport)
          let maxPage = pageNumber;
          let maxHeight = 0;

          Object.entries(visiblePagesHeight.current).forEach(([pStr, height]) => {
            if (height > maxHeight) {
              maxHeight = height;
              maxPage = Number(pStr);
            }
          });

          const currentVisibleHeight = visiblePagesHeight.current[pageNumber] || 0;

          // Only change if a different page is now significantly more visible than the current one
          if (maxPage && maxPage !== pageNumber && maxHeight > currentVisibleHeight) {
            // Apply a minimum visible threshold to make it stable
            if (maxHeight > 30) {
              setPageNumber(maxPage);
            }
          }
        }
      },
      { root: null, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] }
    );

    const checkAndObserve = () => {
      let found = false;
      for (let i = 1; i <= numPages; i++) {
        const el = document.getElementById(`pdf-page-${i}`);
        if (el) {
          observer.observe(el);
          found = true;
        }
      }
      if (!found) {
         setTimeout(checkAndObserve, 500);
      }
    };
    checkAndObserve();

    return () => observer.disconnect();
  }, [numPages, scrollingPage, pageNumber]);


  const [showOutlineInternal, setShowOutlineInternal] = useState(false);
  // Si se pasa outlineOpen desde fuera (móvil horizontal: botón en la barra
  // TTS), ese valor manda y onToggleOutline es quien decide el cambio; si no,
  // se usa el estado interno de siempre.
  const isOutlineControlled = outlineOpen !== undefined && !!onToggleOutline;
  const showOutline = isOutlineControlled ? outlineOpen : showOutlineInternal;
  const setShowOutline = (next: boolean | ((prev: boolean) => boolean)) => {
    if (isOutlineControlled) {
      const resolved = typeof next === 'function' ? next(outlineOpen!) : next;
      if (resolved !== outlineOpen) onToggleOutline!();
    } else {
      setShowOutlineInternal(next);
    }
  };
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);
  const [containerHeight, setContainerHeight] = useState(window.innerHeight);
  const containerRef = useRef<HTMLDivElement>(null); // Para ResizeObserver en el Main Content Area
  const viewerRef = useRef<HTMLDivElement>(null);    // Para el scroll del visor de páginas

  const [pdfSource, setPdfSource] = useState<string | Blob | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);

  // Detecta si el PDF trae un índice (outline) nativo embebido. null = aún
  // no se sabe (cargando); true/false una vez resuelto. Se usa para decidir
  // si mostrar el botón "Generar índice con IA" en el panel de Índice.
  const [hasNativeOutline, setHasNativeOutline] = useState<boolean | null>(null);
  const pdfDocRef = useRef<any>(null);

  useEffect(() => {
    let isActive = true;
    setHasNativeOutline(null);
    if (!pdfSource) return;
    (async () => {
      try {
        const loadingTask = typeof pdfSource === 'string'
          ? pdfjs.getDocument(pdfSource)
          : pdfjs.getDocument({ data: await pdfSource.arrayBuffer() });
        const pdf = await loadingTask.promise;
        if (!isActive) return;
        pdfDocRef.current = pdf;
        const outline = await pdf.getOutline();
        if (!isActive) return;
        setHasNativeOutline(Array.isArray(outline) && outline.length > 0);
      } catch {
        if (isActive) setHasNativeOutline(false);
      }
    })();
    return () => { isActive = false; };
  }, [pdfSource]);

  // Extrae el texto de las primeras páginas (suficiente para detectar una
  // tabla de contenidos impresa) y dispara la generación en el padre.
  const handleGenerateTocClick = async () => {
    if (!onGenerateToc) return;
    try {
      const pdf = pdfDocRef.current;
      if (!pdf) return;
      const numPagesToRead = Math.min(pdf.numPages, 10);
      let fullText: string[] = [];
      for (let i = 1; i <= numPagesToRead; i++) {
        const textPage = await pdf.getPage(i);
        const textContent = await textPage.getTextContent();
        fullText.push(textContent.items.map((it: any) => it.str).join(' '));
      }
      onGenerateToc(fullText.join(' \n').trim());
    } catch (e) {
      console.error('No se pudo extraer texto para generar el índice:', e);
    }
  };

  useEffect(() => {
    let isActive = true;

    // Resolución de la fuente del PDF según el esquema del URL:
    //   - "/api/files/..." (NUEVO): URL servida por el backend → uso directo.
    //   - "http(s)://..."           : URL pública → uso directo.
    //   - "idb://..." (LEGACY)      : Blob persistido en IndexedDB de la maqueta.
    //   - "blob:..."  (LEGACY)      : Blob temporal, se pierde al recargar.
    const resolveUrl = async () => {
      setLoadError(false);
      try {
        if (url.startsWith('idb://')) {
          // Compatibilidad con items creados antes de migrar al servidor.
          const file = await get(url);
          if (file && isActive) {
            setPdfSource(file as Blob);
          } else if (isActive) {
            setLoadError(true);
          }
        } else if (url.startsWith('blob:')) {
          const res = await fetch(url).catch(() => null);
          if (!res || !res.ok) {
            if (isActive) setLoadError(true);
          } else {
            const blob = await res.blob();
            if (isActive) setPdfSource(blob);
          }
        } else {
          // URLs del servidor ("/api/files/...") y URLs públicas se cargan directo.
          if (isActive) setPdfSource(url);
        }
      } catch (err) {
        if (isActive) setLoadError(true);
      }
    };

    resolveUrl();

    return () => {
      isActive = false;
    };
  }, [url]);

  useEffect(() => {
    let timeoutId: number;
    let lastWidth = 0;
    let lastHeight = 0;
    
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        const newWidth = entries[0].contentRect.width;
        const newHeight = entries[0].contentRect.height;
        if (Math.abs(newWidth - lastWidth) > 5 || Math.abs(newHeight - lastHeight) > 5) {
            clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => {
                lastWidth = newWidth;
                lastHeight = newHeight;
                setContainerWidth(newWidth);
                setContainerHeight(newHeight);
            }, 100);
        }
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => {
        observer.disconnect();
        clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
           setScale(s => Math.min(s + 0.1, 4));
        } else {
           setScale(s => Math.max(s - 0.1, 0.5));
        }
      }
    };
    
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [pdfSource, numPages]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const zoomIn = () => setScale(s => Math.min(s + 0.2, 3));
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.5));

  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [initialScale, setInitialScale] = useState<number>(1);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setTouchStartDist(dist);
      setInitialScale(scale);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist !== null) {
      // e.preventDefault(); // prevent native pinch zoom
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const ratio = dist / touchStartDist;
      
      // smoothly update scale relative to initial scale
      let newScale = initialScale * ratio;
      newScale = Math.max(0.5, Math.min(newScale, 4));
      
      // Update scale if significantly changed to avoid too many renders
      if (Math.abs(newScale - scale) > 0.05) {
         setScale(newScale);
      }
    }
  };

  const handleTouchEnd = () => {
    setTouchStartDist(null);
  };

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

  // Contenido de índice/paginación/zoom — extraído para poder renderizarse
  // tanto in-place (franja propia) como vía portal (fusionado en el widget
  // TTS) sin duplicar JSX. `compact` oculta el zoom (usado en móvil
  // horizontal, donde el zoom vive en la columna lateral vertical).
  const renderBarControls = (compact: boolean) => (
    <>
      <div className="flex items-center">
         <button
           onClick={() => setShowOutline(!showOutline)}
           className={cn(
             "p-2.5 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all",
             showOutline && "text-[var(--primary)] bg-[var(--primary)]/10"
           )}
           title="Índice"
         >
            <List className="w-5 h-5" />
         </button>
      </div>

      <div className="w-px h-4 bg-[var(--border-card)]" />

      <div className="flex items-center gap-1">
         <button
           disabled={pageNumber <= 1}
           onClick={() => handlePageChange(pageNumber - 1)}
           className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
           title="Página Anterior"
         >
           <ChevronLeft className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
         </button>

         <span className="text-sm font-mono font-bold min-w-[3.5rem] text-center px-1 tabular-nums whitespace-nowrap">
           {pageNumber} <span className="opacity-40 font-normal text-xs">/ {numPages || '--'}</span>
         </span>

         <button
           disabled={pageNumber >= (numPages || 1)}
           onClick={() => handlePageChange(pageNumber + 1)}
           className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
           title="Siguiente Página"
         >
           <ChevronRight className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
         </button>
      </div>

      {!compact && (
        <>
          <div className="w-px h-4 bg-[var(--border-card)]" />
          <div className="flex items-center gap-1">
             <button
               onClick={zoomOut}
               className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
               title="Alejar Zoom"
             >
               <ZoomOut className="w-5 h-5" />
             </button>
             <span className="text-xs font-mono font-semibold w-9 text-center tabular-nums">{Math.round(scale * 100)}%</span>
             <button
               onClick={zoomIn}
               className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
               title="Acercar Zoom"
             >
               <ZoomIn className="w-5 h-5" />
             </button>
          </div>
        </>
      )}
    </>
  );

  if (loadError || !pdfSource) {
     return (
        <div className="flex h-full w-full bg-[#f1f5f9] items-center justify-center p-8 text-center text-slate-500">
           {loadError && (
              <div className="w-full max-w-[600px] h-[800px] bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center p-8 text-center shadow-sm">
                 <div className="w-16 h-16 mb-4 text-slate-300"><List className="w-full h-full"/></div>
                 <p className="font-bold text-slate-700 mb-2">No se pudo cargar el documento PDF</p>
                 <p className="text-sm">Si este archivo se subió localmente, es posible que el enlace temporal haya expirado tras recargar la página. Por favor, vuelve a subir el archivo desde el editor.</p>
              </div>
           )}
           {!loadError && <div className="animate-pulse bg-slate-300 w-full max-w-[600px] h-[800px] rounded-lg border border-slate-200" />}
        </div>
     );
  }

  return (
    <Document
       file={pdfSource}
       onLoadSuccess={onDocumentLoadSuccess}
       onLoadError={() => setLoadError(true)}
       loading={<div className="animate-pulse bg-[var(--bg-card)] w-full max-w-[600px] h-[800px] rounded-lg border border-[var(--border-card)] mt-4" />}
       className="flex h-full w-full bg-[var(--bg-app)] relative min-w-0 min-h-0 text-[var(--text-main)]"
    >
        {/* Sidebar for Outline. En móvil se posiciona fixed con z-[60] para
            escapar del stacking context del panel del lector y quedar POR
            ENCIMA de la columna de colores del reproductor TTS (z-40). En
            desktop sigue siendo relative dentro del flujo. */}
        <div className={cn(
          "bg-[var(--bg-card)] border-r border-[var(--border-card)] backdrop-blur-md transition-all duration-300 flex flex-col fixed inset-y-0 left-0 z-[60] md:relative md:inset-auto md:z-20 h-full shadow-2xl md:shadow-none min-w-0 min-h-0",
           showOutline ? "w-64 md:w-64" : "w-0 opacity-0 overflow-hidden"
        )}>
          <div className="p-4 border-b border-[var(--border-card)] bg-[var(--bg-app)]/50 flex-none flex items-center justify-between">
            <h3 className="font-bold text-[var(--text-main)] text-sm flex items-center gap-2">
              <List className="w-4 h-4" /> Índice
            </h3>
            <button onClick={() => setShowOutline(false)} className="md:hidden text-[var(--text-muted)] hover:text-[var(--primary)] p-1 transition-colors">
               <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
             {hasNativeOutline ? (
                <Outline
                   onItemClick={({ pageNumber }) => handlePageChange(pageNumber)}
                   className="pdf-outline"
                />
             ) : generatedToc && generatedToc.length > 0 ? (
                // Índice generado con IA a partir de la tabla de contenidos
                // impresa en las primeras páginas (no es el outline nativo).
                <ul className="space-y-1">
                   {generatedToc.map((chapter, i) => (
                      <li key={i}>
                         <button
                            onClick={() => handlePageChange(chapter.page)}
                            className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-[var(--text-main)] hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] transition-colors flex items-center justify-between gap-2"
                         >
                            <span className="truncate">{chapter.title}</span>
                            <span className="text-xs text-[var(--text-muted)] shrink-0">{chapter.page}</span>
                         </button>
                      </li>
                   ))}
                </ul>
             ) : hasNativeOutline === null ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-6">Cargando…</p>
             ) : (
                <div className="text-center py-6 px-2">
                   <p className="text-xs text-[var(--text-muted)] mb-3">
                      {generatedToc === null
                         ? 'No se encontró una tabla de contenidos en las primeras páginas.'
                         : 'Este documento no tiene un índice incorporado.'}
                   </p>
                   {onGenerateToc && generatedToc !== null && (
                      <button
                         onClick={handleGenerateTocClick}
                         disabled={generatingToc}
                         className="text-xs font-bold px-3 py-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                      >
                         {generatingToc ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando…</>
                         ) : (
                            <><Sparkles className="w-3.5 h-3.5" /> Generar índice con IA</>
                         )}
                      </button>
                   )}
                </div>
             )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-full relative min-w-0 min-h-0 w-full bg-[var(--bg-app)]" ref={containerRef}>

           {/* PDF Pages Viewer */}
           <div
              ref={viewerRef}
              className="flex-1 min-w-0 min-h-0 w-full overflow-auto flex justify-center pt-4 md:pt-6 px-2 md:px-4"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
           >
              <div className="flex flex-col items-center gap-4 md:gap-8 pb-10">
                 {Array.from(new Array(numPages || 1), (_el, index) => {
                    const pageNum = index + 1;
                    const TOOLBAR_BOTTOM = 64;   // 44 px toolbar + márgenes
                    const VERTICAL_PADDING = 64; // pt-4 + pb-12 + breathing room
                    const availableHeight = Math.max((containerHeight || 800) - TOOLBAR_BOTTOM - VERTICAL_PADDING, 320);
                    const widthCap = Math.max((containerWidth || 600) - 32, 280);

                    // El contenedor externo (id, data-page-number, sombra/borde) se
                    // renderiza SIEMPRE para no romper el IntersectionObserver, el
                    // scrollIntoView ni el resaltado de citas (que buscan por id).
                    // Solo se monta el <Page> real (canvas + text-layer) si la
                    // página está dentro del rango visible — o si VIRTUALIZE=false.
                    const shouldRender = !VIRTUALIZE || (pageNum >= renderRange.start && pageNum <= renderRange.end);

                    return (
                      <div key={`page_${pageNum}`} id={`pdf-page-${pageNum}`} data-page-number={pageNum} className="shadow-lg border border-[var(--border-card)] rounded-sm">
                        {shouldRender ? (
                          <Page
                             pageNumber={pageNum}
                             scale={scale}
                             height={availableHeight}
                             width={undefined as unknown as number}
                             renderTextLayer={true}
                             renderAnnotationLayer={true}
                             className="bg-white"
                             {...(isMobileLandscape || widthCap < availableHeight * 0.6 ? { width: widthCap, height: undefined } : {})}
                          />
                        ) : (
                          // Placeholder con la altura reservada: mantiene el layout y
                          // el scroll estables sin pintar el canvas.
                          <div
                            className="bg-white flex items-center justify-center text-slate-300"
                            style={{ height: `${availableHeight}px`, width: `${Math.min(widthCap, availableHeight * 0.75)}px` }}
                          >
                            <span className="text-xs">{pageNum}</span>
                          </div>
                        )}
                      </div>
                    );
                 })}
              </div>
           </div>

         {/* Franja integrada: en flujo normal del layout (no flotante), igual
             posición visual (abajo) pero como hermana del visor dentro del
             mismo contenedor flex-col, sin position: absolute. */}
         {!hideControls && !isMobileLandscape && !hideOwnBar && (
           <div
             className={cn(
               "shrink-0 w-full flex flex-col items-center bg-[var(--bg-card)] border-t border-[var(--border-card)] transition-all duration-300 overflow-hidden",
               (controlsVisible && !manuallyHidden) ? "max-h-12" : "max-h-[14px]"
             )}
           >
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

             <div className="flex items-center justify-center gap-1 sm:gap-3 px-2 sm:px-4 pb-1.5 w-full text-[var(--text-main)] whitespace-nowrap overflow-x-auto no-scrollbar">
               {renderBarControls(false)}
               <div className="w-px h-4 bg-[var(--border-card)]" />
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
             está activo, la franja propia no se monta (arriba) y estos mismos
             controles se portan a la fila del widget TTS en ReaderView. */}
         {hideOwnBar && mergedBarPortalTarget && createPortal(renderBarControls(isMobileLandscape), mergedBarPortalTarget)}

         {/* Móvil horizontal: columna vertical de zoom fija a la derecha, con
             botones grandes y fáciles de tocar sin estorbar el ancho de página. */}
         {!hideControls && isMobileLandscape && (
           <div
             className={cn(
               "absolute top-1/2 right-2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 p-2 bg-[var(--bg-card)] border border-[var(--border-card)] shadow-2xl rounded-full backdrop-blur-md transition-all pointer-events-auto",
               (controlsVisible && !manuallyHidden) ? "opacity-100" : "opacity-0 translate-x-2"
             )}
           >
             <button
               onClick={zoomIn}
               className="p-3 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
               title="Acercar Zoom"
             >
               <ZoomIn className="w-6 h-6" />
             </button>
             <span className="text-xs font-mono font-bold tabular-nums">{Math.round(scale * 100)}%</span>
             <button
               onClick={zoomOut}
               className="p-3 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
               title="Alejar Zoom"
             >
               <ZoomOut className="w-6 h-6" />
             </button>
           </div>
         )}
        </div>
    </Document>
  );
}

// Memoizado: evita que el PDF se vuelva a renderizar (y reconcilie todas sus
// páginas) cuando ReaderView re-renderiza por causas ajenas al visor (abrir
// "Administrar Citas", panel de notas, TTS, etc.). Las props que recibe son
// estables (url string, handlePageChange en useCallback, primitivos, y
// targetPage que solo cambia al navegar).
export const PDFReader = memo(PDFReaderComponent);