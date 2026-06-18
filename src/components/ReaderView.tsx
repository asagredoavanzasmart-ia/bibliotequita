// =============================================================================
// ReaderView.tsx — Pantalla de lectura
// -----------------------------------------------------------------------------
// Hub central de la experiencia de lectura. Coordina:
//   - <PDFReader>      → render de PDF con react-pdf (zoom, paginación, scroll).
//   - <EPUBReader>     → render de EPUB con react-reader.
//   - <iframe>         → para recursos 'externa' (URLs web).
//   - <NotesPanel>     → panel lateral/inferior de notas y citas.
//   - <CitationsManager> → administrador completo de citas + resúmenes IA.
//   - <EditBookModal>  → vista de metadatos del recurso (inline=true).
//
// Características clave:
//   * Split-view redimensionable (horizontal en desktop, vertical en móvil).
//   * Selección de texto → toolbar flotante con colores para crear cita.
//   * Bookmarks: guarda página actual en BookItem.bookmarkPage → reanuda lectura.
//   * Brillo, pantalla completa y posición notes (izq/der) son estado local.
//   * activePalette (colores de citas) se persiste por libro en
//     localStorage[`color-palette-${bookId}`].
// =============================================================================

import { useLibrary } from '../hooks/useLibrary';
import { ChevronLeft, Maximize, View, Columns, Check, Edit2, MessageSquareQuote, ArrowRightLeft, ArrowUpDown, Minimize, Hand, Type, Sun, BookOpen, ClipboardList, Info, Volume2, Play, Pause, Square, Loader2, SkipBack, SkipForward, Rewind, FastForward, FlaskConical, X, Settings, ChevronUp } from 'lucide-react';
import { useState, useRef, FormEvent, ChangeEvent, useEffect, useCallback, useMemo } from 'react';
import type { Rendition } from 'epubjs';
import { cn } from '../lib/utils';
import { PDFReader } from './PDFReader';
import { EPUBReader } from './EPUBReader';
import { TxtReader } from './TxtReader';
import { FolderManagerModal } from './FolderManagerModal';
import { NotesPanel } from './NotesPanel';
import { EditBookModal } from './EditBookModal';
import { CitationsManager } from './CitationsManager';
import { BookmarksMenu } from './BookmarksMenu';
import { AuditorPanel } from './AuditorPanel';
import { useReadingTimeTracker } from '../hooks/useReadingTime';
import { StarRating } from './StarRating';
import { DraggableProgress } from './BookGrid';

interface ReaderViewProps {
  bookId: string;
  onClose: () => void;
}

// Convierte un color hex (#rgb o #rrggbb) a rgba(r,g,b,alpha). Si el color ya
// viene en otro formato (rgb/rgba/nombre), lo devuelve tal cual.
// Se usa para resaltar citas SIN la propiedad `opacity` (que rompe el
// mix-blend-mode: multiply al crear un stacking context aislado). Metiendo el
// alfa dentro del color, el multiply sigue mezclándose con el texto negro del
// canvas que está debajo y el negro no queda cubierto.
function toRgba(color: string, alpha: number): string {
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ReaderView({ bookId, onClose }: ReaderViewProps) {
  const { items, updateItem, categories } = useLibrary();
  const item = items.find(i => i.id === bookId);
  // Nombre de la categoría del item (BookItem.category guarda el id).
  const itemCategoryName = categories.find(c => c.id === item?.category)?.name ?? '';
  const isPhysicalOnly = item ? (item.ownedPhysical && (!item.source || item.source.trim() === '')) : false;

  // Registra tiempo de lectura diario mientras este libro está abierto.
  useReadingTimeTracker(!!item);

  const [activeTab, setActiveTab ] = useState<'reader' | 'edit' | 'citations' | 'auditor'>('reader');
  
  const [showFolderManager, setShowFolderManager ] = useState(false);
  const [showNotes, setShowNotes ] = useState(false);

  const [selectedText, setSelectedText ] = useState('');
  const [selectedCitation, setSelectedCitation ] = useState<{text: string; color: string; timestamp: number; page?: number | string}>();
  const [selectionRect, setSelectionRect ] = useState<{ top: number, left: number, width: number } | null>(null);

  // Referencia a la Rendition de epubjs — necesaria para acceder al contenido
  // del iframe interno (selección de texto para citas y extracción para TTS).
  const epubRenditionRef = useRef<Rendition | null>(null);
  
  // Start from bookmark page if saved to re-resume exactly where reader left off 
  const [currentPage, setCurrentPage ] = useState<number | string>(item?.bookmarkPage || 1);
  const [targetPage, setTargetPage ] = useState<{ page: number, t: number } | undefined>(
    item?.bookmarkPage ? { page: Number(item.bookmarkPage), t: Date.now() } : undefined
  );
  
  const [totalPages, setTotalPages ] = useState<number>(100);

  // Resaltado pendiente al navegar desde una cita guardada (CitationsManager):
  // se aplica una vez que la página/sección destino termina de renderizarse.
  const [pendingHighlight, setPendingHighlight] = useState<{ text: string; color: string } | null>(null);

  // --- Estados de Lector de Voz (TTS ElevenLabs) ------------------------------
  const [showTtsWidget, setShowTtsWidget] = useState(false);
  // El panel de configuración (modelo/voz/origen de lectura) queda colapsado
  // por defecto para que la barra inferior del reproductor sea compacta.
  const [showTtsSettings, setShowTtsSettings] = useState(false);
  // Altura real de la barra del reproductor TTS, medida con ResizeObserver,
  // para desplazar hacia arriba los controles de página/zoom del PDF y que
  // no queden tapados por el reproductor.
  const ttsWidgetRef = useRef<HTMLDivElement>(null);
  const [ttsWidgetHeight, setTtsWidgetHeight] = useState(0);
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [ttsErrorMessage, setTtsErrorMessage] = useState('');
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [ttsTextSource, setTtsTextSource] = useState<'selection' | 'page'>('page');

  // Origen de inicio de la lectura al presionar Play (no aplica si hay texto
  // seleccionado, que siempre se lee tal cual).
  const [ttsStartSource, setTtsStartSource] = useState<'visible' | 'chapter' | 'lastRead'>('visible');

  // Proveedores de Voz
  const [selectedProvider, setSelectedProvider] = useState<'elevenlabs' | 'google' | 'google-standard'>('elevenlabs');

  // Voces favoritas persistidas en localStorage
  const [favoriteVoices, setFavoriteVoices] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tts-favorite-voices') || '[]'); } catch { return []; }
  });
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);

  const toggleFavoriteVoice = useCallback((voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteVoices(prev => {
      const next = prev.includes(voiceId) ? prev.filter(id => id !== voiceId) : [...prev, voiceId];
      localStorage.setItem('tts-favorite-voices', JSON.stringify(next));
      return next;
    });
  }, []);

  // Voces de ElevenLabs
  const ELEVENLABS_VOICES = useMemo(() => [
    // 🇨🇱 Voces chilenas
    { id: '6Gr4AVmTax1pMJO0lHRK', name: '🇨🇱 Catalina (Femenina Chilena)' },
    { id: 'Fd38GRHtJllY0CuguAy9', name: '🇨🇱 Victoria (Femenina Profesional)' },
    { id: 'lLsDvdl6OjtZfLJPM2HA', name: '🇨🇱 Isa Pro (Femenina Cálida)' },
    { id: 'cLzIVykddLltvgkzos6C', name: '🇨🇱 Vale (Femenina Amigable)' },
    { id: 'OFrdGXwCzoE56a9sp1fk', name: '🇨🇱 Marco (Masculino Cálido)' },
    { id: '6WgXEzo1HGn3i7ilT4Fh', name: '🇨🇱 Vicente Pro (Masculino Profesional)' },
    { id: 'ClNifCEVq1smkl4M3aTk', name: '🇨🇱 Cristian (Masculino Fluido)' },
    { id: '0cheeVA5B3Cv6DGq65cT', name: '🇨🇱 Alejandro (Conversacional)' },
    { id: '9ZVfdvBemUaGEWZgCiv0', name: '🇨🇱 Mateo (Masculino)' },
    { id: '6ZDFxWiAykFxCoe683WK', name: '🇨🇱 El Cordovez (Masculino)' },
    // 🌎 Voces latinoamericanas
    { id: '9EU0h6CVtEDS6vriwwq5', name: '🌎 Verónica (Femenina Suave)' },
    { id: 'V6isiXLBuRuM7uwHOVBA', name: '🌎 Luisa (Femenina Calmada)' },
    { id: 'p5EUznrYaWnafKvUkNiR', name: '🌎 Gaby (Natural Casual)' },
    { id: '4XUsiqPDK4UACIM2BILe', name: '🌎 JC (Locutor Enérgico)' },
  ], []);

  // Voces de Google Gemini TTS
  const GOOGLE_VOICES = useMemo(() => [
    { id: 'Erinome', name: '🇨🇱 Erinome (Ágil y Alegre)' },
    { id: 'Autonoe', name: '🇨🇱 Autonoe (Energía y Alegría)' },
    { id: 'Erin', name: '🇨🇱 Erin (Voz Activa 20a)' },
    { id: 'Aoede', name: '🇨🇱 Aoede (Voz Alegre 20a)' }
  ], []);

  // Modelos de Google Gemini TTS
  const GOOGLE_MODELS = useMemo(() => [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Recomendado)' },
    { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro (Estudio - Cuota Baja)' }
  ], []);

  // Voces de Google Cloud TTS Standard (gratis hasta 4M chars/mes)
  const GOOGLE_STANDARD_VOICES = useMemo(() => [
    { id: 'es-ES-Standard-A', name: 'es-ES Standard A (Femenina)' },
    { id: 'es-ES-Standard-B', name: 'es-ES Standard B (Masculina)' },
    { id: 'es-ES-Standard-C', name: 'es-ES Standard C (Femenina)' },
    { id: 'es-ES-Standard-D', name: 'es-ES Standard D (Femenina)' },
    { id: 'es-US-Standard-A', name: 'es-US Standard A (Femenina)' },
    { id: 'es-US-Standard-B', name: 'es-US Standard B (Masculina)' },
    { id: 'es-ES-Neural2-A', name: 'es-ES Neural2 A (Femenina)' },
    { id: 'es-ES-Neural2-B', name: 'es-ES Neural2 B (Masculina)' },
    { id: 'es-ES-Neural2-C', name: 'es-ES Neural2 C (Femenina)' },
  ], []);

  const [selectedVoice, setSelectedVoice] = useState('6Gr4AVmTax1pMJO0lHRK');
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');

  // Frases extraídas para navegación paso a paso
  const [phrases, setPhrases] = useState<string[]>([]);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(-1);

  // --- Memoria de posición del lector de voz ---------------------------------
  // Guarda en localStorage la última frase reproducida (página/CFI + índice +
  // texto) para que, al volver a presionar "Play", la lectura continúe donde
  // quedó en vez de reiniciar siempre desde el primer párrafo visible.
  const ttsPositionKey = `tts-position-${bookId}`;

  const saveTtsPosition = useCallback((phraseIndex: number, phraseText: string) => {
    try {
      localStorage.setItem(ttsPositionKey, JSON.stringify({
        page: item?.type === 'epub' ? null : currentPage,
        phraseIndex,
        phraseText,
      }));
    } catch { /* localStorage no disponible */ }
  }, [ttsPositionKey, item?.type, currentPage]);

  const loadTtsPosition = useCallback((phraseList: string[]): number => {
    try {
      const raw = localStorage.getItem(ttsPositionKey);
      if (!raw) return 0;
      const saved = JSON.parse(raw) as { page: number | string | null; phraseIndex: number; phraseText: string };
      // Para PDF/TXT la posición solo aplica si seguimos en la misma página;
      // para EPUB (sin páginas) basta con que la frase exacta siga presente
      // en el texto visible actual.
      if (item?.type !== 'epub' && String(saved.page) !== String(currentPage)) return 0;
      if (saved.phraseIndex >= 0 && saved.phraseIndex < phraseList.length && phraseList[saved.phraseIndex] === saved.phraseText) {
        return saved.phraseIndex;
      }
    } catch { /* posición inválida o inexistente */ }
    return 0;
  }, [ttsPositionKey, item?.type, currentPage]);

  // Referencia para la precarga (pre-fetching) de la siguiente frase de audio
  const preloadedAudioRef = useRef<{ index: number; audio: HTMLAudioElement; url: string } | null>(null);

  // AbortController para cancelar fetches TTS en vuelo al cambiar proveedor/modelo
  const ttsAbortRef = useRef<AbortController | null>(null);

  // Debounce de avance/retroceso rápido de frase (ver scheduleTtsStep más abajo)
  const ttsStepTargetRef = useRef<number | null>(null);
  const ttsStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref estable a playPhrase para usarla desde onended sin capturar closures stale
  const playPhraseRef = useRef<((index: number, phraseList: string[]) => Promise<void>) | null>(null);

  // Timeout del reintento de resaltado EPUB (ver highlightPhraseInEpub más abajo)
  const epubHighlightRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timeout del reintento de resaltado PDF (la página destino puede no estar
  // montada todavía si el visor virtualiza páginas — ver highlightPhraseInDOM).
  const pdfHighlightRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Texto visible en los iframes internos de la rendition de epubjs (vista
  // de página única o doble — concatena todas las páginas activas).
  const getEpubVisibleText = useCallback(() => {
    const contentsList = (epubRenditionRef.current as any)?.manager?.getContents?.() || [];
    return contentsList
      .map((c: any) => c?.document?.body?.textContent || '')
      .map((t: string) => t.replace(/\s+/g, ' ').trim())
      .filter((t: string) => t.length > 0)
      .join(' \n');
  }, []);

  // Función para extraer texto del DOM de la página activa del PDF, TXT o EPUB
  const getActivePageText = useCallback(() => {
    if (item?.type === 'pdf') {
      const pageEl = document.getElementById(`pdf-page-${currentPage}`);
      if (!pageEl) return '';

      const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
      const text = textLayer ? textLayer.textContent : pageEl.textContent;

      if (!text) return '';

      return text.replace(/\s+/g, ' ').trim();
    }
    if (item?.type === 'txt') {
      const el = document.getElementById('txt-content');
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }
    if (item?.type === 'epub') {
      return getEpubVisibleText();
    }
    return '';
  }, [item?.type, currentPage, getEpubVisibleText]);

  // Divide el texto en frases de punto a punto de forma simple y robusta
  const splitIntoPhrases = useCallback((text: string): string[] => {
    if (!text) return [];
    return text
      .split('.')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => p + '.');
  }, []);

  // Recorre los nodos de texto de un elemento y devuelve el texto del primer
  // nodo cuyo rect intersecta verticalmente con el rect del viewport dado.
  // Usado para identificar desde qué frase debe comenzar la lectura: la
  // primera que esté actualmente visible en pantalla, no la primera del
  // documento/página completo.
  const getFirstVisibleTextSnippet = useCallback((root: HTMLElement, viewportRect: { top: number; bottom: number }, doc: Document = document): string | null => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent || '').trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const range = doc.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length > 0) return text;
        }
      }
    }
    return null;
  }, []);

  // Dado el texto completo de la página y la lista de frases ya segmentadas,
  // busca la frase que contiene (o está más cerca de) el fragmento visible
  // y devuelve su índice. Si no se encuentra, devuelve 0.
  const findPhraseIndexForSnippet = useCallback((phraseList: string[], snippet: string | null): number => {
    if (!snippet) return 0;
    const needle = snippet.slice(0, 40).toLowerCase();
    for (let i = 0; i < phraseList.length; i++) {
      if (phraseList[i].toLowerCase().includes(needle) || needle.includes(phraseList[i].toLowerCase().replace(/\.$/, ''))) {
        return i;
      }
    }
    // Fallback: comparar solo las primeras palabras
    const firstWords = snippet.split(' ').slice(0, 4).join(' ').toLowerCase();
    if (firstWords.length >= 3) {
      for (let i = 0; i < phraseList.length; i++) {
        if (phraseList[i].toLowerCase().includes(firstWords)) return i;
      }
    }
    return 0;
  }, []);

  // Patrón heurístico para detectar encabezados de capítulo en el texto de
  // una página de PDF/TXT: "Capítulo 4", "CAPITULO IV", "Chapter 4", etc.
  const CHAPTER_HEADING_RE = /\b(cap[ií]tulo|chapter)\s+([0-9]+|[ivxlcdm]+)\b/i;

  // Busca el inicio del capítulo dentro del texto de la página actual (PDF/TXT).
  // Si no se encuentra un encabezado en la página, devuelve 0 (inicio de página).
  const getChapterStartIndexInPage = useCallback((phraseList: string[]): number => {
    for (let i = 0; i < phraseList.length; i++) {
      if (CHAPTER_HEADING_RE.test(phraseList[i])) return i;
    }
    return 0;
  }, []);

  // Para EPUB: usa la API de ubicación de epub.js (currentLocation) para
  // obtener el CFI del contenido visible al inicio del scroll actual, lo
  // resuelve a un Range con getRange(cfi) y devuelve el texto desde ahí.
  //
  // Por qué no usar geometría (getClientRects) aquí: el contenido del EPUB
  // vive dentro de iframes que epub.js posiciona y desplaza con su propio
  // "manager.container". Las coordenadas que devuelve getClientRects() de
  // nodos DENTRO del iframe están en el sistema de coordenadas interno del
  // iframe, que no es directamente comparable con el rect de <main> (el
  // contenedor exterior, que ni siquiera es el elemento que hace scroll).
  // epub.js, en cambio, ya resuelve esa geometría internamente y expone el
  // resultado como un CFI a través de currentLocation().
  const getEpubVisibleTextFromLocation = useCallback(async (): Promise<string | null> => {
    const rendition = epubRenditionRef.current as any;
    if (!rendition) return null;
    try {
      const location = await rendition.currentLocation();
      const cfi: string | undefined = location?.start?.cfi;
      if (!cfi) return null;

      const range: Range | undefined = rendition.getRange(cfi);
      if (!range) return null;

      // Texto desde el punto de inicio del rango visible hasta el final de
      // ese nodo de texto, para tener un fragmento representativo a buscar
      // en phraseList.
      const node = range.startContainer;
      const text = (node?.textContent || '').slice(range.startOffset);
      const snippet = text.replace(/\s+/g, ' ').trim();
      if (snippet.length > 0) return snippet;

      // Si el nodo de inicio no tiene texto suficiente (p.ej. es un elemento,
      // no un nodo de texto), usar el texto completo del contenedor desde ahí.
      const container = (node as any)?.parentElement as HTMLElement | undefined;
      const fallback = (container?.textContent || '').replace(/\s+/g, ' ').trim();
      return fallback.length > 0 ? fallback : null;
    } catch {
      return null;
    }
  }, []);

  // Captura la posición actualmente visible en el EPUB como ancla de marcador:
  // el CFI de epubjs (posición exacta) + un fragmento de texto (primera palabra/
  // frase visible) como etiqueta legible. No usa número de página.
  const getEpubBookmarkAnchor = useCallback(async (): Promise<{ cfi: string; label: string } | null> => {
    const rendition = epubRenditionRef.current as any;
    if (!rendition) return null;
    try {
      const location = await rendition.currentLocation();
      const cfi: string | undefined = location?.start?.cfi;
      if (!cfi) return null;
      const label = (await getEpubVisibleTextFromLocation()) || '';
      return { cfi, label };
    } catch {
      return null;
    }
  }, [getEpubVisibleTextFromLocation]);

  // Navega a una posición del EPUB a partir de su CFI.
  const navigateEpubToCfi = useCallback((cfi: string) => {
    const rendition = epubRenditionRef.current as any;
    if (rendition && cfi) {
      try { rendition.display(cfi); } catch { /* CFI inválido: se ignora */ }
    }
  }, []);

  // Determina el índice de la frase visible actualmente en pantalla para
  // comenzar la lectura desde ahí en vez de desde el inicio de la página.
  const getVisiblePhraseStartIndex = useCallback(async (phraseList: string[]): Promise<number> => {
    if (item?.type === 'pdf') {
      const container = containerRef.current;
      if (!container) return 0;
      const viewportRect = container.getBoundingClientRect();
      const pageEl = document.getElementById(`pdf-page-${currentPage}`);
      if (!pageEl) return 0;
      const snippet = getFirstVisibleTextSnippet(pageEl, viewportRect);
      return findPhraseIndexForSnippet(phraseList, snippet);
    }

    if (item?.type === 'txt') {
      const container = containerRef.current;
      if (!container) return 0;
      const viewportRect = container.getBoundingClientRect();
      const el = document.getElementById('txt-content');
      if (!el) return 0;
      const snippet = getFirstVisibleTextSnippet(el, viewportRect);
      return findPhraseIndexForSnippet(phraseList, snippet);
    }

    if (item?.type === 'epub') {
      const snippet = await getEpubVisibleTextFromLocation();
      return findPhraseIndexForSnippet(phraseList, snippet);
    }

    return 0;
  }, [item?.type, currentPage, getFirstVisibleTextSnippet, findPhraseIndexForSnippet, getEpubVisibleTextFromLocation]);

  // Para EPUB: navega la rendition al inicio del capítulo actual usando la
  // tabla de contenidos (TOC) del libro. Devuelve true si pudo navegar.
  const navigateEpubToChapterStart = useCallback(async (): Promise<boolean> => {
    const rendition = epubRenditionRef.current as any;
    if (!rendition) return false;
    try {
      const toc = rendition.book?.navigation?.toc as { href: string; subitems?: any[] }[] | undefined;
      if (!toc || toc.length === 0) return false;

      // Aplanar el TOC (incluye subcapítulos) para buscar el item activo
      const flatToc: { href: string }[] = [];
      const flatten = (items: any[]) => {
        items.forEach(it => {
          flatToc.push({ href: it.href });
          if (it.subitems?.length) flatten(it.subitems);
        });
      };
      flatten(toc);

      const currentHref: string | undefined = rendition.currentLocation?.()?.start?.href || rendition.location?.start?.href;
      if (!currentHref) return false;

      // Normalizar quitando anclas (#...) para comparar rutas de archivo
      const stripAnchor = (href: string) => href.split('#')[0];
      const currentPath = stripAnchor(currentHref);

      // Buscar el último item del TOC cuya ruta sea <= la ruta actual
      let targetHref: string | null = null;
      for (const tocItem of flatToc) {
        const tocPath = stripAnchor(tocItem.href);
        if (tocPath === currentPath) {
          targetHref = tocItem.href;
          break;
        }
      }
      if (!targetHref) return false;

      await rendition.display(targetHref);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Resalta de manera no destructiva y súper premium la frase actual en el DOM del PDF.
  // persistent=true marca los spans con data-citation-highlight="true" para que el
  // resaltado de una cita guardada no sea borrado por el siguiente paso del TTS
  // (que solo limpia spans sin esa marca).
  const highlightPhraseInDOM = useCallback((phraseText: string, color: string = '#fbbf24', persistent: boolean = false, retriesLeft: number = 8) => {
    // Cancelar cualquier reintento pendiente de una llamada anterior.
    if (pdfHighlightRetryRef.current) {
      clearTimeout(pdfHighlightRetryRef.current);
      pdfHighlightRetryRef.current = null;
    }

    // Limpiar resaltados NO persistentes en TODAS las páginas montadas (no solo
    // en la página actual: con el visor virtualizado y la actualización asíncrona
    // de currentPage no es fiable saber de antemano en qué página está la cita).
    document.querySelectorAll('.react-pdf__Page__textContent span[style]').forEach((span: any) => {
      if (span.dataset?.citationHighlight === 'true') return;
      span.style.backgroundColor = '';
      span.style.borderRadius = '';
      span.style.transition = '';
      span.style.mixBlendMode = '';
      span.style.opacity = '';
    });

    if (!phraseText || phraseText.trim().length === 0) return;

    const cleanPhrase = phraseText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleanPhrase.length < 3) return;

    // Buscar la frase en cada página montada hasta encontrarla y resaltarla.
    const pageEls = Array.from(document.querySelectorAll('.react-pdf__Page'));
    let highlightedAny = false;

    for (const pageEl of pageEls) {
      const spans = pageEl.querySelectorAll('.react-pdf__Page__textContent span[style]');
      if (spans.length === 0) continue;

      let fullText = '';
      const spanRanges: { span: any; start: number; end: number }[] = [];
      spans.forEach((span: any) => {
        const text = span.textContent || '';
        const start = fullText.length;
        fullText += text;
        spanRanges.push({ span, start, end: fullText.length });
      });

      const normalizedFullText = fullText.toLowerCase().replace(/\s+/g, ' ');
      let matchIndex = normalizedFullText.indexOf(cleanPhrase);
      let matchLen = cleanPhrase.length;
      if (matchIndex === -1) {
        // Respaldo: coincidencia por las primeras palabras.
        const firstWords = cleanPhrase.split(' ').slice(0, 3).join(' ');
        const partial = normalizedFullText.indexOf(firstWords);
        if (partial === -1) continue;
        matchIndex = partial;
      }

      const startPos = matchIndex;
      const endPos = matchIndex + matchLen;
      let currentPos = 0;
      spanRanges.forEach(({ span, start, end }) => {
        const spanLength = end - start;
        const spanStartNormalized = normalizedFullText.indexOf(span.textContent?.toLowerCase() || '', currentPos);
        if (spanStartNormalized !== -1) {
          currentPos = spanStartNormalized + spanLength;
          const spanEndNormalized = spanStartNormalized + spanLength;
          const overlaps = (spanStartNormalized < endPos && spanEndNormalized > startPos);
          if (overlaps) {
            span.style.transition = 'background-color 0.25s ease-in-out';
            // Alfa dentro del color (NO usar opacity: crea stacking context y
            // desactiva el mix-blend-mode, dejando el color opaco sobre el negro).
            span.style.backgroundColor = toRgba(color, 0.5);
            span.style.mixBlendMode = 'darken';     // El negro del texto siempre gana → letras intactas
            span.style.borderRadius = '3px';
            if (persistent) span.dataset.citationHighlight = 'true';
            if (!highlightedAny) {
              span.scrollIntoView({ behavior: 'smooth', block: 'center' });
              highlightedAny = true;
            }
          }
        }
      });

      if (highlightedAny) break;
    }

    // Si no se encontró en ninguna página montada, la página destino puede estar
    // todavía montándose tras un salto a la cita: reintentar unas pocas veces.
    if (!highlightedAny && retriesLeft > 0) {
      pdfHighlightRetryRef.current = setTimeout(() => {
        pdfHighlightRetryRef.current = null;
        highlightPhraseInDOM(phraseText, color, persistent, retriesLeft - 1);
      }, 250);
    }
  }, []);

  // Resalta la frase actual dentro del/los iframe(s) del EPUB visible.
  // A diferencia del PDF (que ya tiene spans por carácter del text layer),
  // el body del EPUB es HTML arbitrario, así que se recorren los nodos de
  // texto, se busca la frase con una regex tolerante a espacios/saltos y se
  // envuelve el rango encontrado en un <mark> temporal con el mismo estilo
  // premium usado en PDF.
  const highlightPhraseInEpub = useCallback((phraseText: string, color: string = '#fbbf24', retriesLeft: number = 3, persistent: boolean = false) => {
    // Cancelar cualquier reintento pendiente de una llamada anterior
    if (epubHighlightRetryRef.current) {
      clearTimeout(epubHighlightRetryRef.current);
      epubHighlightRetryRef.current = null;
    }

    const contentsList = (epubRenditionRef.current as any)?.manager?.getContents?.() || [];
    let matchedInAnySection = false;

    contentsList.forEach((contents: any) => {
      const doc: Document = contents?.document;
      if (!doc?.body) return;

      // 1. Limpiar resaltados previos, desenvolviendo los <mark> insertados
      doc.querySelectorAll('mark.__tts-highlight__').forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });

      if (!phraseText || phraseText.replace(/\s+/g, ' ').trim().length < 3) return;

      // 2. Recorrer nodos de texto y construir el texto completo + mapa de offsets
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const nodeRanges: { node: Text; start: number; end: number }[] = [];
      let fullText = '';
      let current: Node | null;
      while ((current = walker.nextNode())) {
        const text = current.textContent || '';
        if (!text) continue;
        const start = fullText.length;
        fullText += text;
        nodeRanges.push({ node: current as Text, start, end: fullText.length });
      }
      if (!fullText) return;

      // 3. Buscar la frase tolerando diferencias de espacios/saltos de línea
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = phraseText
        .trim()
        .split(/\s+/)
        .map(escapeRegExp)
        .join('\\s+');
      const regex = new RegExp(pattern, 'i');
      const match = fullText.match(regex);
      if (!match || match.index === undefined) return;

      matchedInAnySection = true;

      const startPos = match.index;
      const endPos = startPos + match[0].length;

      // 4. Envolver cada nodo de texto que solape el rango encontrado
      let highlightedAny = false;
      nodeRanges.forEach(({ node, start, end }) => {
        if (end <= startPos || start >= endPos) return;
        const sliceStart = Math.max(0, startPos - start);
        const sliceEnd = Math.min(node.length, endPos - start);
        if (sliceStart >= sliceEnd) return;

        const range = doc.createRange();
        range.setStart(node, sliceStart);
        range.setEnd(node, sliceEnd);

        const mark = doc.createElement('mark');
        mark.className = persistent ? '__citation-highlight__' : '__tts-highlight__';
        // Alfa dentro del color (NO usar opacity: rompe el multiply). En EPUB el
        // <mark> sí puede partirse en varias líneas, así que box-decoration-break:
        // clone mantiene el resaltado continuo entre líneas.
        mark.style.backgroundColor = toRgba(color, 0.5);
        mark.style.mixBlendMode = 'multiply';
        mark.style.boxDecorationBreak = 'clone';
        (mark.style as any).webkitBoxDecorationBreak = 'clone';
        mark.style.borderRadius = '3px';
        mark.style.transition = 'background-color 0.25s ease-in-out';

        try {
          range.surroundContents(mark);
          if (!highlightedAny) {
            // No usar mark.scrollIntoView(): scrollea el documento INTERNO del
            // iframe, lo cual entra en conflicto con el contenedor de scroll
            // que maneja epub.js en modo "scrolled-doc"/continuous (provoca
            // saltos/"peleas" de scroll). En su lugar, centramos la frase
            // resaltada desplazando el contenedor exterior del manager.
            const manager = (epubRenditionRef.current as any)?.manager;
            const scrollContainer: HTMLElement | undefined = manager?.container;
            // El <mark> vive dentro del documento del iframe de esta sección,
            // así que su getBoundingClientRect() está en coordenadas internas
            // del iframe, no del documento exterior donde vive scrollContainer.
            // Hay que sumarle la posición del propio iframe dentro del
            // documento exterior para poder compararlo con scrollContainer.
            const iframeEl: HTMLElement | undefined = contents?.iframe || (doc.defaultView?.frameElement as HTMLElement | undefined);
            if (scrollContainer && iframeEl) {
              const markRect = mark.getBoundingClientRect();
              const iframeRect = iframeEl.getBoundingClientRect();
              const containerRect = scrollContainer.getBoundingClientRect();
              const markCenter = iframeRect.top + markRect.top + markRect.height / 2;
              const containerCenter = containerRect.top + containerRect.height / 2;
              const delta = markCenter - containerCenter;
              scrollContainer.scrollBy({ top: delta, behavior: 'smooth' });
            } else {
              mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            highlightedAny = true;
          }
        } catch {
          // surroundContents falla si el rango cruza límites de elementos no
          // homogéneos; en ese caso se omite el resaltado de ese nodo.
        }
      });
    });

    // Si la frase no se encontró en ninguna sección actualmente renderizada,
    // es probable que el manager "continuous" de epub.js todavía no haya
    // montado el iframe de la siguiente sección (esto ocurre cuando el
    // scroll programático va más rápido que el precargado de capítulos).
    // Reintentamos un par de veces dejando tiempo a que epub.js la monte,
    // en vez de quedarnos sin resaltar/centrar para el resto de la lectura.
    if (!matchedInAnySection && retriesLeft > 0 && phraseText && phraseText.replace(/\s+/g, ' ').trim().length >= 3) {
      epubHighlightRetryRef.current = setTimeout(() => {
        epubHighlightRetryRef.current = null;
        highlightPhraseInEpub(phraseText, color, retriesLeft - 1, persistent);
      }, 400);
    }
  }, []);

  // Despacha el resaltado al lector correspondiente (PDF o EPUB).
  // persistent=true crea un resaltado permanente (cita guardada) que no se
  // borra en el siguiente paso del TTS.
  const highlightCurrentPhrase = useCallback((phraseText: string, color?: string, persistent: boolean = false) => {
    if (item?.type === 'epub') {
      highlightPhraseInEpub(phraseText, color, 3, persistent);
    } else {
      highlightPhraseInDOM(phraseText, color, persistent);
    }
  }, [item?.type, highlightPhraseInEpub, highlightPhraseInDOM]);

  // Borra TODOS los resaltados de cita persistentes (data-citation-highlight en
  // PDF, mark.__citation-highlight__ en EPUB). El resaltado normal de
  // highlightPhraseInDOM/Epub NO los limpia a propósito (para no borrar la cita
  // mientras el TTS avanza), pero al navegar a OTRA cita hay que partir de cero;
  // si no, el color de la cita anterior queda pegado y se ve un color distinto
  // al de la cita destino.
  const clearPersistentHighlights = useCallback(() => {
    if (item?.type === 'epub') {
      const contentsList = (epubRenditionRef.current as any)?.manager?.getContents?.() || [];
      contentsList.forEach((contents: any) => {
        const doc: Document = contents?.document;
        if (!doc?.body) return;
        doc.querySelectorAll('mark.__citation-highlight__').forEach((mark) => {
          const parent = mark.parentNode;
          if (!parent) return;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          parent.normalize();
        });
      });
    } else {
      document.querySelectorAll('.react-pdf__Page__textContent span[data-citation-highlight="true"]').forEach((span: any) => {
        span.style.backgroundColor = '';
        span.style.borderRadius = '';
        span.style.transition = '';
        span.style.mixBlendMode = '';
        span.style.opacity = '';
        delete span.dataset.citationHighlight;
      });
    }
  }, [item?.type]);

  // Crea una nota/cita a partir de la frase que el TTS está leyendo actualmente,
  // marcándola con el color elegido — sin abrir el panel de Anotaciones.
  // Se reutiliza el mismo canal que la selección manual de texto
  // (setSelectedCitation -> NotesPanel), que es la única fuente de verdad que
  // escribe en localStorage[`notes-${bookId}`]. Escribir aquí directamente en
  // localStorage provocaba pérdidas intermitentes de la nota: el estado React
  // de NotesPanel podía sobreescribir el storage con datos desactualizados
  // justo después (p.ej. al recolorear o crear otra nota).
  const createNoteFromCurrentPhrase = useCallback((color: string, hex: string) => {
    const phraseText = phrases[currentPhraseIndex];
    if (!phraseText) return;

    setSelectedCitation({
      text: phraseText,
      color,
      timestamp: Date.now(),
      page: item?.type === 'epub' ? undefined : currentPage,
    });

    // Resalta visualmente la frase en el color elegido de forma persistente,
    // para que no se borre cuando el TTS avance a la siguiente frase.
    highlightCurrentPhrase(phraseText, hex, true);
  }, [phrases, currentPhraseIndex, item?.type, currentPage, highlightCurrentPhrase]);

  // Detener la reproducción de voz
  const handleTtsStop = useCallback(() => {
    // Cancelar cualquier fetch TTS en vuelo antes de todo lo demás
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (ttsStepTimeoutRef.current) {
      clearTimeout(ttsStepTimeoutRef.current);
      ttsStepTimeoutRef.current = null;
    }
    if (epubHighlightRetryRef.current) {
      clearTimeout(epubHighlightRetryRef.current);
      epubHighlightRetryRef.current = null;
    }
    ttsStepTargetRef.current = null;
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.src = '';
      setCurrentAudio(null);
    }
    // Liberar recursos de la precarga si existen
    if (preloadedAudioRef.current) {
      URL.revokeObjectURL(preloadedAudioRef.current.url);
      preloadedAudioRef.current.audio.src = '';
      preloadedAudioRef.current = null;
    }
    setTtsStatus('idle');
    setCurrentPhraseIndex(-1);
    highlightCurrentPhrase('');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  }, [currentAudio, highlightCurrentPhrase]);

  // Reproducción paso a paso frase por frase con pre-fetching asíncrono y resiliencia a errores.
  //
  // isInitial=true indica que esta es la PRIMERA frase de una nueva sesión de
  // lectura (al presionar Play). En ese caso, el resaltado dispara un scroll
  // automático para centrar la frase en pantalla — si empezamos a reproducir
  // el audio inmediatamente, el usuario ve/escucha la frase mientras la
  // pantalla todavía está "saltando" hacia esa posición (la sensación de
  // salto/desfase que reportó el usuario). Por eso esperamos a que el scroll
  // suave termine antes de pedir/reproducir el audio. En los avances
  // subsiguientes (onended) no se espera, para no introducir pausas entre
  // frases durante la lectura continua.
  const playPhrase = useCallback(async (index: number, phraseList: string[], isInitial: boolean = false) => {
    if (index < 0 || index >= phraseList.length) {
      handleTtsStop();
      return;
    }

    // Esta es una reproducción real (no un paso de debounce pendiente)
    ttsStepTargetRef.current = null;
    if (ttsStepTimeoutRef.current) {
      clearTimeout(ttsStepTimeoutRef.current);
      ttsStepTimeoutRef.current = null;
    }

    setTtsStatus('loading');
    setCurrentPhraseIndex(index);
    const phraseText = phraseList[index];

    // Recordar esta posición para reanudar la lectura aquí la próxima vez
    // que se presione "Play" (solo para lectura de página, no de selección).
    if (ttsTextSource === 'page') {
      saveTtsPosition(index, phraseText);
    }

    // Resaltar visualmente la frase en curso (PDF por rangos de caracteres, EPUB por <mark>)
    // y centrarla en pantalla mediante scroll suave.
    highlightCurrentPhrase(phraseText);

    if (isInitial) {
      // Dar tiempo a que el scroll suave de centrado termine antes de
      // empezar a generar/reproducir el audio.
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Desconectar listeners del audio previo para evitar el "error fantasma"
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.src = '';
    }

    try {
      let audio: HTMLAudioElement;
      let audioUrl: string;

      // 1. Usar audio precargado si coincide con el índice solicitado
      if (preloadedAudioRef.current && preloadedAudioRef.current.index === index) {
        audio = preloadedAudioRef.current.audio;
        audioUrl = preloadedAudioRef.current.url;
        preloadedAudioRef.current = null; // Liberar la referencia de precarga
      } else {
        // Cancelar fetch anterior si aún está en vuelo
        if (ttsAbortRef.current) {
          ttsAbortRef.current.abort();
        }
        const controller = new AbortController();
        ttsAbortRef.current = controller;

        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({ text: phraseText, provider: selectedProvider, voiceId: selectedVoice, model: selectedModel })
        });

        ttsAbortRef.current = null;

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Fallo de respuesta de audio.');
        }

        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
        audio = new Audio(audioUrl);
      }

      audio.onended = () => {
        // Desconectar listeners de este audio antes de avanzar para evitar
        // que onerror se dispare cuando más adelante se vacíe audio.src
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(audioUrl);
        const nextIndex = index + 1;
        if (nextIndex < phraseList.length) {
          // Usar el ref estable — evita capturar el closure stale de playPhrase
          playPhraseRef.current?.(nextIndex, phraseList);
        } else {
          handleTtsStop();
        }
      };

      audio.onerror = () => {
        // Si src está vacío, el audio fue detenido intencionalmente — no es un error
        if (!audio.src || audio.src === '' || audio.src === window.location.href) return;
        setTtsStatus('error');
        setTtsErrorMessage('Error al reproducir esta frase.');
      };

      setCurrentAudio(audio);
      audio.play().then(() => {
        setTtsStatus('playing');
      }).catch((err) => {
        // play() puede rechazar si el audio precargado aún no estaba listo
        // (NotAllowedError/AbortError). Reintentar una vez tras recargarlo
        // evita que la lectura se quede "trabada" en silencio sin avanzar.
        console.warn('[WARN] audio.play() rechazada, reintentando:', err?.name || err);
        audio.load();
        audio.play().then(() => {
          setTtsStatus('playing');
        }).catch((err2) => {
          console.error('Error al reproducir audio tras reintento:', err2);
          setTtsStatus('error');
          setTtsErrorMessage('Error al reproducir esta frase.');
        });
      });

      // 2. Pre-cargar la siguiente frase de forma totalmente asíncrona y transparente
      const nextIndex = index + 1;
      if (nextIndex < phraseList.length) {
        // Limpiar precarga anterior si existiera
        if (preloadedAudioRef.current) {
          URL.revokeObjectURL(preloadedAudioRef.current.url);
          preloadedAudioRef.current.audio.src = '';
          preloadedAudioRef.current = null;
        }

        const nextPhraseText = phraseList[nextIndex];
        fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            text: nextPhraseText,
            provider: selectedProvider,
            voiceId: selectedVoice,
            model: selectedModel
          })
        })
        .then(res => {
          if (res.ok) return res.blob();
          throw new Error('Error de precarga');
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const preloadedAudio = new Audio(url);
          preloadedAudio.load();
          preloadedAudioRef.current = { index: nextIndex, audio: preloadedAudio, url };
        })
        .catch(err => {
          console.warn('[WARN] No se pudo precargar la siguiente frase:', err.message || err);
        });
      }

      // Configurar API MediaSession para mandos Bluetooth (auriculares/auto) y pantalla de bloqueo
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item?.title || 'Biblioteca Personal',
          artist: 'Lector de Voz Inteligente',
          album: `Pág. ${currentPage} · Frase ${index + 1} de ${phraseList.length}`,
          artwork: [
            { src: item?.thumbnailUrl || '/logo.png', sizes: '96x96', type: 'image/png' }
          ]
        });

        // Controles de auriculares o mandos inalámbricos
        navigator.mediaSession.setActionHandler('play', () => {
          audio.play();
          setTtsStatus('playing');
          navigator.mediaSession.playbackState = 'playing';
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          audio.pause();
          setTtsStatus('paused');
          navigator.mediaSession.playbackState = 'paused';
        });
        
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (index > 0) {
            playPhrase(index - 1, phraseList);
          }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (index < phraseList.length - 1) {
            playPhrase(index + 1, phraseList);
          }
        });
      }
    } catch (error: any) {
      // AbortError ocurre al cambiar proveedor/modelo — no es un error real
      if (error?.name === 'AbortError') return;
      console.error('Error in playPhrase:', error);
      setTtsStatus('error');
      setTtsErrorMessage(error.message || 'No se pudo reproducir la frase actual.');
    }
  }, [currentAudio, item, currentPage, selectedVoice, selectedProvider, selectedModel, highlightCurrentPhrase, handleTtsStop, ttsTextSource, saveTtsPosition]);

  // Mantener el ref siempre apuntando a la versión más reciente de playPhrase
  playPhraseRef.current = playPhrase;

  // Controles directos de Adelantar (>>) y Retroceder (<<) en la interfaz.
  //
  // Si el usuario presiona el botón varias veces en menos de medio segundo,
  // está navegando rápido por el texto y NO quiere que se generen/reproduzcan
  // audios para cada frase intermedia (eso dispararía una llamada a la IA por
  // cada click). En vez de reproducir inmediatamente, se actualiza el índice
  // "objetivo" y se espera a que el usuario deje de presionar por 500ms antes
  // de pedir el audio de la frase final.
  const scheduleTtsStep = useCallback((targetIndex: number, phraseList: string[]) => {
    if (targetIndex < 0 || targetIndex >= phraseList.length) return;

    ttsStepTargetRef.current = targetIndex;
    setCurrentPhraseIndex(targetIndex);
    highlightCurrentPhrase(phraseList[targetIndex]);

    if (ttsStepTimeoutRef.current) clearTimeout(ttsStepTimeoutRef.current);
    ttsStepTimeoutRef.current = setTimeout(() => {
      const finalIndex = ttsStepTargetRef.current;
      ttsStepTimeoutRef.current = null;
      ttsStepTargetRef.current = null;
      if (finalIndex !== null) {
        playPhrase(finalIndex, phraseList);
      }
    }, 500);
  }, [highlightCurrentPhrase, playPhrase]);

  const handleTtsPrevious = useCallback(() => {
    const base = ttsStepTargetRef.current !== null ? ttsStepTargetRef.current : currentPhraseIndex;
    scheduleTtsStep(base - 1, phrases);
  }, [currentPhraseIndex, phrases, scheduleTtsStep]);

  const handleTtsNext = useCallback(() => {
    const base = ttsStepTargetRef.current !== null ? ttsStepTargetRef.current : currentPhraseIndex;
    scheduleTtsStep(base + 1, phrases);
  }, [currentPhraseIndex, phrases, scheduleTtsStep]);

  // Cancelar el debounce de avance/retroceso pendiente al desmontar o detener
  useEffect(() => {
    return () => {
      if (ttsStepTimeoutRef.current) clearTimeout(ttsStepTimeoutRef.current);
    };
  }, []);

  // Helper: obtiene texto de una página del DOM; si está vacío y es PDF server, usa OCR
  const getPageTextWithOcrFallback = useCallback(async (pageNum: number): Promise<string> => {
    // EPUB: epubjs renderiza cada "página" visible dentro de uno o más iframes
    // internos (vista de página única o doble). Leemos el texto visible de todos
    // los iframes activos de la rendition actual.
    if (item?.type === 'epub') {
      return getEpubVisibleText();
    }
    const pageEl = document.getElementById(`pdf-page-${pageNum}`);
    if (pageEl) {
      const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
      const domText = (textLayer ? textLayer.textContent : pageEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (domText.length > 0) return domText;
    }
    // Fallback OCR para PDFs escaneados
    if (item?.type === 'pdf' && item.source?.startsWith('/api/files/')) {
      const fileName = item.source.replace('/api/files/', '');
      try {
        const ocrRes = await fetch('/api/ocr-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fileName, pageNumber: pageNum }),
        });
        if (ocrRes.ok) {
          const { text } = await ocrRes.json();
          return (text || '').trim();
        }
      } catch { /* no-op */ }
    }
    return '';
  }, [item?.type, item?.source, getEpubVisibleText]);

  // Cambio de página desde el widget TTS con auto-lectura
  const handleTtsPrevPage = useCallback(() => {
    if (item?.type === 'epub') {
      handleTtsStop();
      epubRenditionRef.current?.prev();
    } else {
      const page = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
      if (page <= 1) return;
      const newPage = page - 1;
      handleTtsStop();
      setTargetPage({ page: newPage, t: Date.now() });
      setCurrentPage(newPage);
    }
    setTimeout(async () => {
      const text = await getPageTextWithOcrFallback(typeof currentPage === 'number' ? currentPage - 1 : 0);
      if (text) {
        const phraseList = text.split('.').map(p => p.trim()).filter(p => p.length > 0).map(p => p + '.');
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList, true);
      }
    }, 800);
  }, [currentPage, item?.type, handleTtsStop, playPhrase, getPageTextWithOcrFallback]);

  const handleTtsNextPage = useCallback(() => {
    if (item?.type === 'epub') {
      handleTtsStop();
      epubRenditionRef.current?.next();
    } else {
      const page = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
      if (page >= totalPages) return;
      const newPage = page + 1;
      handleTtsStop();
      setTargetPage({ page: newPage, t: Date.now() });
      setCurrentPage(newPage);
    }
    setTimeout(async () => {
      const text = await getPageTextWithOcrFallback(typeof currentPage === 'number' ? currentPage + 1 : 0);
      if (text) {
        const phraseList = text.split('.').map(p => p.trim()).filter(p => p.length > 0).map(p => p + '.');
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList, true);
      }
    }, 800);
  }, [currentPage, totalPages, item?.type, handleTtsStop, playPhrase, getPageTextWithOcrFallback]);

  // Play / Pausa general
  const handleTtsPlayPause = async () => {
    if (ttsStatus === 'playing' && currentAudio) {
      currentAudio.pause();
      setTtsStatus('paused');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      return;
    }

    if (ttsStatus === 'paused' && currentAudio) {
      currentAudio.play();
      setTtsStatus('playing');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      return;
    }

    // Nueva lectura
    setTtsStatus('loading');
    setTtsErrorMessage('');

    let textToRead = '';
    let source: 'selection' | 'page' = 'page';

    if (selectedText && selectedText.trim().length > 0) {
      textToRead = selectedText.trim();
      source = 'selection';
    } else {
      // "Inicio del capítulo" en EPUB requiere navegar la rendition al inicio
      // del capítulo actual ANTES de extraer el texto visible, ya que el
      // contenido renderizado cambia tras la navegación.
      if (item?.type === 'epub' && ttsStartSource === 'chapter') {
        await navigateEpubToChapterStart();
        // Esperar a que epub.js termine de renderizar el nuevo contenido
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      textToRead = getActivePageText();
      source = 'page';
    }

    if (!textToRead || textToRead.length === 0) {
      // Fallback OCR para PDFs escaneados (sin text layer)
      if (item?.type === 'pdf' && item.source?.startsWith('/api/files/')) {
        const fileName = item.source.replace('/api/files/', '');
        const pageNum = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
        try {
          const ocrRes = await fetch('/api/ocr-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ fileName, pageNumber: pageNum }),
          });
          if (ocrRes.ok) {
            const { text: ocrText } = await ocrRes.json();
            if (ocrText && ocrText.trim().length > 0) {
              const phraseList = splitIntoPhrases(ocrText);
              if (phraseList.length > 0) {
                setTtsTextSource('page');
                setPhrases(phraseList);
                playPhrase(loadTtsPosition(phraseList), phraseList, true);
                return;
              }
            }
          }
        } catch { /* si el OCR falla, caemos al error original */ }
      }
      setTtsStatus('error');
      setTtsErrorMessage('No se encontró texto legible en la página actual. Intenta seleccionando texto.');
      return;
    }

    setTtsTextSource(source);

    const phraseList = splitIntoPhrases(textToRead);
    if (phraseList.length === 0) {
      setTtsStatus('error');
      setTtsErrorMessage('No se pudo segmentar el texto en frases legibles.');
      return;
    }

    setPhrases(phraseList);

    let startIndex = 0;
    if (source === 'page') {
      switch (ttsStartSource) {
        case 'chapter':
          // EPUB ya navegó al inicio del capítulo; el texto extraído ya
          // corresponde a ese punto, así que empezamos desde lo visible ahí.
          startIndex = item?.type === 'epub' ? await getVisiblePhraseStartIndex(phraseList) : getChapterStartIndexInPage(phraseList);
          break;
        case 'lastRead':
          startIndex = loadTtsPosition(phraseList);
          break;
        case 'visible':
        default:
          startIndex = await getVisiblePhraseStartIndex(phraseList);
          break;
      }
    }

    playPhrase(startIndex, phraseList, true);
  };

  const handleTtsClose = useCallback(() => {
    handleTtsStop();
    setShowTtsWidget(false);
  }, [handleTtsStop]);

  useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
      }
    };
  }, [currentAudio]);

  const handlePageChange = useCallback((page: number | string, total?: number) => {
    setCurrentPage(page);
    if (total && total > 0) {
      setTotalPages(total);
    }
  }, []);

  const [activePalette, setActivePalette ] = useState<{ id: string, color: string, bgClass: string, borderClass: string, textClass: string, name: string, hex: string }[]>([]);

  const DEFAULT_PALETTE = [
    { id: 'rose-400', color: 'rose-400', bgClass: 'bg-rose-50/50', borderClass: 'border-rose-400', textClass: 'text-rose-600', name: 'Rojo', hex: '#fb7185' },
    { id: 'sky-400', color: 'sky-400', bgClass: 'bg-sky-50/50', borderClass: 'border-sky-400', textClass: 'text-sky-600', name: 'Azul', hex: '#38bdf8' },
    { id: 'emerald-400', color: 'emerald-400', bgClass: 'bg-emerald-50/50', borderClass: 'border-emerald-400', textClass: 'text-emerald-600', name: 'Verde', hex: '#34d399' },
    { id: 'amber-400', color: 'amber-400', bgClass: 'bg-amber-50/50', borderClass: 'border-amber-400', textClass: 'text-amber-600', name: 'Amarillo', hex: '#fbbf24' }
  ];

  useEffect(() => {
    if (!bookId) return;
    fetch(`/api/documents/${bookId}/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setActivePalette(d.settings?.colorPalette ?? DEFAULT_PALETTE);
      })
      .catch(() => setActivePalette(DEFAULT_PALETTE));
  }, [bookId]);

  // Aplica el resaltado pendiente al navegar desde una cita guardada
  // (CitationsManager). Para PDF se espera a que la página destino termine de
  // renderizarse; para EPUB, highlightPhraseInEpub ya reintenta mientras la
  // sección se monta.
  useEffect(() => {
    if (!pendingHighlight) return;
    const { text, color } = pendingHighlight;

    // Limpia el resaltado de la cita anterior antes de pintar la nueva, para que
    // no se quede pegado un color distinto al de la cita a la que navegamos.
    clearPersistentHighlights();

    // Tanto PDF como EPUB resaltan con reintentos internos mientras la página/
    // sección destino termina de montarse, así que se puede llamar de inmediato.
    highlightCurrentPhrase(text, color, true);
    setPendingHighlight(null);
  }, [pendingHighlight, item?.type, highlightCurrentPhrase, clearPersistentHighlights]);

  // New states for fullscreen and split view
  const [isFullscreen, setIsFullscreen] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [showControls, setShowControls] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
  const [notesPosition, setNotesPosition] = useState<'right' | 'left'>('right');
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isPortrait, setIsPortrait] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

  useEffect(() => {
    const handleResize = () => {
       setIsPortrait(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Pantalla completa REAL del navegador (Fullscreen API): oculta la barra de
  // direcciones, pestañas y todo el cromo del navegador. Debe dispararse desde
  // un gesto del usuario (click), por eso vive en el handler del botón.
  const toggleFullscreen = useCallback(() => {
    const docEl: any = document.documentElement;
    const doc: any = document;
    const isNativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (!isNativeFs) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
      // Activamos también el modo expandido propio (oculta header/controles).
      setIsFullscreen(true);
      setShowControls(false);
      if (req) {
        Promise.resolve(req.call(docEl)).catch(() => { /* algunos navegadores móviles lo rechazan; el modo CSS ya cubre el caso */ });
      }
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) {
        Promise.resolve(exit.call(doc)).catch(() => {});
      }
      setIsFullscreen(false);
    }
  }, []);

  // Sincroniza el estado si el usuario sale del fullscreen nativo con Esc o el
  // gesto del sistema, para que el ícono/estado vuelvan a su sitio.
  useEffect(() => {
    const onFsChange = () => {
      const doc: any = document;
      const isNativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isNativeFs) {
        setIsFullscreen(false);
        setShowControls(true);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as any);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as any);
    };
  }, []);

  // Ref siempre actualizada a handleTtsStop, para poder llamarla desde
  // listeners/cleanups sin que una closure vieja se quede "pegada".
  const handleTtsStopRef = useRef(handleTtsStop);
  useEffect(() => { handleTtsStopRef.current = handleTtsStop; }, [handleTtsStop]);

  // Detener la lectura de voz al bloquear/minimizar la pantalla (visibilitychange,
  // p.ej. el móvil se bloquea) o al salir de la vista del lector (desmontaje,
  // p.ej. el usuario vuelve a la biblioteca). Evita que el audio siga sonando
  // "en segundo plano" sin que el usuario lo vea ni pueda controlarlo.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleTtsStopRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      handleTtsStopRef.current();
    };
  }, []);

  // Auto-ocultado de la barra flotante de página/zoom tras 5s sin interacción.
  // Reaparece al tocar/hacer click en cualquier parte del lector.
  const [pageControlsVisible, setPageControlsVisible] = useState(true);
  useEffect(() => {
    const resetTimer = () => {
      setPageControlsVisible(true);
    };
    let timer = setTimeout(() => setPageControlsVisible(false), 5000);
    const handleActivity = () => {
      setPageControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setPageControlsVisible(false), 5000);
    };
    resetTimer();
    const container = containerRef.current;
    container?.addEventListener('pointerdown', handleActivity);
    return () => {
      clearTimeout(timer);
      container?.removeEventListener('pointerdown', handleActivity);
    };
  }, [bookId]);

  // Mide la altura real de la barra del reproductor TTS para que los
  // controles de página/zoom del PDF se desplacen hacia arriba y no queden
  // tapados por ella (la altura varía según si el panel de configuración
  // está abierto o hay un mensaje de error visible).
  useEffect(() => {
    const el = ttsWidgetRef.current;
    if (!showTtsWidget || !el) {
      setTtsWidgetHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTtsWidgetHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setTtsWidgetHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [showTtsWidget, showTtsSettings, ttsStatus]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent | TouchEvent) => {
        if (!isDragging) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        if (isPortrait) {
            // vertical split
            const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
            const p = (y / rect.height) * 100;
            // if position is 'left' (which means top in portrait), Reader is at the top
            // actually let's say 'right' means Notes are at the bottom, so Reader is top
            setSplitRatio(notesPosition === 'right' ? p : 100 - p);
        } else {
            // horizontal split
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const p = (x / rect.width) * 100;
            setSplitRatio(notesPosition === 'right' ? p : 100 - p);
        }
    };
    const onMouseUp = () => setIsDragging(false);
    
    if (isDragging) {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('touchmove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchend', onMouseUp);
        document.body.style.userSelect = 'none'; // prevent text selection while dragging
    } else {
        document.body.style.userSelect = '';
    }
    return () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchend', onMouseUp);
        document.body.style.userSelect = '';
    }
  }, [isDragging, notesPosition, isPortrait]);

  // Handle controls disappearing when clicking the screen in fullscreen
  const handleScreenClick = (e: React.MouseEvent) => {
     if (isFullscreen) {
        setShowControls(prev => !prev);
     }
  };

  useEffect(() => {
    // El EPUB gestiona su propia selección/limpieza vía los eventos 'selected'
    // y 'click' de la rendition (la selección real vive dentro del iframe y
    // window.getSelection() del documento principal siempre está vacío aquí,
    // lo que borraría la toolbar de citas en cada mouseup).
    if (item?.type === 'epub') return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        if (text) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setSelectedText(text);
          setSelectionRect({ top: rect.top, left: rect.left, width: rect.width });
          return;
        }
      }
      if (selectionRect) {
         setSelectionRect(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', () => setTimeout(handleMouseUp, 100));
    return () => {
       document.removeEventListener('mouseup', handleMouseUp);
       document.removeEventListener('touchend', handleMouseUp);
    };
  }, [selectionRect, item?.type]);



  const [brightness, setBrightness] = useState(100);
  const [showBrightnessPopup, setShowBrightnessPopup] = useState(false);
  const [interactionMode, setInteractionMode] = useState<'pan' | 'select'>(isPortrait ? 'pan' : 'select');

  if (!item) {
    return <div className="h-screen flex items-center justify-center font-bold">Elemento no encontrado</div>;
  }

  const renderPhysicalBookDashboard = () => {
    const progState = {
      text: item.read ? "Leído" : (item.progress || 0) <= 25 ? "Consultado" : (item.progress || 0) <= 50 ? "En proceso" : (item.progress || 0) < 100 ? "Revisado" : "Leído",
      color: item.read ? "bg-emerald-500" : (item.progress || 0) <= 25 ? "bg-slate-500" : (item.progress || 0) <= 50 ? "bg-amber-500" : (item.progress || 0) < 100 ? "bg-blue-500" : "bg-emerald-500"
    };
    const pValue = item.read ? 100 : Math.min(100, Math.max(0, item.progress || 0));

    return (
      <div className="w-full h-full flex items-center justify-center p-4 sm:p-8 overflow-y-auto bg-slate-50/50 animate-in fade-in duration-300">
        <div className="max-w-2xl w-full bg-white rounded-3xl border border-slate-200/60 shadow-xl p-6 sm:p-8 flex flex-col md:flex-row gap-6 md:gap-8 items-stretch">
          
          {/* Columna Izquierda: Portada */}
          <div className="w-full md:w-48 shrink-0 flex flex-col items-center gap-3">
            <div className="relative aspect-[2/3] w-40 md:w-full rounded-2xl overflow-hidden bg-gradient-to-br from-[#00558F] to-slate-800 shadow-lg border border-slate-100 flex flex-col items-center justify-center p-3 text-center">
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full">
                  <BookOpen className="w-12 h-12 text-white/30 mb-2" />
                  <span className="text-white/60 text-xs font-bold uppercase tracking-wider">Libro Físico</span>
                </div>
              )}
              <div className="absolute top-2 left-2 bg-[#00558F] text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md">
                Físico
              </div>
            </div>
            
            {/* Rating */}
            <div className="flex flex-col items-center gap-1 mt-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tu Calificación</span>
              <StarRating value={item.rating || 0} onChange={(v) => updateItem(item.id, { rating: v })} size="lg" />
            </div>
          </div>

          {/* Columna Derecha: Detalles + Acciones */}
          <div className="flex-1 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div>
                <span className="text-[10px] text-[#00558F] font-black uppercase tracking-wider">Título</span>
                <h1 className="text-xl sm:text-2xl font-black text-slate-800 leading-tight">{item.title}</h1>
              </div>

              {item.author && (
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Autor</span>
                  <p className="text-sm font-semibold text-slate-700">{item.author}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {item.year && (
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Año</span>
                    <p className="text-sm font-semibold text-slate-700">{item.year}</p>
                  </div>
                )}
                {item.publisher && (
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Editorial</span>
                    <p className="text-sm font-semibold text-slate-700">{item.publisher}</p>
                  </div>
                )}
                {item.isbn && (
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">ISBN</span>
                    <p className="text-sm font-mono font-semibold text-slate-700">{item.isbn}</p>
                  </div>
                )}
                {item.subject && (
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tema / Materia</span>
                    <p className="text-sm font-semibold text-slate-700">{item.subject}</p>
                  </div>
                )}
              </div>

              {/* Progreso */}
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-slate-400">Progreso de Lectura</span>
                  <span className={cn(progState.color.replace('bg-', 'text-'))}>{pValue}% ({progState.text})</span>
                </div>
                <div className="flex items-center gap-3">
                  <DraggableProgress 
                    value={pValue} 
                    color={progState.color} 
                    onChange={(v) => updateItem(item.id, { progress: v, ...(item.read && v < 100 ? { read: false } : {}) })} 
                  />
                  <button 
                    onClick={() => updateItem(item.id, { read: !item.read })}
                    className={cn("text-xs font-bold px-3 py-1 rounded-lg border transition-all", item.read ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300")}
                  >
                    {item.read ? "Leído" : "Marcar Leído"}
                  </button>
                </div>
              </div>
            </div>

            {/* Botones de acción principales */}
            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setActiveTab('edit')}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-200 hover:border-[#00558F] text-slate-700 hover:text-[#00558F] font-bold text-sm transition-all shadow-sm active:scale-95 bg-white"
              >
                <Info className="w-4 h-4" />
                Editar Info
              </button>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95 border",
                  showNotes 
                    ? "bg-[#00558F] text-white border-[#00558F]" 
                    : "bg-white border-slate-200 hover:border-[#00558F] text-slate-700 hover:text-[#00558F]"
                )}
              >
                <MessageSquareQuote className="w-4 h-4" />
                {showNotes ? "Cerrar Notas" : "Apuntes y Notas"}
              </button>
            </div>

          </div>

        </div>
      </div>
    );
  };

  const renderReader = () => {
    if (isPhysicalOnly) {
      return renderPhysicalBookDashboard();
    }
    return (
     <div 
        className={cn("w-full h-full flex flex-col relative transition-all duration-300 pointer-events-auto")}
        onClick={handleScreenClick}
     >
        <div className="flex-1 overflow-hidden pointer-events-auto">
          {item.type === 'pdf' && <PDFReader url={item.source} hideControls={isFullscreen && !showControls} onPageChange={handlePageChange} targetPage={targetPage} bottomOffset={showTtsWidget ? ttsWidgetHeight : 0} controlsVisible={pageControlsVisible} />}
          {item.type === 'epub' && (
            <EPUBReader
              url={item.source}
              bottomOffset={showTtsWidget ? ttsWidgetHeight : 0}
              controlsVisible={pageControlsVisible}
              getRendition={(rendition) => {
                epubRenditionRef.current = rendition;
                rendition.on('selected', (_cfiRange: string, contents: any) => {
                  const sel = contents?.window?.getSelection?.();
                  const text = sel?.toString().trim();
                  if (!text || !sel?.rangeCount) return;
                  const range = sel.getRangeAt(0);
                  const rect = range.getBoundingClientRect();
                  // El iframe interno de epubjs tiene su propio viewport; sumamos
                  // su offset para posicionar la toolbar flotante en coordenadas
                  // del documento principal.
                  const iframeEl = contents?.document?.defaultView?.frameElement as HTMLElement | undefined;
                  const iframeRect = iframeEl?.getBoundingClientRect();
                  setSelectedText(text);
                  setSelectionRect({
                    top: rect.top + (iframeRect?.top || 0),
                    left: rect.left + (iframeRect?.left || 0),
                    width: rect.width,
                  });
                });
                // Sin esto, un click sin arrastre dentro del iframe no limpia
                // la toolbar de citas previa (el listener de mouseup del
                // documento principal no llega al iframe).
                rendition.on('click', () => {
                  const sel = (rendition as any).manager?.getContents?.()?.[0]?.window?.getSelection?.();
                  if (sel && !sel.isCollapsed) return;
                  setSelectedText('');
                  setSelectionRect(null);
                });
              }}
            />
          )}
          {item.type === 'txt' && <TxtReader url={item.source} />}
          {item.type === 'externa' && (
            <div className="w-full h-full flex flex-col pointer-events-auto">
              <div className="bg-[#FFA300]/10 text-[#FFA300] p-3 text-sm font-medium text-center shadow-inner">
                 Estás viendo contenido externo. Algunas funciones pueden estar limitadas.
              </div>
              <iframe src={item.source} className="w-full flex-1 border-0" sandbox="allow-scripts allow-same-origin bg-white" />
            </div>
          )}
        </div>

          {/* Reproductor de Lector de Voz (TTS) — barra inferior contenida en el
              panel del lector (no debe tapar el panel de Anotaciones) */}
          {showTtsWidget && (
             <div ref={ttsWidgetRef} className="absolute bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-card)] shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-2 duration-300 overflow-y-auto custom-scrollbar" style={{ paddingBottom: 'env(safe-area-inset-bottom)', maxHeight: '85dvh' }}>
                <div className="max-w-xl mx-auto px-3 pt-2 pb-2 sm:px-4">

                   {/* Panel de configuración colapsable (modelo/voz/origen).
                       En móvil horizontal limita su alto y permite scroll para
                       que la fila de controles inferior nunca quede oculta. */}
                   {showTtsSettings && (
                      <div className="flex flex-col gap-2.5 mb-3 pb-3 border-b border-[var(--border-card)] max-h-[40vh] overflow-y-auto custom-scrollbar">
                         {/* Selector de Proveedor / Motor de Voz */}
                         <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5">
                            <span className="text-[var(--text-muted)] font-semibold">Modelo:</span>
                            <select
                               value={selectedProvider}
                               onChange={(e) => {
                                  const prov = e.target.value as 'elevenlabs' | 'google' | 'google-standard';
                                  handleTtsStop(); // cancela fetch en vuelo, limpia precarga y audio
                                  setSelectedProvider(prov);
                                  if (prov === 'elevenlabs') {
                                     setSelectedVoice('6Gr4AVmTax1pMJO0lHRK');
                                  } else if (prov === 'google') {
                                     setSelectedVoice('Erinome');
                                     setSelectedModel('gemini-2.0-flash');
                                  } else {
                                     setSelectedVoice('es-ES-Standard-A');
                                  }
                               }}
                               className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none"
                            >
                               <option value="elevenlabs" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">ElevenLabs (Voz)</option>
                               <option value="google" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Google Gemini (Voz/IA)</option>
                               <option value="google-standard" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Google Standard (Gratis)</option>
                            </select>
                         </div>

                         {/* Selector de Modelo (Solo si el motor es Google Gemini) */}
                         {selectedProvider === 'google' && (
                            <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                               <span className="text-[var(--text-muted)] font-semibold shrink-0">Modelo IA:</span>
                               <select
                                  value={selectedModel}
                                  onChange={(e) => {
                                     handleTtsStop(); // cancela fetch en vuelo antes de cambiar modelo
                                     setSelectedModel(e.target.value);
                                  }}
                                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none max-w-[165px] truncate"
                               >
                                  {GOOGLE_MODELS.map(m => (
                                     <option key={m.id} value={m.id} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">{m.name}</option>
                                  ))}
                               </select>
                            </div>
                         )}

                         {/* Selector de Voz con favoritos */}
                         {(() => {
                            const allVoices = selectedProvider === 'elevenlabs' ? ELEVENLABS_VOICES : selectedProvider === 'google' ? GOOGLE_VOICES : GOOGLE_STANDARD_VOICES;
                            const favorites = allVoices.filter(v => favoriteVoices.includes(v.id));
                            const rest = allVoices.filter(v => !favoriteVoices.includes(v.id));
                            const currentVoiceName = allVoices.find(v => v.id === selectedVoice)?.name || selectedVoice;
                            return (
                              <div className="relative text-xs">
                                 <div className="flex items-center justify-between bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                                    <span className="text-[var(--text-muted)] font-semibold shrink-0">Voz:</span>
                                    <button
                                       onClick={() => setShowVoiceDropdown(v => !v)}
                                       className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-bold text-slate-800 dark:text-slate-100 cursor-pointer transition-colors shadow-sm max-w-[170px] truncate"
                                    >
                                       {favoriteVoices.includes(selectedVoice) && <span className="text-yellow-400 text-[10px]">★</span>}
                                       <span className="truncate">{currentVoiceName}</span>
                                       <ChevronUp className="w-3 h-3 shrink-0 opacity-50" />
                                    </button>
                                 </div>
                                 {showVoiceDropdown && (
                                    <div className="absolute right-0 bottom-full mb-1 z-50 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                                       <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                          {favorites.length > 0 && (
                                             <div className="px-2 pt-2 pb-1">
                                                <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wide px-1">★ Favoritas</span>
                                                {favorites.map(v => (
                                                   <button key={v.id} onClick={() => { setSelectedVoice(v.id); handleTtsStop(); setShowVoiceDropdown(false); }}
                                                      className={cn("w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors", selectedVoice === v.id ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100")}
                                                   >
                                                      <span className="truncate text-xs">{v.name}</span>
                                                      <span onClick={(e) => toggleFavoriteVoice(v.id, e)} className="text-yellow-400 hover:text-yellow-500 shrink-0 px-1 cursor-pointer">★</span>
                                                   </button>
                                                ))}
                                             </div>
                                          )}
                                          {rest.length > 0 && (
                                             <div className="px-2 pt-1 pb-2">
                                                {favorites.length > 0 && <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wide px-1">Todas</span>}
                                                {rest.map(v => (
                                                   <button key={v.id} onClick={() => { setSelectedVoice(v.id); handleTtsStop(); setShowVoiceDropdown(false); }}
                                                      className={cn("w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors", selectedVoice === v.id ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100")}
                                                   >
                                                      <span className="truncate text-xs">{v.name}</span>
                                                      <span onClick={(e) => toggleFavoriteVoice(v.id, e)} className="text-slate-300 hover:text-yellow-400 shrink-0 px-1 cursor-pointer">☆</span>
                                                   </button>
                                                ))}
                                             </div>
                                          )}
                                       </div>
                                    </div>
                                 )}
                              </div>
                            );
                         })()}

                         {ttsTextSource === 'selection' && (
                            <div className="bg-[var(--bg-app)]/50 border border-[var(--border-card)] rounded-xl p-2.5 flex items-center justify-between text-xs">
                               <span className="text-[var(--text-muted)] text-[10px]">Origen de lectura:</span>
                               <span className="font-semibold text-[var(--text-main)] truncate max-w-[150px]">Texto Seleccionado</span>
                            </div>
                         )}

                         {/* Selector de punto de inicio de la lectura al presionar Play */}
                         <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                            <span className="text-[var(--text-muted)] font-semibold shrink-0">Comenzar desde:</span>
                            <select
                               value={ttsStartSource}
                               onChange={(e) => setTtsStartSource(e.target.value as 'visible' | 'chapter' | 'lastRead')}
                               className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none max-w-[150px] truncate"
                            >
                               <option value="visible" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Texto en pantalla</option>
                               <option value="chapter" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Inicio del capítulo</option>
                               <option value="lastRead" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Última lectura</option>
                            </select>
                         </div>

                         {ttsStatus === 'error' && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-xs leading-relaxed max-h-24 overflow-y-auto custom-scrollbar">
                               {ttsErrorMessage}
                            </div>
                         )}
                      </div>
                   )}

                   {/* Fila de colores: resalta la frase actual y crea la nota en silencio */}
                   <div className="flex items-center justify-center gap-3 mb-2">
                      {activePalette.slice(0, 5).map((colorItem) => (
                         <button
                           key={colorItem.id}
                           disabled={currentPhraseIndex < 0 || phrases.length === 0}
                           onClick={() => createNoteFromCurrentPhrase(colorItem.color, colorItem.hex)}
                           style={{ backgroundColor: colorItem.hex }}
                           className="w-6 h-6 rounded-full hover:scale-110 active:scale-95 transition-transform ring-2 ring-transparent hover:ring-[var(--border-card)] disabled:opacity-30 disabled:pointer-events-none shadow-sm cursor-pointer"
                           title={`Resaltar y anotar (${colorItem.name})`}
                         />
                      ))}
                   </div>

                   {/* Fila de controles: [config] [pág◀] [◀◀frase] [stop] [▶play] [frase▶▶] [▶pág] [cerrar].
                       En móvil estrecho se permite scroll horizontal y los botones no se encogen,
                       evitando que queden cortados/ocultos. */}
                   <div className="flex items-center justify-start sm:justify-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar px-1 py-0.5 [&>button]:shrink-0">

                      {/* Mostrar/ocultar configuración */}
                      <button
                        onClick={() => setShowTtsSettings(v => !v)}
                        className={cn("p-2 border rounded-full transition-all active:scale-95 shadow-sm", showTtsSettings ? "bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30" : "bg-[var(--bg-app)] hover:bg-slate-200/50 border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)]")}
                        title="Configuración de voz"
                      >
                         <Settings className="w-4 h-4" />
                      </button>

                      {/* Página anterior — triángulo+línea izquierda */}
                      <button
                        disabled={item?.type !== 'epub' && (typeof currentPage === 'number' ? currentPage <= 1 : parseInt(String(currentPage)) <= 1)}
                        onClick={handleTtsPrevPage}
                        className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                        title="Página Anterior"
                      >
                         <SkipBack className="w-4 h-4 fill-current" />
                      </button>

                      {/* Retroceder frase — flechas dobles */}
                      <button
                        disabled={currentPhraseIndex <= 0 || ttsStatus === 'loading' || ttsStatus === 'idle'}
                        onClick={handleTtsPrevious}
                        className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                        title="Frase Anterior"
                      >
                         <Rewind className="w-4 h-4 fill-current" />
                      </button>

                      {/* Stop */}
                      <button
                        disabled={ttsStatus === 'idle' || ttsStatus === 'loading'}
                        onClick={handleTtsStop}
                        className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-red-500 disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                        title="Detener"
                      >
                         <Square className="w-4 h-4 fill-current" />
                      </button>

                      {/* Play / Pause — botón central grande */}
                      <button
                        disabled={ttsStatus === 'loading'}
                        onClick={handleTtsPlayPause}
                        className={cn(
                          "p-3.5 rounded-full text-white shadow-lg transition-all active:scale-95 duration-200 flex items-center justify-center",
                          ttsStatus === 'playing'
                            ? "bg-[var(--primary)] hover:bg-[var(--primary-hover)] ring-4 ring-[var(--primary)]/15"
                            : "bg-[var(--primary)] hover:bg-[var(--primary-hover)]"
                        )}
                        title={ttsStatus === 'playing' ? "Pausar" : "Reproducir"}
                      >
                         {ttsStatus === 'loading' ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                         ) : ttsStatus === 'playing' ? (
                            <Pause className="w-5 h-5 fill-current" />
                         ) : (
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                         )}
                      </button>

                      {/* Adelantar frase — flechas dobles */}
                      <button
                        disabled={currentPhraseIndex >= phrases.length - 1 || ttsStatus === 'loading' || ttsStatus === 'idle'}
                        onClick={handleTtsNext}
                        className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                        title="Frase Siguiente"
                      >
                         <FastForward className="w-4 h-4 fill-current" />
                      </button>

                      {/* Página siguiente — triángulo+línea derecha */}
                      <button
                        disabled={item?.type !== 'epub' && (typeof currentPage === 'number' ? currentPage >= totalPages : parseInt(String(currentPage)) >= totalPages)}
                        onClick={handleTtsNextPage}
                        className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                        title="Página Siguiente"
                      >
                         <SkipForward className="w-4 h-4 fill-current" />
                      </button>

                      {/* Cerrar reproductor */}
                      <button
                        onClick={handleTtsClose}
                        className="p-2 bg-[var(--bg-app)] hover:bg-red-50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-red-500 rounded-full transition-all active:scale-95 shadow-sm"
                        title="Cerrar Lector de Voz"
                      >
                         <X className="w-4 h-4" />
                      </button>

                   </div>

                </div>
             </div>
          )}
     </div>
    );
  };

  const [isNotesFocused, setIsNotesFocused] = useState(false);

  const handleClearSelection = useCallback(() => {
     setSelectedText('');
     setSelectionRect(null);
     setSelectedCitation(undefined);
  }, []);

  const renderNotes = () => (
     <div 
        className="w-full h-full relative bg-white flex flex-col pointer-events-auto overflow-hidden text-sm"
        onFocus={(e) => {
           if (e.target.tagName.toLowerCase() === 'textarea') setIsNotesFocused(true);
        }}
        onBlur={() => setIsNotesFocused(false)}
     >
        <NotesPanel
            documentId={bookId}
            selectedText={selectedText}
            selectedCitation={selectedCitation}
            clearSelection={handleClearSelection}
            currentPage={currentPage}
            onNavigateToPage={(page) => setTargetPage({ page: Number(page), t: Date.now() })}
            onNavigateToCitation={(note) => {
              const colorDef = activePalette.find(c => c.id === note.color);
              if (note.quote) {
                setPendingHighlight({ text: note.quote, color: colorDef?.hex || '#fbbf24' });
              }
              if (item?.type !== 'epub' && note.pageReference) {
                setTargetPage({ page: Number(note.pageReference), t: Date.now() });
              }
            }}
            onRecolorCitation={(note) => {
              if (!note.quote) return;
              const colorDef = activePalette.find(c => c.id === note.color);
              // Re-pinta en sitio (sin scroll): limpia el resaltado anterior y
              // aplica el nuevo color sobre la frase actualmente visible.
              clearPersistentHighlights();
              highlightCurrentPhrase(note.quote, colorDef?.hex || '#fbbf24', true);
            }}
        />
     </div>
  );

  const readerPaneStyle: React.CSSProperties = showNotes 
      ? { 
          [isPortrait ? 'height' : 'width']: (isPortrait && isNotesFocused) ? '100%' : `${splitRatio}%`,
          [isPortrait ? 'width' : 'height']: '100%'
        }
      : { width: '100%', height: '100%' };

  const notesPaneStyle: React.CSSProperties = showNotes
      ? (isPortrait && isNotesFocused 
          ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }
          : { 
              [isPortrait ? 'height' : 'width']: `${100 - splitRatio}%`,
              [isPortrait ? 'width' : 'height']: '100%'
            })
      : { display: 'none' };

  // Actualización automática del progreso al cambiar de página.
  useEffect(() => {
    if (!item || !totalPages) return;
    const pageNum = Number(currentPage);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    const calculatedProgress = Math.min(100, Math.max(0, Math.round((pageNum / totalPages) * 100)));
    if (calculatedProgress !== item.progress) {
      updateItem(item.id, { progress: calculatedProgress, bookmarkPage: currentPage });
    }
  }, [currentPage, totalPages, item, updateItem]);

  return (
    <div
      className={cn("flex flex-col bg-[var(--bg-app)] overflow-hidden relative", isFullscreen ? "fixed inset-0 z-[100] bg-black" : "")}
      style={{ filter: `brightness(${brightness}%)`, height: '100dvh' }}
    >
      
      {/* Header */}
      {(!isFullscreen || showControls) && (
        <header className="bg-white border-b border-slate-200 px-2 sm:px-4 h-14 flex flex-row items-center justify-between shrink-0 shadow-sm z-30 gap-2 w-full animate-in slide-in-from-top-4">
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
                onClick={() => {
                  const doc: any = document;
                  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
                    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
                    if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
                  }
                  if (isFullscreen) setIsFullscreen(false);
                  else onClose();
                }}
                className="flex items-center text-slate-500 hover:text-[#00558F] transition-colors shrink-0 bg-slate-100/50 hover:bg-slate-100 p-2 rounded-lg"
                title="Volver"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1 shrink-0 hidden sm:block" />
            <div className="flex-1 min-w-0 flex items-center pr-2 hidden md:flex">
                <h2 className="text-sm sm:text-base font-bold text-slate-800 tracking-tight leading-tight truncate">
                {item.title}
                </h2>
            </div>
            </div>

            <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
             <div className="flex items-center justify-end gap-2 overflow-x-auto no-scrollbar shrink">
                 <div className="flex bg-slate-100 p-1 rounded-lg shrink-0 gap-1 items-center">
                     <button 
                         onClick={() => setActiveTab('reader')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'reader' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Lectura"
                     >
                         <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button
                         onClick={() => {
                             const opening = activeTab !== 'citations';
                             setActiveTab(opening ? 'citations' : 'reader');
                             if (opening) setShowNotes(false);
                         }}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'citations' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Administrar citas"
                     >
                         <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button
                         onClick={() => setActiveTab(activeTab === 'edit' ? 'reader' : 'edit')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'edit' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Información y Metadatos"
                     >
                         <Info className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     {item.type === 'pdf' && item.source?.startsWith('/api/files/') && itemCategoryName.toLowerCase() === 'estudio' && (
                       <button
                         onClick={() => setActiveTab(activeTab === 'auditor' ? 'reader' : 'auditor')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'auditor' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Auditoría Científica"
                       >
                         <FlaskConical className="w-4 h-4 sm:w-5 sm:h-5" />
                       </button>
                     )}
                 </div>
             </div>
 
             {/* Fixed right tools */}
             {activeTab === 'reader' && (
               isPhysicalOnly ? (
                 <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                   <button 
                       onClick={() => setShowNotes(!showNotes)} 
                       className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showNotes ? "bg-[#00558F] text-white border-[#00558F]" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                       title="Apuntes y Notas"
                   >
                       <MessageSquareQuote className="w-4 h-4 sm:w-5 sm:h-5" />
                   </button>
                 </div>
               ) : (item.type === 'pdf' || item.type === 'epub' || item.type === 'txt') && (
                 <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  {/* Lector de Voz (TTS ElevenLabs) */}
                  <button 
                      onClick={() => setShowTtsWidget(!showTtsWidget)} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showTtsWidget ? "bg-slate-100 text-[#00558F] border-slate-200" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                      title="Lector de Voz (TTS)"
                  >
                      <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  {/* Brightness */}
                  <div className="relative">
                     <button 
                         onClick={() => setShowBrightnessPopup(!showBrightnessPopup)} 
                         className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showBrightnessPopup ? "bg-slate-100 text-[#00558F] border-slate-200" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                         title="Brillo"
                     >
                         <Sun className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     {showBrightnessPopup && (
                         <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 flex items-center gap-3">
                             <Sun className="w-4 h-4 text-slate-400" />
                             <input 
                                type="range" 
                                min="20" max="100" 
                                value={brightness} 
                                onChange={(e) => setBrightness(Number(e.target.value))} 
                                className="w-24 sm:w-32 accent-[#00558F]" 
                             />
                         </div>
                     )}
                  </div>
                  
                  {/* Multi-bookmark: lista desplegable + modal de nombre. */}
                  <BookmarksMenu
                     documentId={bookId}
                     currentPage={currentPage}
                     isEpub={item?.type === 'epub'}
                     getEpubAnchor={getEpubBookmarkAnchor}
                     onNavigate={(page) => {
                       // EPUB: el "page" guardado es un CFI → navegar por CFI.
                       if (item?.type === 'epub' && typeof page === 'string' && page.startsWith('epubcfi(')) {
                         navigateEpubToCfi(page);
                       } else {
                         setTargetPage({ page: Number(page), t: Date.now() });
                       }
                     }}
                  />

                  <button
                      onClick={toggleFullscreen}
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", isFullscreen ? "bg-[#00558F] text-white border-[#00558F]" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                      title="Pantalla Completa"
                  >
                      {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                  <button 
                      onClick={() => setShowNotes(!showNotes)} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showNotes ? "bg-[#00558F] text-white border-[#00558F]" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                      title="Apuntes y Notas"
                  >
                      <MessageSquareQuote className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                 </div>
               )
             )}
            </div>
        </header>
      )}

      {/* Main Content Area */}
      <main 
         ref={containerRef}
         className={cn("flex-1 relative overflow-hidden flex", isPortrait ? "flex-col" : "flex-row", (isFullscreen && !showControls) ? "bg-[#e2e8f0]" : "bg-[#e2e8f0]")}
      >
         {selectionRect && selectedText && (
            <div 
              className="fixed z-[1000] bg-slate-800 text-white rounded-lg shadow-2xl flex items-center overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              style={{ 
                top: Math.max(10, selectionRect.top - 45), 
                left: Math.max(10, selectionRect.left + (selectionRect.width / 2) - 100) 
              }}
              onMouseDown={e => e.preventDefault()}
            >
               <div className="flex px-4 py-2.5 gap-3 items-center">
                  {activePalette.map((colorItem) => (
                     <button
                       key={colorItem.id}
                       onClick={() => {
                         // El EPUB es reflowable y no tiene número de página real
                         // (currentPage queda fijo en el bookmark inicial), así
                         // que omitimos la referencia de página para no guardar
                         // un dato incorrecto.
                         setSelectedCitation({ text: selectedText, color: colorItem.color, timestamp: Date.now(), page: item?.type === 'epub' ? undefined : currentPage });
                         if (!showNotes) setShowNotes(true);
                         setSelectionRect(null);
                       }}
                       style={{ backgroundColor: colorItem.hex }}
                       className="w-5 h-5 rounded-full hover:scale-110 active:scale-95 transition-transform ring-2 ring-transparent hover:ring-white/50 cursor-pointer"
                       title={colorItem.name}
                     />
                  ))}
                  {/* Leer en voz alta el texto seleccionado — solo si el TTS no está activo */}
                  {(ttsStatus === 'idle' || ttsStatus === 'error') && (
                     <button
                       onClick={() => {
                         setSelectionRect(null);
                         setShowTtsWidget(true);
                         handleTtsPlayPause();
                       }}
                       className="w-7 h-7 flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-transform border-l border-white/20 pl-3 ml-1 shrink-0"
                       title="Leer en voz alta"
                     >
                        <Volume2 className="w-5 h-5" />
                     </button>
                  )}
               </div>
            </div>
         )}

         {notesPosition === 'right' ? (
             <>
             <div style={readerPaneStyle} className="relative z-10 min-w-0 min-h-0">{renderReader()}</div>
             {showNotes && (
                 <>
                     <div 
                         onMouseDown={() => setIsDragging(true)}
                         onTouchStart={() => setIsDragging(true)}
                         className={cn("z-20 hover:bg-[#00558F] transition-colors flex items-center justify-center shadow-lg active:bg-[#00558F] shrink-0", isPortrait ? "h-6 w-full cursor-row-resize bg-slate-200" : "w-6 h-full cursor-col-resize bg-slate-200")}
                     >
                         <div className={cn("bg-slate-400 rounded-full", isPortrait ? "w-8 h-1" : "h-8 w-1")} />
                     </div>
                     <div style={notesPaneStyle} className="relative z-10 border-t md:border-t-0 md:border-l border-slate-200 shadow-2xl min-w-0 min-h-0">{renderNotes()}</div>
                 </>
             )}
             </>
         ) : (
             <>
             {showNotes && (
                 <>
                     <div style={notesPaneStyle} className="relative z-10 border-b md:border-b-0 md:border-r border-slate-200 shadow-2xl min-w-0 min-h-0">{renderNotes()}</div>
                     <div 
                         onMouseDown={() => setIsDragging(true)}
                         onTouchStart={() => setIsDragging(true)}
                         className={cn("z-20 hover:bg-[#00558F] transition-colors flex items-center justify-center shadow-lg active:bg-[#00558F] shrink-0", isPortrait ? "h-6 w-full cursor-row-resize bg-slate-200" : "w-6 h-full cursor-col-resize bg-slate-200")}
                     >
                         <div className={cn("bg-slate-400 rounded-full", isPortrait ? "w-8 h-1" : "h-8 w-1")} />
                     </div>
                 </>
             )}
             <div style={readerPaneStyle} className="relative z-10 min-w-0 min-h-0">{renderReader()}</div>
             </>
         )}

         {/* Info & Metadatos Overlay Panel. ÚNICO scroll: el del propio overlay.
             EditBookModal inline NO debe tener su propio overflow-y-auto. */}
         {activeTab === 'edit' && (
            <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300 overflow-y-auto shadow-2xl">
               <EditBookModal item={item} inline={true} onClose={() => setActiveTab('reader')} onSave={(id, updates) => { updateItem(id, updates); setActiveTab('reader'); }} />
            </div>
          )}

          {/* Auditoría Científica */}
          {activeTab === 'auditor' && (
            <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300 overflow-y-auto shadow-2xl">
              <AuditorPanel item={item} onClose={() => setActiveTab('reader')} />
            </div>
          )}

          {/* Citations Administration View */}
          {activeTab === 'citations' && (
             <CitationsManager
               documentId={item.id}
               onClose={() => setActiveTab('reader')}
               onNavigateToPage={(page) => {
                 setTargetPage({ page: Number(page), t: Date.now() });
                 setActiveTab('reader');
               }}
               onNavigateToCitation={(note) => {
                 const colorDef = activePalette.find(c => c.id === note.color);
                 if (note.quote) {
                   setPendingHighlight({ text: note.quote, color: colorDef?.hex || '#fbbf24' });
                 }
                 if (item?.type !== 'epub' && note.pageReference) {
                   setTargetPage({ page: Number(note.pageReference), t: Date.now() });
                 }
                 setActiveTab('reader');
               }}
               currentPage={currentPage}
             />
          )}
      </main>

      {showFolderManager && (
         <FolderManagerModal 
           book={item} 
           onClose={() => setShowFolderManager(false)} 
         />
      )}
    </div>
  );
}
