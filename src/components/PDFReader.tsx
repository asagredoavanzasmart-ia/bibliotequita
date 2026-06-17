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
import { Document, Page, Outline, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ZoomIn, ZoomOut, List, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
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
  // Desplaza la barra flotante de zoom/paginación hacia arriba para que no
  // quede tapada por el reproductor TTS cuando está visible.
  bottomOffset?: number;
  // Controla la visibilidad de la barra (auto-ocultado por inactividad,
  // controlado desde ReaderView). Por defecto siempre visible.
  controlsVisible?: boolean;
}

function PDFReaderComponent({ url, hideControls = false, onPageChange, targetPage, bottomOffset = 0, controlsVisible = true }: PDFReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  
  const [scrollingPage, setScrollingPage] = useState<boolean>(false);
  const visiblePagesHeight = useRef<Record<number, number>>({});

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


  const [showOutline, setShowOutline] = useState(false);
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);
  const [containerHeight, setContainerHeight] = useState(window.innerHeight);
  const containerRef = useRef<HTMLDivElement>(null); // Para ResizeObserver en el Main Content Area
  const viewerRef = useRef<HTMLDivElement>(null);    // Para el scroll del visor de páginas
  
  const [pdfSource, setPdfSource] = useState<string | Blob | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);

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
        {/* Sidebar for Outline */}
        <div className={cn(
          "bg-[var(--bg-card)] border-r border-[var(--border-card)] backdrop-blur-md transition-all duration-300 flex flex-col absolute md:relative z-20 h-full shadow-2xl md:shadow-none min-w-0 min-h-0",
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
             <Outline
                onItemClick={({ pageNumber }) => handlePageChange(pageNumber)}
                className="pdf-outline"
             />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col items-center h-full relative min-w-0 min-h-0 w-full bg-[var(--bg-app)]" ref={containerRef}>

           {/* PDF Pages Viewer */}
           <div 
              ref={viewerRef}
              className="flex-1 min-w-0 min-h-0 w-full overflow-auto flex justify-center pb-24 pt-4 md:pt-6 px-2 md:px-4"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
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
                             {...(widthCap < availableHeight * 0.6 ? { width: widthCap, height: undefined } : {})}
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

         {/* Toolbar Static at Bottom */}
         {!hideControls && (
           <div
             className={cn(
               "absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-30 w-[calc(100%-1.5rem)] sm:w-auto sm:max-w-xl transition-all duration-300",
               (controlsVisible && !manuallyHidden) ? "opacity-100" : "opacity-0 translate-y-2"
             )}
             style={{ bottom: `${16 + bottomOffset}px` }}
           >
             <div className="flex items-center justify-center gap-1 sm:gap-4 px-2 sm:px-4 py-2.5 sm:py-3 w-full sm:w-auto bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--text-main)] shadow-2xl rounded-full backdrop-blur-md transition-all min-h-[48px] whitespace-nowrap pointer-events-auto">

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

              <div className="w-px h-4 bg-[var(--border-card)]" />

              <button
                onClick={() => setManuallyHidden(true)}
                className="p-2.5 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
                title="Ocultar controles"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
             </div>
           </div>
         )}

         {/* Asa para volver a mostrar la barra cuando se ocultó manualmente */}
         {!hideControls && manuallyHidden && (
           <button
             onClick={() => setManuallyHidden(false)}
             className="absolute left-1/2 -translate-x-1/2 z-30 p-2 rounded-full bg-[var(--bg-card)]/70 border border-[var(--border-card)] text-[var(--text-muted)] shadow-md backdrop-blur-md pointer-events-auto transition-all"
             style={{ bottom: `${8 + bottomOffset}px` }}
             title="Mostrar controles"
           >
             <ChevronUp className="w-4 h-4" />
           </button>
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