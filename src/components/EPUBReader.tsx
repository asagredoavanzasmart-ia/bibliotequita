import { useState, useEffect, useRef, useCallback } from 'react';
import { ReactReader } from 'react-reader';
import type { Rendition } from 'epubjs';
import type { NavItem } from 'epubjs';
import { get } from 'idb-keyval';
import { List, ZoomIn, ZoomOut, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';

interface EPUBReaderProps {
  url: string;
  getRendition?: (rendition: Rendition) => void;
  // Desplaza la barra flotante de zoom/índice hacia arriba para que no quede
  // tapada por el reproductor TTS cuando está visible.
  bottomOffset?: number;
}

const FONT_SIZES = [80, 90, 100, 110, 125, 150, 175, 200];
const DEFAULT_FONT_SIZE_INDEX = 2; // 100%

// El layout "paginado" de epubjs reparte el texto en columnas cuyo ancho se
// fija en píxeles según el contenedor en el momento del render; al
// redimensionar el panel (abrir/cerrar Anotaciones) ese ancho queda obsoleto
// y el contenido se desborda o se corta, sin importar cuántas veces se llame
// a spread()/resize() después.
//
// flow "scrolled-doc" es el formato estándar de una sola columna continua: el
// contenido siempre ocupa el 100% del ancho disponible (como una página web
// normal) y se redimensiona junto con el contenedor sin recalcular columnas.
// Como el EPUB no maneja "páginas" (las citas tampoco las usan), esto es
// válido en todos los tamaños de pantalla y con o sin el panel de notas abierto.

export function EPUBReader({ url, getRendition, bottomOffset = 0 }: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(0);
  const [actualUrl, setActualUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [fontSizeIndex, setFontSizeIndex] = useState(DEFAULT_FONT_SIZE_INDEX);
  const renditionRef = useRef<Rendition | null>(null);

  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;
    rendition.themes.fontSize(`${FONT_SIZES[DEFAULT_FONT_SIZE_INDEX]}%`);
    rendition.book.loaded.navigation.then((nav) => setToc(nav.toc));
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

  const renderTocItems = (items: NavItem[], depth = 0) => (
    <ul className={cn(depth > 0 && "ml-3 border-l border-slate-200 pl-2")}>
      {items.map((navItem) => (
        <li key={navItem.id}>
          <button
            onClick={() => goToTocItem(navItem.href)}
            className="block w-full text-left text-sm text-slate-700 hover:text-[var(--primary)] py-1.5 px-1 rounded hover:bg-[var(--primary)]/5 transition-colors truncate"
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
      <div className="w-full h-full max-w-5xl shadow-xl bg-white border-x border-slate-200 relative">
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
            <ReactReader
              url={actualUrl}
              location={location}
              locationChanged={(epubcfi: string) => setLocation(epubcfi)}
              getRendition={handleGetRendition}
              epubInitOptions={{
                 openAs: 'epub'
              }}
              epubOptions={{
                flow: 'scrolled-doc',
                manager: 'continuous',
              }}
            />

            {/* Panel de Índice (TOC): overlay a pantalla completa en móvil,
                panel lateral en tablet/PC — mismo patrón que el outline del PDF. */}
            {showToc && (
              <div className="absolute inset-0 z-40 flex">
                <div className="absolute inset-0 bg-black/30 md:hidden" onClick={() => setShowToc(false)} />
                <div className="relative z-10 w-full md:w-72 h-full bg-[var(--bg-card)] border-r border-[var(--border-card)] shadow-2xl flex flex-col">
                  <div className="p-4 border-b border-[var(--border-card)] bg-[var(--bg-app)]/50 flex-none flex items-center justify-between">
                    <h3 className="font-bold text-[var(--text-main)] text-sm flex items-center gap-2">
                      <List className="w-4 h-4" /> Índice
                    </h3>
                    <button onClick={() => setShowToc(false)} className="text-[var(--text-muted)] hover:text-[var(--primary)] p-1 transition-colors">
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

            {/* Barra flotante: índice + zoom — mismo estilo que la barra del PDF */}
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-auto z-30 transition-[bottom] duration-300"
              style={{ bottom: `${16 + bottomOffset}px` }}
            >
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--text-main)] shadow-2xl rounded-full backdrop-blur-md min-h-[44px] whitespace-nowrap">
                <button
                  onClick={() => setShowToc(v => !v)}
                  className={cn(
                    "p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all",
                    showToc && "text-[var(--primary)] bg-[var(--primary)]/10"
                  )}
                  title="Índice"
                >
                  <List className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                </button>

                <div className="w-px h-4 bg-[var(--border-card)]" />

                <div className="flex items-center gap-1">
                  <button
                    disabled={fontSizeIndex <= 0}
                    onClick={() => applyFontSize(fontSizeIndex - 1)}
                    className="p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                    title="Reducir texto"
                  >
                    <ZoomOut className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                  </button>
                  <span className="text-[10px] sm:text-xs font-mono font-semibold w-9 text-center tabular-nums">{FONT_SIZES[fontSizeIndex]}%</span>
                  <button
                    disabled={fontSizeIndex >= FONT_SIZES.length - 1}
                    onClick={() => applyFontSize(fontSizeIndex + 1)}
                    className="p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                    title="Aumentar texto"
                  >
                    <ZoomIn className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                  </button>
                </div>
              </div>
            </div>
           </>
         )}
      </div>
    </div>
  );
}
